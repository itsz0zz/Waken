import { json } from './http';

/** Client for the Waken API running on the homelab (server/Waken.Api). */
export class WakenApi {
  constructor(private baseUrl: string, private token: string) {}

  private url(path: string) {
    return `${this.baseUrl.replace(/\/$/, '')}${path}`;
  }

  private auth() {
    return { Authorization: `Bearer ${this.token}` };
  }

  /** Cached artwork from SteamGridDB, resolved by game title. The token goes in a header, never in the URL. */
  coverSource(title: string, style: 'grid' | 'hero' = 'hero') {
    return { uri: `${this.url('/covers')}?title=${encodeURIComponent(title)}&style=${style}`, headers: this.auth() };
  }

  health() {
    return json<{ ok: boolean; version: string }>(this.url('/health'));
  }

  status(deviceId: string) {
    return json<{ online: boolean; sunshine: boolean }>(this.url(`/devices/${encodeURIComponent(deviceId)}/status`), { headers: this.auth() });
  }
}
