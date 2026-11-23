import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';
import type { HostGame } from '@waken/core';
import { onPlatformSet, platform } from './platform';

/**
 * The last library each machine sent. The app shows it at once on launch, and while a machine is off,
 * then replaces it with the fresh one. Pictures have their own cache (expo-image on the phone, the agent's disk).
 */
interface LibraryCache {
  libraries: Record<string, HostGame[]>;
  save: (deviceId: string, games: HostGame[]) => void;
  forget: (deviceId: string) => void;
}

const cacheStorage: StateStorage = {
  getItem: (k) => platform().cacheStorage.getItem(k),
  setItem: (k, v) => platform().cacheStorage.setItem(k, v),
  removeItem: (k) => platform().cacheStorage.removeItem(k),
};

export const useLibraryCache = create<LibraryCache>()(
  persist(
    (set) => ({
      libraries: {},
      save: (deviceId, games) => set((s) => ({ libraries: { ...s.libraries, [deviceId]: games } })),
      forget: (deviceId) =>
        set((s) => {
          const { [deviceId]: _, ...rest } = s.libraries;
          return { libraries: rest };
        }),
    }),
    {
      name: 'waken-library',
      version: 1,
      storage: createJSONStorage(() => cacheStorage),
      skipHydration: true,
      partialize: (s) => ({ libraries: s.libraries }),
    }
  )
);

onPlatformSet(() => {
  void useLibraryCache.persist.rehydrate();
});
