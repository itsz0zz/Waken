import type { Device, HostGame, HostStats, StreamSettings } from './types';
import { json } from './http';

/** The first launch also pairs the agent with Sunshine, and starting an encoder takes a few seconds. */
const LAUNCH_TIMEOUT_MS = 60_000;

export interface AgentLaunch {
  address: string;
  appVersion: string;
  gfeVersion?: string;
  rtspSessionUrl: string;
  serverCodecModeSupport: number;
  riKey: string;
  riKeyId: number;
  /** How long each step took on the computer, in ms (agent 1.x+). */
  timings?: Record<string, number>;
}

/**
 * The Waken agent on the PC pairs itself with Sunshine (once, automatically) and launches the app
 * over GameStream HTTPS. It returns what the native streamer needs to open the RTSP session.
 */
export class AgentClient {
  constructor(private device: Device) {
    if (!device.stream?.agentUrl) throw new Error(`${device.name} : agent Waken non configuré.`);
  }
  private get base() {
    return this.device.stream!.agentUrl!.replace(/\/$/, '');
  }
  private get headers() {
    return { Authorization: `Bearer ${this.device.stream!.agentToken ?? ''}` };
  }

  apps() {
    return json<{ id: number; title: string }[]>(`${this.base}/apps`, { headers: this.headers });
  }

  /** Games installed on the host, whatever the store. refresh rescans the disks instead of the 5 minute cache. */
  games(refresh = false) {
    return json<HostGame[]>(`${this.base}/games${refresh ? '?refresh=true' : ''}`, { headers: this.headers });
  }

  /**
   * Image source for a picture path from games(). The token goes in a header, never in the URL.
   * small asks for the light version (a few hundred KB): phones use it, desktops take the full picture.
   */
  artSource(path: string, small: boolean) {
    if (!path.startsWith('/games/')) throw new Error(`Chemin d'image inattendu : ${path}`);
    // The agent signs each picture's path (?sig=): it opens without the token, which some image loaders drop.
    const size = small ? `${path.includes('?') ? '&' : '?'}size=small` : '';
    return { uri: `${this.base}${path}${size}`, headers: this.headers };
  }

  /** The machine's play totals: days in a row, time this month, sessions. */
  stats() {
    return json<HostStats>(`${this.base}/stats`, { headers: this.headers });
  }

  /** Starts a game of the host's library on the host itself (a desktop app playing on its own machine). */
  startGame(gameId: string) {
    return json(`${this.base}/games/${encodeURIComponent(gameId)}/start`, { method: 'POST', headers: this.headers });
  }

  /** Rejects with a 409 HttpError when another game runs: closing it needs replace = true. */
  launch(appName: string, s: StreamSettings, replace = false) {
    return json<AgentLaunch>(`${this.base}/launch`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({ app: appName, width: s.width, height: s.height, fps: s.fps, hevc: s.codec !== 'h264', replace }),
    }, LAUNCH_TIMEOUT_MS);
  }

  quit() {
    return json(`${this.base}/quit`, { method: 'POST', headers: this.headers });
  }

  shutdown() {
    return json(`${this.base}/shutdown`, { method: 'POST', headers: this.headers });
  }
}
