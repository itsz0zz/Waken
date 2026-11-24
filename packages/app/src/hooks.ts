import { useEffect } from 'react';
import { AppState } from 'react-native';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { AgentClient, checkDevice, mergeLibrary, probeSunshine, type CloudLibrary, type Device, type Game, type GameArtKind, type HostGame } from '@waken/core';
import { desktopArt, type ArtSource, type DeviceStatus } from '@waken/ui';
import { useShallow } from 'zustand/react/shallow';
import { cloud, useAccount } from './account';
import { platform } from './platform';
import { useLibraryCache } from './libraryCache';
import { useNetwork } from './network';
import { useWaken } from './store';
import { withWakeInfo } from './wakeOnLan';

const hasAgent = (d: Device) => !!d.stream?.agentUrl && !!d.stream.agentToken;

/**
 * Signed in to a Waken account: the games of the network's machines come from the account's server (each machine's
 * own app sends them there), even with the machine off. The machine is only reached to wake it and to play.
 */
function useCloudLibraries() {
  const signedIn = useAccount((s) => s.mode === 'account' && s.session !== null);
  const query = useQuery({
    queryKey: ['cloud-library'],
    enabled: signedIn,
    staleTime: 60_000,
    refetchInterval: 60_000,
    retry: 1,
    queryFn: () => cloud().library(),
  });
  const byMachine = new Map<string, CloudLibrary>((query.data ?? []).map((l) => [l.machine, l]));
  // The machine's own agent for this one (the desktop app's own machine, or without an account).
  const fromCloud = (d: Device) => signedIn && !d.local && !!d.stream?.tunnelHost;
  return { query, fromCloud, of: (d: Device) => (fromCloud(d) ? byMachine.get(d.stream!.tunnelHost!.toLowerCase()) : undefined) };
}

/** Public pictures: a phone takes the light versions the machine listed. */
function forThisDevice(games: HostGame[]): HostGame[] {
  if (platform().form !== 'phone') return games;
  return games.map((g) => ({ ...g, cover: g.coverSmall ?? g.cover, hero: g.heroSmall ?? g.hero }));
}

/** The games found on every host that has an agent, merged with the entries kept in the app. */
export function useLibrary() {
  const all = useWaken(useShallow((s) => s.devices.filter(hasAgent)));
  const kept = useWaken((s) => s.games);
  const lastPlayed = useWaken((s) => s.lastPlayed);
  const libraries = useCloudLibraries();
  const remote = all.filter(libraries.fromCloud);
  const hosts = all.filter((d) => !libraries.fromCloud(d));
  const queries = useQueries({
    queries: hosts.map((device) => ({
      queryKey: ['games', device.id, device.stream?.agentUrl],
      staleTime: 5 * 60_000,
      retry: 1,
      // A machine that just started (or was off) answers a bit later: ask again until it does, then each minute.
      refetchInterval: (query: { state: { status: string } }) => (query.state.status === 'error' ? 3_000 : 60_000),
      queryFn: () => new AgentClient(device).games(),
    })),
  });
  const cached = useLibraryCache((s) => s.libraries);
  const save = useLibraryCache((s) => s.save);
  // Fresh libraries replace the cached ones; a machine that does not answer keeps its last known list.
  const fresh = queries.map((q) => q.data);
  const fromServer = remote.map((d) => libraries.of(d)?.games);
  useEffect(() => {
    hosts.forEach((d, i) => {
      if (fresh[i] && fresh[i] !== cached[d.id]) save(d.id, fresh[i]!);
    });
    remote.forEach((d, i) => {
      if (fromServer[i] && fromServer[i] !== cached[d.id]) save(d.id, fromServer[i]!);
    });
    // How to wake each computer, as it left it on the server before going to sleep.
    const { upsertDevice } = useWaken.getState();
    for (const d of remote) {
      const next = withWakeInfo(d, libraries.of(d)?.wake);
      if (next !== d) upsertDevice(next);
    }
    // Each time a machine answers anew (its stats change too, not only its list of games).
  }, [queries.map((q) => q.dataUpdatedAt).join(), libraries.query.dataUpdatedAt, all.length]);
  const found: Record<string, HostGame[]> = {};
  hosts.forEach((d, i) => {
    const games = queries[i].data ?? cached[d.id];
    if (games) found[d.id] = games;
  });
  remote.forEach((d, i) => {
    const games = fromServer[i] ?? cached[d.id];
    if (games) found[d.id] = forThisDevice(games);
  });
  const serverDown = libraries.query.isError;
  return {
    games: mergeLibrary(found, kept, lastPlayed),
    // Loading only when there is nothing to show yet: the cache counts.
    loading:
      hosts.some((d, i) => queries[i].isLoading && !cached[d.id]) || (libraries.query.isLoading && remote.some((d) => !cached[d.id])),
    /** Hosts that did not answer, to say why their games are missing. */
    unreachable: [
      ...hosts.filter((_, i) => queries[i].isError).map((d) => d.name),
      ...(serverDown ? remote.filter((d) => !cached[d.id]).map((d) => d.name) : []),
    ],
    /** Rescans the disks of this machine (a game was just installed); the others send theirs to the server. */
    refresh: () =>
      Promise.all([
        ...hosts.map(async (device, i) => {
          await new AgentClient(device).games(true);
          await queries[i].refetch();
        }),
        ...(remote.length ? [libraries.query.refetch()] : []),
      ]),
  };
}

