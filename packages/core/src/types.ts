export type DeviceKind = 'pc' | 'playstation' | 'homelab';

/**
 * How a device gets woken up. Chosen per device.
 *
 * - `homelab-relay`: the Waken API on the homelab sends a Wake-on-LAN magic packet on the LAN.
 * - `shelly-cloud`: a Shelly smart plug is power-cycled through the Shelly Cloud API; the PC BIOS must
 *   have "Restore on AC power loss = Power On". Works with no relay at home.
 * - `playstation`: the console is woken by the Remote Play protocol (rest mode). Nothing to do on our side
 *   in V1 (the official app wakes it); V3 will do it through libchiaki.
 * - `none`: the device is always on (the homelab itself).
 */
export type WakeMethod =
  | { type: 'homelab-relay'; apiUrl: string; apiToken: string; deviceId: string }
  | { type: 'shelly-cloud'; server: string; authKey: string; shellyId: string; channel?: number; offSeconds?: number }
  | { type: 'playstation' }
  | { type: 'none' };

export interface StreamTarget {
  /** Host reachable through Tailscale: MagicDNS name ("pc-gaming") or 100.x.y.z address. */
  host: string;
  /** Sunshine HTTP port (default 47989). */
  sunshinePort?: number;
  /** Optional Waken agent running on the PC (status / shutdown). */
  agentUrl?: string;
  agentToken?: string;
  /**
   * Network name of the computer on the Waken network ("waken-host-mac-de-enzo"), for computers found there.
   * The stream then goes through the app's tunnel: host 127.0.0.1, agent through the tunnel's local proxy.
   */
  tunnelHost?: string;
}

export interface Device {
  id: string;
  name: string;
  kind: DeviceKind;
  /** Short spec line shown under the name, e.g. "RTX 4070". */
  detail?: string;
  wake: WakeMethod;
  stream?: StreamTarget;
  /** The machine this app runs on (desktop apps): its games start right here, no stream. */
  local?: boolean;
}

export interface Game {
  id: string;
  title: string;
  deviceId: string;
  /** Sunshine app name to launch (PC). */
  sunshineApp?: string;
  /** Last played, ISO date. */
  lastPlayedAt?: string;
  /** Store the host found it in: Steam, Epic, GOG, Mac. Absent for entries added by hand. */
  store?: string;
  /** Official pictures, as paths on the host's agent (GET with its token). */
  art?: GameArt;
}

export type GameArtKind = 'cover' | 'hero' | 'logo' | 'icon';
export type GameArt = Partial<Record<GameArtKind, string>>;

/** A game installed on a host, as listed by its agent (GET /games). */
export interface HostGame {
  id: string;
  title: string;
  store: string;
  cover: string;
  hero: string;
  logo: string;
  icon: string;
}

export type WakeStepId = 'signal' | 'ping' | 'service' | 'stream';
export type WakeStepState = 'pending' | 'running' | 'done' | 'error';

export interface WakeProgress {
  step: WakeStepId;
  states: Record<WakeStepId, WakeStepState>;
  elapsedMs: number;
  message?: string;
}

export interface StreamSettings {
  width: number;
  height: number;
  fps: number;
  /** kbps */
  bitrate: number;
  codec: 'h264' | 'hevc' | 'av1';
}

export const defaultStreamSettings: StreamSettings = { width: 2560, height: 1440, fps: 120, bitrate: 50_000, codec: 'hevc' };
