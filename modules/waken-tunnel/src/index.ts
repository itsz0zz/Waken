import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo';

/** The Waken network as the Go side reports it (tunnel/tunnel.go, Status). */
export interface TunnelNode {
  /** Network name, "waken-host-mac-de-enzo". */
  name: string;
  ip: string;
  os?: string;
  online: boolean;
  /** Straight between the two devices. False: through a Tailscale relay, slow and narrow. */
  direct: boolean;
  relay?: string;
}

export interface TunnelStatus {
  state: 'starting' | 'needs-login' | 'running' | 'stopped' | 'error';
  loginUrl?: string;
  error?: string;
  self?: TunnelNode;
  /** The owner's computers running Waken. */
  hosts: TunnelNode[];
  /** The host the stream ports go to. */
  peer?: string;
}

export interface TunnelHello {
  name: string;
  os: string;
  agentToken: string;
}

/** Where a client reaches a host's agent: the proxy names the host in the path. */
export const PROXY_BASE = 'http://127.0.0.1:47102/h/';
export const agentUrlFor = (hostName: string) => `${PROXY_BASE}${encodeURIComponent(hostName)}`;

interface Native {
  start(name?: string): Promise<string>;
  status(): Promise<string>;
  setPeer(peer: string): Promise<string>;
  hello(peer: string): Promise<string>;
  logout(): Promise<string>;
  stop(): Promise<void>;
}

const native = Platform.OS === 'ios' ? requireOptionalNativeModule<Native>('WakenTunnel') : null;

/** False in Expo Go, on the web, and on Android until its build (V3). */
export const isTunnelAvailable = native != null;

function parse<T>(json: string): T {
  const value = JSON.parse(json) as T & { error?: string };
  if (value && typeof value === 'object' && 'error' in value && value.error && !('state' in value)) throw new Error(value.error);
  return value;
}

/** A status from an older native build may say hosts: null. */
const parseStatus = (json: string): TunnelStatus => {
  const status = parse<TunnelStatus>(json);
  return { ...status, hosts: status.hosts ?? [] };
};

function need(): Native {
  if (!native) throw new Error("Le réseau Waken n'est pas disponible sur cet appareil.");
  return native;
}

export const WakenTunnel = {
  start: async (name?: string) => parseStatus(await need().start(name)),
  status: async () => parseStatus(await need().status()),
  setPeer: async (peer: string) => {
    parse(await need().setPeer(peer));
  },
  hello: async (peer: string) => parse<TunnelHello>(await need().hello(peer)),
  logout: async () => {
    parse(await need().logout());
  },
  stop: () => need().stop(),
};
