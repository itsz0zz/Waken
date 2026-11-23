import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';
import * as SecureStore from 'expo-secure-store';
import { defaultStreamSettings, type Device, type Game, type StreamSettings } from '@waken/core';

/** Config holds API tokens and the Shelly key, so it lives in the Keychain / Keystore. */
const secureStorage: StateStorage = {
  getItem: (k) => SecureStore.getItemAsync(k),
  setItem: (k, v) => SecureStore.setItemAsync(k, v),
  removeItem: (k) => SecureStore.deleteItemAsync(k),
};

/**
 * Nothing to configure on a new install: the computers running Waken appear on their own once the
 * Waken network is signed in (src/network.ts adds them).
 */
const defaultDevices: Device[] = [];
const defaultGames: Game[] = [];

/** Version 0 shipped example games that do not exist on any host. */
const EXAMPLE_GAMES = new Set(['cod', 'gta6', 'steam']);

export type StreamEngine = 'moonlight-app' | 'native';

interface Settings {
  apiUrl: string;
  apiToken: string;
  /** V1: hand off to the Moonlight app. V2: stream inside Waken (waken-stream native module). */
  engine: StreamEngine;
  stream: StreamSettings;
  /** URL that opens your Moonlight install (V1), e.g. "moonlight://" if your build registers it. */
  moonlightUrl: string;
  psRemotePlayUrl: string;
}

interface WakenState {
  devices: Device[];
  /** Entries kept in the app. The installed games come from the hosts (see useLibrary). */
  games: Game[];
  /** Last time each game was played, by game id. */
  lastPlayed: Record<string, string>;
  settings: Settings;
  updateDevice: (d: Device) => void;
  /** A computer found on the Waken network, with its desktop as a first thing to stream. */
  addFoundComputer: (d: Device) => void;
  updateSettings: (s: Partial<Settings>) => void;
  markPlayed: (gameId: string) => void;
}

type LoadState = 'loading' | 'loaded' | 'failed';

/** persist.hasHydrated() stays false when the Keychain fails, so loading has its own end signal. */
export const useConfigLoad = create<{ state: LoadState }>(() => ({ state: 'loading' }));

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
        stream: defaultStreamSettings,
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
      updateSettings: (p) => set((s) => ({ settings: { ...s.settings, ...p } })),
      markPlayed: (id) => set((s) => ({ lastPlayed: { ...s.lastPlayed, [id]: new Date().toISOString() } })),
    }),
    {
      name: 'waken-config',
      version: 1,
      migrate: (persisted, version) => {
        const state = persisted as Partial<WakenState>;
        if (version < 1) {
          const games = state.games ?? [];
          state.lastPlayed = Object.fromEntries(games.filter((g) => g.lastPlayedAt).map((g) => [g.id, g.lastPlayedAt!]));
          state.games = games.filter((g) => !EXAMPLE_GAMES.has(g.id)).map(({ lastPlayedAt: _, ...g }) => g);
        }
        return state as WakenState;
      },
      storage: createJSONStorage(() => secureStorage),
      onRehydrateStorage: () => (_state, error) => useConfigLoad.setState({ state: error ? 'failed' : 'loaded' }),
    }
  )
);
