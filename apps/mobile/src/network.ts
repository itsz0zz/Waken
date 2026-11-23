import { useEffect } from 'react';
import { AppState } from 'react-native';
import { create } from 'zustand';
import type { Device } from '@waken/core';
import { agentUrlFor, isTunnelAvailable, WakenTunnel, type TunnelNode, type TunnelStatus } from 'waken-tunnel';
import { useWaken } from './store';

const POLL_MS = 2000;
/** A computer that did not answer is asked again after this delay, not on every poll. */
const RETRY_HELLO_MS = 30_000;

export const useNetwork = create<{ status: TunnelStatus | null }>(() => ({ status: null }));

const lastHello = new Map<string, number>();

/**
 * Runs the Waken network while the app is in the foreground: starts the tunnel, follows its state,
 * and adds the owner's computers as they appear (each one hands over its agent token through the tunnel).
 */
export function useNetworkRunner() {
  useEffect(() => {
    if (!isTunnelAvailable) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let active = AppState.currentState === 'active';
    let stopped = false;

    const tick = async () => {
      try {
        // start() returns the running tunnel's status when it already runs.
        const current = await WakenTunnel.start();
        useNetwork.setState({ status: current });
        if (current.state === 'running') await addComputers(current.hosts);
      } catch (e) {
        useNetwork.setState({ status: { state: 'error', error: (e as Error).message, hosts: [] } });
      }
      if (!stopped && active) timer = setTimeout(tick, POLL_MS);
    };

    const sub = AppState.addEventListener('change', (next) => {
      const wasActive = active;
      active = next === 'active';
      if (active && !wasActive) void tick();
      if (!active && timer) clearTimeout(timer);
    });
    if (active) void tick();
    return () => {
      stopped = true;
      sub.remove();
      if (timer) clearTimeout(timer);
    };
  }, []);
}

async function addComputers(hosts: TunnelNode[]) {
  const { devices, addFoundComputer } = useWaken.getState();
  for (const host of hosts) {
    const known = devices.find((d) => d.stream?.tunnelHost === host.name);
    if ((known?.stream?.agentToken && known.name) || !host.online) continue;
    if (Date.now() - (lastHello.get(host.name) ?? 0) < RETRY_HELLO_MS) continue;
    lastHello.set(host.name, Date.now());
    try {
      const hello = await WakenTunnel.hello(host.name);
      addFoundComputer(foundComputer(host, hello.name, hello.agentToken, hello.os, known));
    } catch {
      // Offline or an older Waken: asked again later.
    }
  }
}

function foundComputer(host: TunnelNode, name: string, agentToken: string, os: string, known?: Device): Device {
  return {
    ...known,
    id: known?.id ?? host.name,
    name: known?.name || name,
    kind: 'pc',
    detail: known?.detail ?? (os === 'macOS' ? 'Mac' : os === 'windows' ? 'PC Windows' : undefined),
    wake: known?.wake ?? { type: 'none' },
    stream: { host: '127.0.0.1', sunshinePort: 47989, agentUrl: agentUrlFor(host.name), agentToken, tunnelHost: host.name },
  };
}

/** The stream ports follow one computer at a time: point them at this one before checking, waking or streaming it. */
export async function pointStreamAt(device?: Device) {
  const host = device?.stream?.tunnelHost;
  if (host && isTunnelAvailable) await WakenTunnel.setPeer(host);
}

/** Full quality needs a direct path; a relayed one gets this much at most. */
export const RELAYED_QUALITY = { width: 1280, height: 720, fps: 60, bitrate: 6_000 };

/**
 * How this computer is reached right now, after giving the tunnel a moment to find a direct path
 * (pointStreamAt starts the search). Computers not on the Waken network count as direct.
 */
export async function pathTo(device: Device, waitMs = 3000): Promise<'direct' | 'relayed'> {
  const host = device.stream?.tunnelHost;
  if (!host || !isTunnelAvailable) return 'direct';
  const deadline = Date.now() + waitMs;
  for (;;) {
    const node = (await WakenTunnel.status()).hosts.find((h) => h.name === host);
    if (node?.direct) return 'direct';
    if (Date.now() >= deadline) return 'relayed';
    await new Promise((r) => setTimeout(r, 300));
  }
}

/** Signs this device out of the Waken network: the computers disappear until the next sign-in. */
export async function signOut() {
  await WakenTunnel.logout();
}

export { isTunnelAvailable };