export function useGame(id?: string) {
  const { games } = useLibrary();
  return id ? games.find((g) => g.id === id) : undefined;
}

export function useDevice(id?: string) {
  return useWaken((s) => s.devices.find((d) => d.id === id));
}

/**
 * Official picture from the game's host (SteamGridDB or Steam, cached by the agent). Phones take the light
 * version, desktops the full one. Undefined when there is none: the tile then writes the title. "Bureau" (the
 * computer's desktop) has Waken's own picture.
 */
export function useGameArt(game: Game | undefined, kind: GameArtKind): ArtSource | undefined {
  const device = useWaken((s) => s.devices.find((d) => d.id === game?.deviceId));
  if (game?.sunshineApp === 'Desktop') return kind === 'hero' || kind === 'cover' ? desktopArt[kind] : undefined;
  const path = game?.art?.[kind];
  // From the account's library: a public picture, loaded straight from its CDN.
  if (path?.startsWith('https://')) return { uri: path };
  if (!path || !device || !hasAgent(device)) return undefined;
  return new AgentClient(device).artSource(path, platform().form === 'phone');
}

/** Polls a device every 10 s. PlayStation status needs libchiaki discovery (V3): shown as unknown until then. */
export function useDeviceStatus(device?: Device): DeviceStatus {
  const q = useQuery({
    queryKey: ['status', device?.id, device?.stream?.agentUrl],
    enabled: !!device && device.kind !== 'playstation',
    refetchInterval: 10_000,
    queryFn: async (): Promise<DeviceStatus> => {
      const r = await checkDevice(device!);
      return r === 'online' ? 'online' : r === 'booting' ? 'waking' : 'offline';
    },
  });
  return q.data ?? 'unknown';
}

export function useSunshineInfo(device?: Device) {
  return useQuery({
    queryKey: ['sunshine', device?.id, device?.stream?.host],
    enabled: !!device?.stream,
    refetchInterval: 5000,
    queryFn: () => probeSunshine(device!.stream!.host, device!.stream!.sunshinePort),
  });
}

/** A machine's play totals (days in a row, time this month), shared by every device. */
export function useHostStats(device?: Device) {
  const libraries = useCloudLibraries();
  const fromCloud = !!device && libraries.fromCloud(device);
  const asked = useQuery({
    queryKey: ['stats', device?.id, device?.stream?.agentUrl],
    enabled: !!device && hasAgent(device) && !fromCloud,
    staleTime: 60_000,
    queryFn: () => new AgentClient(device!).stats(),
  }).data;
  return fromCloud ? libraries.of(device!)?.stats : asked;
}

/** The longest run of days played among the machines (each machine counts its own). */
export function useBestStreak(devices: Device[]): number {
  const libraries = useCloudLibraries();
  const hosts = devices.filter((d) => hasAgent(d) && !libraries.fromCloud(d));
  const fromServer = devices.filter(libraries.fromCloud).map((d) => libraries.of(d)?.stats?.streakDays ?? 0);
  const queries = useQueries({
    queries: hosts.map((device) => ({
      queryKey: ['stats', device.id, device.stream?.agentUrl],
      staleTime: 60_000,
      queryFn: () => new AgentClient(device).stats(),
    })),
  });
  return Math.max(0, ...fromServer, ...queries.map((q) => q.data?.streakDays ?? 0));
}

/** "45 min", "12 h": play time the way the mockups show it. */
export function formatPlayTime(seconds = 0): string {
  if (seconds < 3600) return `${Math.max(1, Math.round(seconds / 60))} min`;
  return `${Math.round(seconds / 3600)} h`;
}

/**
 * Keeps the library fresh for every screen, mounted once at the app's root: asks again as soon as the Waken
 * network is up, when a machine comes online, and when the app comes back to the front. Without it, the home
 * screen kept the failed answer of its first try (made before the network was ready) for a while.
 */
export function useLibrarySync() {
  const queryClient = useQueryClient();
  useLibrary();
  const running = useNetwork((s) => s.status?.state === 'running');
  const online = useNetwork((s) => (s.status?.hosts ?? []).filter((h) => h.online).map((h) => h.name).join());
  useEffect(() => {
    if (running) void queryClient.invalidateQueries({ queryKey: ['games'] });
  }, [running, online, queryClient]);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next !== 'active') return;
      void queryClient.invalidateQueries({ queryKey: ['games'] });
      void queryClient.invalidateQueries({ queryKey: ['cloud-library'] });
    });
    return () => sub.remove();
  }, [queryClient]);
}
