import { platform } from './platform';
import type { Device, PlayStationLink } from '@waken/core';

/** A console answering on this network. */
export interface FoundConsole {
  host: string;
  name: string;
  id: string;
  ps5: boolean;
  /** ready: on; standby: rest mode, can be woken. */
  state: 'ready' | 'standby' | 'unknown';
  systemVersion?: string;
  app?: string;
}

/** What each app gives (iPhone and Mac: MLPlayStation over chiaki). */
export interface PlayStationApi {
  discover(seconds: number): Promise<FoundConsole[]>;
  register(host: string, ps5: boolean, accountId: string, pin: string): Promise<Omit<PlayStationLink, 'host'>>;
  wake(host: string, registKey: string, ps5: boolean): Promise<void>;
}

/** The same API from the native modules' plain answers. */
export function playstationFrom(native: {
  discover(seconds: number): Promise<Record<string, unknown>[]>;
  registerConsole(host: string, ps5: boolean, accountId: string, pin: string): Promise<Record<string, unknown>>;
  wake(host: string, registKey: string, ps5: boolean): Promise<void>;
}): PlayStationApi {
  return {
    discover: async (seconds) =>
      (await native.discover(seconds)).map((c) => ({
        host: String(c.host),
        name: String(c.name || 'PlayStation'),
        id: String(c.id ?? ''),
        ps5: c.ps5 === true,
        state: c.state === 'ready' || c.state === 'standby' ? c.state : 'unknown',
        systemVersion: c.systemVersion ? String(c.systemVersion) : undefined,
        app: c.app ? String(c.app) : undefined,
      })),
    register: async (host, ps5, accountId, pin) => {
      const r = await native.registerConsole(host, ps5, accountId, pin);
      return {
        ps5: r.ps5 === true,
        registKey: String(r.registKey),
        rpKey: String(r.rpKey),
        rpKeyType: Number(r.rpKeyType ?? 0),
        mac: String(r.mac ?? ''),
        nickname: String(r.nickname || 'PlayStation'),
      };
    },
    wake: (host, registKey, ps5) => native.wake(host, registKey, ps5),
  };
}

/** A console linked with this app: a machine of the list, woken and streamed through chiaki. */
export function consoleDevice(host: string, link: Omit<PlayStationLink, 'host'>): Device {
  return {
    id: `ps-${link.mac || host}`,
    name: link.nickname,
    kind: 'playstation',
    detail: link.ps5 ? 'PS5' : 'PS4',
    wake: { type: 'playstation' },
    playstation: { ...link, host },
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Wakes a linked console from rest mode and waits until it says it is on (up to a minute and a half: a PS5
 * takes about twenty seconds). On this network: from outside, Sony's servers will do it (later).
 */
export async function wakeConsole(device: Device, onState?: (state: FoundConsole['state'] | 'absent') => void, signal?: AbortSignal) {
  const api = platform().playstation;
  const link = device.playstation;
  if (!api || !link) throw new Error('Cette app ne sait pas encore réveiller une PlayStation.');
  const state = async () => (await api.discover(1.5)).find((c) => c.host === link.host || (link.mac && c.id.toLowerCase().endsWith(link.mac.toLowerCase())));
  let found = await state();
  onState?.(found?.state ?? 'absent');
  if (found?.state === 'ready') return;
  await api.wake(link.host, link.registKey, link.ps5);
  const until = Date.now() + 90_000;
  while (Date.now() < until) {
    if (signal?.aborted) throw new Error('Annulé');
    await sleep(2000);
    found = await state();
    onState?.(found?.state ?? 'absent');
    if (found?.state === 'ready') return;
  }
  throw new Error(`${device.name} ne répond pas : elle doit être en mode repos (pas éteinte), sur ce réseau.`);
}

/** The native view's state as the shared screens know it. A console asking its sign-in code ends the stream for now. */
export function playStationState(native: { state: string; message?: string }): import('./platform').StreamState {
  switch (native.state) {
    case 'streaming':
    case 'stopped':
    case 'connecting':
      return { state: native.state };
    case 'pin':
      return { state: 'error', message: 'La console demande son code de connexion : retire-le (Paramètres, Utilisateurs et comptes, Connexion) pour l’instant.' };
    default:
      return { state: 'error', message: native.message ?? 'Erreur de stream' };
  }
}

/** The view's flattened props, shared by the iPhone and Mac wrappers. */
export function playStationNativeProps(p: import('./platform').PlayStationViewProps) {
  return {
    link: { ...p.link } as Record<string, unknown>,
    videoHeight: Math.min(p.settings.height, 1080),
    fps: p.settings.fps >= 60 ? 60 : 30,
    bitrateKbps: p.settings.bitrate,
    hevc: p.settings.codec !== 'h264',
    muted: p.muted ?? false,
    onStateChange: (e: { nativeEvent: { state: string; message?: string } }) => p.onStateChange(playStationState(e.nativeEvent)),
    onStats: (e: { nativeEvent: import('./platform').StreamStats }) => p.onStats(e.nativeEvent),
  };
}
