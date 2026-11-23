import type { Device } from './types';
import { fetchWithTimeout } from './http';

export interface SunshineInfo {
  hostname?: string;
  appVersion?: string;
  state?: string; // SUNSHINE_SERVER_FREE | SUNSHINE_SERVER_BUSY
  currentGame?: string;
}

const tag = (xml: string, name: string) => xml.match(new RegExp(`<${name}>([^<]*)</${name}>`))?.[1];

/**
 * Sunshine answers GET http://host:47989/serverinfo (GameStream-compatible XML) as soon as it runs,
 * including at the Windows lock screen when Sunshine runs as a service.
 * Reached over Tailscale, so a successful answer also proves the VPN path works.
 */
export async function probeSunshine(host: string, port = 47989, timeoutMs = 2500): Promise<SunshineInfo | null> {
  try {
    const res = await fetchWithTimeout(`http://${host}:${port}/serverinfo`, {}, timeoutMs);
    if (!res.ok) return null;
    const xml = await res.text();
    return { hostname: tag(xml, 'hostname'), appVersion: tag(xml, 'appversion'), state: tag(xml, 'state'), currentGame: tag(xml, 'currentgame') };
  } catch {
    return null;
  }
}

/** Waken agent on the PC answers /health before Sunshine is up (it starts earlier in the boot). */
export async function probeAgent(device: Device, timeoutMs = 2000): Promise<boolean> {
  const s = device.stream;
  if (!s?.agentUrl) return false;
  try {
    // /health is public: no token, it would go every 10 s to whoever answers to this name.
    const res = await fetchWithTimeout(`${s.agentUrl.replace(/\/$/, '')}/health`, {}, timeoutMs);
    return res.ok;
  } catch {
    return false;
  }
}

export type Reachability = 'online' | 'booting' | 'offline';

export async function checkDevice(device: Device): Promise<Reachability> {
  if (!device.stream) return 'offline';
  // Through the tunnel, 127.0.0.1 is whichever computer was chosen last: ask this one's agent instead.
  // A Waken computer starts its agent once Sunshine is up, so an answering agent means ready to stream.
  if (device.stream.tunnelHost) return (await probeAgent(device, 5000)) ? 'online' : 'offline';
  const [sun, agent] = await Promise.all([probeSunshine(device.stream.host, device.stream.sunshinePort), probeAgent(device)]);
  if (sun) return 'online';
  if (agent) return 'booting';
  return 'offline';
}
