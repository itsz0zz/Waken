import { useMemo, useState } from 'react';
import type { WakenNav } from '@waken/app';

export type Route =
  | { name: 'home' }
  | { name: 'games'; query?: string }
  | { name: 'game'; gameId: string }
  | { name: 'machines' }
  | { name: 'machine'; deviceId: string }
  | { name: 'add' }
  | { name: 'settings' }
  | { name: 'wake'; deviceId: string; gameId?: string; app?: string; only?: boolean }
  | { name: 'stream'; deviceId: string; gameId?: string; app?: string };

export const tabs = ['home', 'games', 'machines', 'settings'] as const;
export type Tab = (typeof tabs)[number];

/** A desktop window has no stack animation: a list of routes, the last one shown. The tabs start a new list. */
export function useDesktopNav() {
  const [stack, setStack] = useState<Route[]>([{ name: 'home' }]);
  const nav = useMemo<WakenNav>(() => {
    const push = (r: Route) => setStack((s) => [...s, r]);
    const root = (r: Route) => setStack([r]);
    return {
      home: () => root({ name: 'home' }),
      games: (query) => root({ name: 'games', query }),
      game: (gameId) => push({ name: 'game', gameId }),
      machines: () => root({ name: 'machines' }),
      machine: (deviceId) => push({ name: 'machine', deviceId }),
      addMachine: () => push({ name: 'add' }),
      settings: () => root({ name: 'settings' }),
      play: (deviceId, gameId, app) => push({ name: 'wake', deviceId, gameId, app }),
      wakeOnly: (deviceId) => push({ name: 'wake', deviceId, only: true }),
      stream: (deviceId, gameId, app) => setStack((s) => [...s.slice(0, -1), { name: 'stream', deviceId, gameId, app }]),
      back: () => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)),
    };
  }, []);
  return { route: stack[stack.length - 1], tab: (stack[0].name as Tab) ?? 'home', nav };
}
