export type DeviceKind = 'pc' | 'playstation' | 'homelab';

/**
 * How a device gets woken up. Chosen per device.
 *
 * - `homelab-relay`: the Waken API on the homelab sends a Wake-on-LAN magic packet on the LAN.
 * - `shelly-cloud`: a Shelly smart plug is power-cycled through the Shelly Cloud API; the PC BIOS must
 *   have "Restore on AC power loss = Power On". Works with no relay at home.
 * - `playstation`: the console is woken by the Remote Play protocol (rest mode). Nothing to do on our side
 *   in V1 (the official app wakes it); V3 will do it through libchiaki.
 * - `wake-on-lan`: a magic packet, sent every way that may reach the computer: this device on its network, the
 *   home's public address (a port forwarded by the box), the account's other computers awake at home. Filled in
 *   from what the computer itself left on the account's server (its library).
 * - `none`: the device is always on (the homelab itself).
 */
export type WakeMethod =
  | { type: 'homelab-relay'; apiUrl: string; apiToken: string; deviceId: string }
  | { type: 'shelly-cloud'; server: string; authKey: string; shellyId: string; channel?: number; offSeconds?: number }
  | { type: 'playstation' }
  | WakeOnLanMethod
  | { type: 'none' };

export interface WakeOnLanMethod {
  type: 'wake-on-lan';
  /** The network card's hardware address, AA:BB:CC:DD:EE:FF. */
  mac: string;
  /** The computer's address on its home network, and that network's broadcast. */
  address?: string;
  broadcast?: string;
  /** The home's public IPv4 address, where the box forwards the wake-up port to the computer. */
  publicAddress?: string;
}

/** What a computer says about itself for waking it, kept with its library on the account's server. */
export interface WakeInfo {
  mac: string;
  address: string;
  broadcast: string;
  publicAddress?: string | null;
}

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
  /** A PS5 or PS4 linked with Waken (chiaki): how to reach and wake it, and the keys of its link. */
  playstation?: PlayStationLink;
}

/** What linking a console gave (its code typed once), enough to wake it and stream from it. */
export interface PlayStationLink {
  /** Its address on the home network. */
  host: string;
  ps5: boolean;
  /** Hex text, the wake-up credential too. */
  registKey: string;
  /** Hex, 16 bytes: the stream's key. */
  rpKey: string;
  rpKeyType: number;
  mac: string;
  nickname: string;
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
  /** Time played on its machine, in seconds, and how many times it was started (from the machine's agent). */
  playSeconds?: number;
  sessions?: number;
}

export type GameArtKind = 'cover' | 'hero' | 'logo' | 'icon';
export type GameArt = Partial<Record<GameArtKind, string>>;

/** A machine's totals (GET /stats). */
export interface HostStats {
  streakDays: number;
  monthSeconds: number;
  sessions: number;
  /** The last streamed session that ended on this host. */
  lastSession?: { gameId: string; title: string; seconds: number; endedAt: string } | null;
}

/** A game installed on a host, as listed by its agent (GET /games). */
export interface HostGame {
  id: string;
  title: string;
  store: string;
  /** Kept by the machine's agent, shared by every device that plays on it. */
  lastPlayed?: string | null;
  playSeconds?: number;
  sessions?: number;
  /** A path on the agent (/games/...), or a public address in the account's library (SteamGridDB, Steam). */
  cover: string | null;
  hero: string | null;
  logo: string | null;
  icon: string | null;
  /** Public library only: the light versions, for phones. */
  coverSmall?: string | null;
  heroSmall?: string | null;
}

/** What a machine's own app sends to the account's server, and every other device reads there. */
export interface MachineLibrary {
  games: HostGame[];
  stats?: HostStats;
  wake?: WakeInfo | null;
}

/** One machine's library on the account's server: machine is its name on the Waken network, lower case. */
export interface CloudLibrary extends MachineLibrary {
  machine: string;
  updatedAt: string;
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
