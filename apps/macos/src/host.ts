import { NativeModules } from 'react-native';
import type { Device, TunnelApi, TunnelHello, TunnelStatus } from '@waken/core';

/** What the native WakenHost module (macos/Waken-macOS/WakenHostModule.swift) reports. */
export interface HostStatus {
  embedded: boolean;
  sunshine: boolean;
  agent: boolean;
  screen: boolean;
  control: boolean;
  deviceName: string;
  /** This Mac's own agent token: its library and local game starts. */
  agentToken?: string;
  error?: string;
  /** The network helper's last status line, as JSON. */
  tunnel?: string;
}

interface Native {
  start(): Promise<void>;
  status(): Promise<HostStatus>;
  requestPermission(kind: 'screen' | 'control'): Promise<void>;
  openSettings(kind: 'screen' | 'control'): Promise<void>;
  restartServer(): Promise<void>;
  tunnelCommand(cmd: 'hello' | 'setPeer' | 'logout', peer: string | null): Promise<string>;
  storageGet(key: string): Promise<string | null>;
  storageSet(key: string, value: string): Promise<void>;
  storageRemove(key: string): Promise<void>;
}

export const host = NativeModules.WakenHost as Native;

const command = async <T>(cmd: 'hello' | 'setPeer' | 'logout', peer: string | null) => (JSON.parse(await host.tunnelCommand(cmd, peer)) as { result: T }).result;

/** The Waken network as the shared screens use it, through the host's helper process. */
export const hostTunnel: TunnelApi = {
  start: async () => {
    await host.start();
    return hostTunnel.status();
  },
  status: async () => {
    const s = await host.status();
    if (!s.tunnel) return { state: s.error ? 'error' : 'starting', error: s.error, hosts: [] };
    const status = JSON.parse(s.tunnel) as TunnelStatus;
    return { ...status, hosts: status.hosts ?? [] };
  },
  setPeer: async (peer) => {
    await command('setPeer', peer);
  },
  hello: (peer) => command<TunnelHello>('hello', peer),
  logout: async () => {
    await command('logout', null);
  },
  // The helper lives as long as the app: closing Waken stops it.
  stop: async () => {},
};

/** This Mac as a machine of the app: its library shows, its games start here (no stream to itself). */
export const LOCAL_ID = 'this-mac';
export const localDevice = (name: string, agentToken: string): Device => ({
  id: LOCAL_ID,
  name,
  kind: 'pc',
  detail: 'Mac',
  wake: { type: 'none' },
  local: true,
  stream: { host: '127.0.0.1', sunshinePort: 47989, agentUrl: 'http://127.0.0.1:47100', agentToken },
});
