/** The Waken network as each app's native side reports it (tunnel/tunnel.go, Status). */
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
  /** The coordination server: the Waken account's network, or absent for Tailscale's. */
  control?: string;
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

/** Which network to run on: the account's (Headscale) or Tailscale's (controlUrl ""), and a key to sign in. */
export interface TunnelNetwork {
  controlUrl: string;
  /** Single-use: only when the device has to sign in. */
  authKey?: string;
}

/** What an app gives the shared code to use the Waken network (native module on iOS, helper process on desktop). */
export interface TunnelApi {
  /** Starts the tunnel, or returns the running one's status. Another network, or a key, restarts it. */
  start(name?: string, network?: TunnelNetwork): Promise<TunnelStatus>;
  status(): Promise<TunnelStatus>;
  setPeer(peer: string): Promise<void>;
  hello(peer: string): Promise<TunnelHello>;
  logout(): Promise<void>;
  stop(): Promise<void>;
}

/** Where a client reaches a host's agent: the proxy names the host in the path. */
export const TUNNEL_PROXY_BASE = 'http://127.0.0.1:47102/h/';
export const agentUrlFor = (hostName: string) => `${TUNNEL_PROXY_BASE}${encodeURIComponent(hostName)}`;

/** Computers running Waken are named waken-host-<slug> on the network. */
export const hostDisplayName = (hostName: string) => hostName.replace(/^waken-host-/, '').replace(/-/g, ' ');
