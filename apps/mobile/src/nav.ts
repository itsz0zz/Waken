import { useMemo } from 'react';
import { useRouter, type Href } from 'expo-router';
import type { WakenNav } from '@waken/app';

/** Query string carrying the game to the wake and stream screens, with its Sunshine app name. */
export function launchQuery(gameId?: string, app?: string) {
  const params = [gameId ? `game=${encodeURIComponent(gameId)}` : '', app ? `app=${encodeURIComponent(app)}` : ''].filter(Boolean);
  return params.length ? `?${params.join('&')}` : '';
}

/** The shared screens' navigation, on expo-router. */
export function useRouterNav(): WakenNav {
  const router = useRouter();
  return useMemo<WakenNav>(
    () => ({
      home: () => router.navigate('/'),
      games: (query) => router.navigate(query ? { pathname: '/games', params: { q: query } } : '/games'),
      game: (id) => router.push(`/game/${encodeURIComponent(id)}` as Href),
      machines: () => router.navigate('/devices'),
      machine: (id) => router.push(`/edit/${encodeURIComponent(id)}`),
      addMachine: () => router.push('/add' as Href),
      settings: () => router.navigate('/settings'),
      play: (deviceId, gameId, app) => router.push(`/wake/${encodeURIComponent(deviceId)}${launchQuery(gameId, app)}`),
      wakeOnly: (deviceId) => router.push(`/wake/${encodeURIComponent(deviceId)}?only=1`),
      stream: (deviceId, gameId, app) => router.replace(`/stream/${encodeURIComponent(deviceId)}${launchQuery(gameId, app)}`),
      back: () => (router.canGoBack() ? router.back() : router.navigate('/')),
    }),
    [router]
  );
}
