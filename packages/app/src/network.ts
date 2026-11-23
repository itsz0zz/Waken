import { useEffect } from 'react';
import { AppState } from 'react-native';
import { create } from 'zustand';
import { agentUrlFor, type Device, type TunnelNode, type TunnelStatus } from '@waken/core';
import { networkFor, useAccount } from './account';
import { platform } from './platform';
import { useWaken } from './store';

const POLL_MS = 2000;
/** A computer that did not answer is asked again after this delay, not on every poll. */
const RETRY_HELLO_MS = 30_000;

export const useNetwork = create<{ status: TunnelStatus | null }>(() => ({ status: null }));

const lastHello = new Map<string, number>();

let lastReport = '';
/** Each change of the network's state, once, in the app's log (waken.log on Windows, the console elsewhere). */
function report(status: TunnelStatus, network: string) {
  const line = `${status.state} via ${network}${status.control ? ` (serveur ${status.control})` : ''}${status.error ? ` : ${status.error}` : ''}, ${status.hosts?.length ?? 0} machine(s)`;
  if (line === lastReport) return;
  lastReport = line;
  console.log(`[réseau] ${line}`);
}

export const hasTunnel = () => platform().tunnel != null;

/**
 * Runs the Waken network while the app is in the foreground: starts the tunnel, follows its state,
 * and adds the owner's computers as they appear (each one hands over its agent token through the tunnel).
 */
export function useNetworkRunner() {
  useEffect(() => {
    const tunnel = platform().tunnel;
    if (!tunnel) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let active = AppState.currentState !== 'background';
    let stopped = false;

    const tick = async () => {
      try {
        // start() returns the running tunnel's status when it already runs; another network restarts it.
        const name = platform().deviceName;
        const network = await networkFor(false);
        if (!network) {
          // Account mode, signed out: no network at all until the account screen is done.
          useNetwork.setState({ status: { state: 'needs-login', hosts: [] } });
          if (!stopped && active) timer = setTimeout(tick, POLL_MS);
          return;
        }
        let current = await tunnel.start(name, network);
        if (current.state === 'needs-login' && useAccount.getState().mode === 'account') {
          // Removed from the account, or a first start: a fresh key signs it in, no web page.
          const network = await networkFor(true);
          if (network?.authKey) current = await tunnel.start(name, network);
        }
        report(current, network.authKey ? 'clé' : network.controlUrl || 'Tailscale');
        useNetwork.setState({ status: { ...current, hosts: current.hosts ?? [] } });
        if (current.state === 'running') await addComputers(current.hosts ?? []);
      } catch (e) {
        report({ state: 'error', error: (e as Error).message, hosts: [] }, '');
        useNetwork.setState({ status: { state: 'error', error: (e as Error).message, hosts: [] } });
      }
      if (!stopped && active) timer = setTimeout(tick, POLL_MS);
    };

    const sub = AppState.addEventListener('change', (next) => {
      const wasActive = active;
      active = next !== 'background';
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
  const tunnel = platform().tunnel!;
  const { devices, addFoundComputer } = useWaken.getState();
  for (const host of hosts) {
    // A desktop app hosts too: never list itself.
    if (host.name === useNetwork.getState().status?.self?.name) continue;
    const known = devices.find((d) => d.stream?.tunnelHost === host.name);
    if ((known?.stream?.agentToken && known.name) || !host.online) continue;
    if (Date.now() - (lastHello.get(host.name) ?? 0) < RETRY_HELLO_MS) continue;
    lastHello.set(host.name, Date.now());
    try {
      const hello = await tunnel.hello(host.name);
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
    detail: known?.detail ?? (os === 'macOS' ? 'Mac' : os === 'windows' ? 'PC' : undefined),
    wake: known?.wake ?? { type: 'none' },
    stream: { host: '127.0.0.1', sunshinePort: 47989, agentUrl: agentUrlFor(host.name), agentToken, tunnelHost: host.name },
  };
}

/** The stream ports follow one computer at a time: point them at this one before checking, waking or streaming it. */
export async function pointStreamAt(device?: Device) {
  const host = device?.stream?.tunnelHost;
  const tunnel = platform().tunnel;
  if (host && tunnel) await tunnel.setPeer(host);
}

/**
 * How this computer is reached right now, after giving the tunnel a moment to find a direct path
 * (pointStreamAt starts the search). Computers not on the Waken network count as direct.
 */
export async function pathTo(device: Device, waitMs = 3000): Promise<'direct' | 'relayed'> {
  const host = device.stream?.tunnelHost;
  const tunnel = platform().tunnel;
  if (!host || !tunnel) return 'direct';
  const deadline = Date.now() + waitMs;
  for (;;) {
    const node = (await tunnel.status()).hosts?.find((h) => h.name === host);
    if (node?.direct) return 'direct';
    if (Date.now() >= deadline) return 'relayed';
    await new Promise((r) => setTimeout(r, 300));
  }
}

/** The network's view of a computer: online, and whether the path is direct. */
export function useHostNode(device?: Device): TunnelNode | undefined {
  return useNetwork((s) => s.status?.hosts.find((h) => h.name === device?.stream?.tunnelHost));
}

/** Signs this device out of the Waken network: the computers disappear until the next sign-in. */
export async function signOut() {
  await platform().tunnel?.logout();
}
