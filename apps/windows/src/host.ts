import { NativeModules, TurboModuleRegistry } from 'react-native';
import { json, type Device, type TunnelApi, type TunnelHello, type TunnelStatus } from '@waken/core';

/** What the native WakenHost module (windows/Waken/WakenHost.h) reports. */
interface NativeStatus {
  embedded: boolean;
  agent: boolean;
  deviceName: string;
  /** This PC's own agent token: its library, local game starts, and the services below. */
  agentToken?: string;
  error?: string;
}

interface Native {
  start(): Promise<void>;
  status(): Promise<string>;
  setFullscreen(on: boolean): void;
  storageGet(key: string): Promise<string | null>;
  storageSet(key: string, value: string): Promise<void>;
  storageRemove(key: string): Promise<void>;
  /** The PC's controllers (SDL3), as JSON; absent from an older build. */
  gamepads?(): Promise<string>;
  testGamepad?(id: string): Promise<void>;
  setGamepadOptions?(rumble: number, motion: boolean, kind: string): void;
  /** Waken started with Windows (install-service.ps1), and the switch that runs it elevated. */
  startsWithWindows?(): Promise<boolean>;
  setStartsWithWindows?(enable: boolean, disableFastStartup: boolean): Promise<void>;
}

/** The new architecture's registry first, the old bridge otherwise. */
export const native = (TurboModuleRegistry.get<never>('WakenHost') ?? NativeModules.WakenHost) as unknown as Native;

/** The agent of this PC: it runs Sunshine and the Waken network, and answers on 127.0.0.1 only. */
const AGENT = 'http://127.0.0.1:47100';

/** This PC's services, as the screens need them. */
export interface HostStatus extends NativeStatus {
  sunshine: boolean;
  /** The Waken network helper's status, from the agent. */
  tunnel?: TunnelStatus | null;
  /** The virtual gamepad driver Sunshine needs for controllers (ViGEmBus). */
  gamepadDriver?: boolean;
}

let token: string | undefined;

async function agent<T>(path: string, init: RequestInit = {}) {
  if (!token) throw new Error("L'agent de ce PC démarre.");
  // no-cache: Windows' HTTP stack keeps GET answers otherwise, and the status would never change.
  return json<T>(
    `${AGENT}${path}`,
    { ...init, cache: 'no-store', headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${token}`, 'Cache-Control': 'no-cache' } },
    15_000,
  );
}

let lastNote = '';
/** What this PC's services report, in waken.log when it changes. */
function note(text: string) {
  if (text === lastNote) return;
  lastNote = text;
  console.log(`[hôte] ${text}`);
}

export async function hostStatus(): Promise<HostStatus> {
  const own = JSON.parse(await native.status()) as NativeStatus;
  token = own.agentToken ?? token;
  if (!own.agent || !token) {
    note(`agent ${own.agent ? 'sans jeton' : 'arrêté'}${own.error ? ` : ${own.error}` : ''}`);
    return { ...own, sunshine: false };
  }
  try {
    const services = await agent<{ sunshine: boolean; tunnel: TunnelStatus | null; error?: string; gamepadDriver?: boolean | null }>('/host/status');
    note(`Sunshine ${services.sunshine ? 'prêt' : 'arrêté'}, réseau ${services.tunnel ? services.tunnel.state : 'sans état'}${services.error ? ` : ${services.error}` : ''}`);
    return { ...own, sunshine: services.sunshine, tunnel: services.tunnel, gamepadDriver: services.gamepadDriver ?? undefined, error: own.error ?? services.error ?? undefined };
  } catch (e) {
    // The agent is starting: its port answers a moment later.
    note(`agent injoignable : ${(e as Error).message}`);
    return { ...own, sunshine: false };
  }
}

const command = async <T>(cmd: 'hello' | 'setPeer' | 'logout' | 'join', extra: Record<string, string | null> = {}) =>
  (await agent<{ result: T }>('/host/tunnel', { method: 'POST', body: JSON.stringify({ cmd, ...extra }) })).result;

/** The Waken network as the shared screens use it, through the agent. */
export const hostTunnel: TunnelApi = {
  start: async (_name, network) => {
    await native.start();
    const status = await hostTunnel.status();
    // The helper is up (it reported a status) and runs on another network, or has a key to sign in with.
    const running = status.state !== 'starting' || status.self != null;
    if (network && running && (network.authKey || (status.control ?? '') !== network.controlUrl)) {
      await command('join', { controlUrl: network.controlUrl, authKey: network.authKey ?? '' });
      return hostTunnel.status();
    }
    return status;
  },
  status: async () => {
    const s = await hostStatus();
    if (!s.tunnel) return { state: s.error ? 'error' : 'starting', error: s.error, hosts: [] };
    return { ...s.tunnel, hosts: s.tunnel.hosts ?? [] };
  },
  setPeer: async (peer) => {
    await command('setPeer', { peer });
  },
  hello: (peer) => command<TunnelHello>('hello', { peer }),
  logout: async () => {
    await command('logout');
  },
  // The services live as long as the app (a Windows job object): closing Waken stops them.
  stop: async () => {},
};

export const restartServer = () => agent<void>('/host/restart-sunshine', { method: 'POST' });

/** This PC as a machine of the app: its library shows, its games start here (no stream to itself). */
export const LOCAL_ID = 'this-pc';
export const localDevice = (name: string, agentToken: string): Device => ({
  id: LOCAL_ID,
  name,
  kind: 'pc',
  detail: 'PC',
  wake: { type: 'none' },
  local: true,
  stream: { host: '127.0.0.1', sunshinePort: 47989, agentUrl: AGENT, agentToken },
});
