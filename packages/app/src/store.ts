import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';
import { type Device, type Game, type StreamSettings } from '@waken/core';
import { onPlatformSet, platform } from './platform';
import { qualities } from './quality';

/**
 * Nothing to configure on a new install: the computers running Waken appear on their own once the
 * Waken network is signed in (network.ts adds them).
 */
const defaultDevices: Device[] = [];
const defaultGames: Game[] = [];

/** Version 0 shipped example games that do not exist on any host. */
const EXAMPLE_GAMES = new Set(['cod', 'gta6', 'steam']);

export type StreamEngine = 'moonlight-app' | 'native';

export interface Settings {
  /** Homelab relay, kept for waking computers that are off (not used by computers on the Waken network). */
  apiUrl: string;
  apiToken: string;
  /** native: stream inside Waken. moonlight-app: hand off to Moonlight (iPhone, kept from V1). */
  engine: StreamEngine;
  stream: StreamSettings;
  moonlightUrl: string;
  psRemotePlayUrl: string;
}

export interface WakenState {
  devices: Device[];
  /** Entries kept in the app. The installed games come from the hosts (see useLibrary). */
  games: Game[];
  /** Last time each game was played, by game id. */
  lastPlayed: Record<string, string>;
  settings: Settings;
  updateDevice: (d: Device) => void;
  /** A computer found on the Waken network, with its desktop as a first thing to stream. */
  addFoundComputer: (d: Device) => void;
  /** Adds or replaces a machine (the desktop app's own machine). */
  upsertDevice: (d: Device) => void;
  updateSettings: (s: Partial<Settings>) => void;
  markPlayed: (gameId: string) => void;
}

type LoadState = 'loading' | 'loaded' | 'failed';

/** persist.hasHydrated() stays false when the storage fails, so loading has its own end signal. */
export const useConfigLoad = create<{ state: LoadState }>(() => ({ state: 'loading' }));

/** Reads and writes through the platform's storage, set at startup (Keychain on iPhone, private file on desktop). */
const platformStorage: StateStorage = {
  getItem: (k) => platform().storage.getItem(k),
  setItem: (k, v) => platform().storage.setItem(k, v),
  removeItem: (k) => platform().storage.removeItem(k),
};

export const useWaken = create<WakenState>()(
  persist(
    (set) => ({
      devices: defaultDevices,
      games: defaultGames,
      lastPlayed: {},
      settings: {
        apiUrl: 'http://homelab:8085',
        apiToken: '',
        engine: 'native',
        stream: qualities.balanced.settings,
        moonlightUrl: '',
        psRemotePlayUrl: '',
      },
      updateDevice: (d) => set((s) => ({ devices: s.devices.map((x) => (x.id === d.id ? d : x)) })),
      addFoundComputer: (d) =>
        set((s) => {
          const known = s.devices.some((x) => x.id === d.id);
          return {
            devices: known ? s.devices.map((x) => (x.id === d.id ? d : x)) : [...s.devices, d],
            games: s.games.some((g) => g.deviceId === d.id && g.sunshineApp === 'Desktop')
              ? s.games
              : [...s.games, { id: `${d.id}/desktop`, title: 'Bureau', deviceId: d.id, sunshineApp: 'Desktop' }],
          };
        }),
      upsertDevice: (d) => set((s) => ({ devices: s.devices.some((x) => x.id === d.id) ? s.devices.map((x) => (x.id === d.id ? d : x)) : [d, ...s.devices] })),
      updateSettings: (p) => set((s) => ({ settings: { ...s.settings, ...p } })),
      markPlayed: (id) => set((s) => ({ lastPlayed: { ...s.lastPlayed, [id]: new Date().toISOString() } })),
    }),
    {
      name: 'waken-config',
      version: 1,
      storage: createJSONStorage(() => platformStorage),
      // The platform is set by the app after this module loads: loading waits for it.
      skipHydration: true,
      migrate: (persisted, version) => {
        const state = persisted as Partial<WakenState>;
        if (version < 1) {
          const games = state.games ?? [];
          state.lastPlayed = Object.fromEntries(games.filter((g) => g.lastPlayedAt).map((g) => [g.id, g.lastPlayedAt!]));
          state.games = games.filter((g) => !EXAMPLE_GAMES.has(g.id)).map(({ lastPlayedAt: _, ...g }) => g);
        }
        return state as WakenState;
      },
      onRehydrateStorage: () => (_state, error) => useConfigLoad.setState({ state: error ? 'failed' : 'loaded' }),
    }
  )
);

onPlatformSet(() => {
  void useWaken.persist.rehydrate();
});
