import { useEffect } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import { AgentClient, checkDevice, mergeLibrary, probeSunshine, type Device, type Game, type GameArtKind, type HostGame } from '@waken/core';
import type { ArtSource, DeviceStatus } from '@waken/ui';
import { useShallow } from 'zustand/react/shallow';
import { platform } from './platform';
import { useLibraryCache } from './libraryCache';
import { useWaken } from './store';

const hasAgent = (d: Device) => !!d.stream?.agentUrl && !!d.stream.agentToken;

/** The games found on every host that has an agent, merged with the entries kept in the app. */
export function useLibrary() {
  const hosts = useWaken(useShallow((s) => s.devices.filter(hasAgent)));
  const kept = useWaken((s) => s.games);
  const lastPlayed = useWaken((s) => s.lastPlayed);
  const queries = useQueries({
    queries: hosts.map((device) => ({
      queryKey: ['games', device.id, device.stream?.agentUrl],
      staleTime: 5 * 60_000,
      retry: 1,
      // A machine that just started (or was off) answers a bit later: ask again until it does, then each minute.
      refetchInterval: (query: { state: { status: string } }) => (query.state.status === 'error' ? 5_000 : 60_000),
      queryFn: () => new AgentClient(device).games(),
    })),
  });
  const cached = useLibraryCache((s) => s.libraries);
  const save = useLibraryCache((s) => s.save);
  // Fresh libraries replace the cached ones; a machine that does not answer keeps its last known list.
  const fresh = queries.map((q) => q.data);
  useEffect(() => {
    hosts.forEach((d, i) => {
      if (fresh[i] && fresh[i] !== cached[d.id]) save(d.id, fresh[i]!);
    });
    // Each time a machine answers anew (its stats change too, not only its list of games).
  }, [queries.map((q) => q.dataUpdatedAt).join(), hosts.length]);
  const found: Record<string, HostGame[]> = {};
  hosts.forEach((d, i) => {
    const games = queries[i].data ?? cached[d.id];
    if (games) found[d.id] = games;
  });
  return {
    games: mergeLibrary(found, kept, lastPlayed),
    // Loading only when there is nothing to show yet: the cache counts.
    loading: hosts.some((d, i) => queries[i].isLoading && !cached[d.id]),
    /** Hosts that did not answer, to say why their games are missing. */
    unreachable: hosts.filter((_, i) => queries[i].isError).map((d) => d.name),
    /** Rescans the disks of every host (a game was just installed). */
    refresh: () =>
      Promise.all(
        hosts.map(async (device, i) => {
          await new AgentClient(device).games(true);
          await queries[i].refetch();
        })
      ),
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
 * version, desktops the full one. Undefined when there is none: the tile then writes the title.
 */
export function useGameArt(game: Game | undefined, kind: GameArtKind): ArtSource | undefined {
  const device = useWaken((s) => s.devices.find((d) => d.id === game?.deviceId));
  const path = game?.art?.[kind];
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
  return useQuery({
    queryKey: ['stats', device?.id, device?.stream?.agentUrl],
    enabled: !!device && hasAgent(device),
    staleTime: 60_000,
    queryFn: () => new AgentClient(device!).stats(),
  }).data;
}

/** The longest run of days played among the machines (each machine counts its own). */
export function useBestStreak(devices: Device[]): number {
  const hosts = devices.filter(hasAgent);
  const queries = useQueries({
    queries: hosts.map((device) => ({
      queryKey: ['stats', device.id, device.stream?.agentUrl],
      staleTime: 60_000,
      queryFn: () => new AgentClient(device).stats(),
    })),
  });
  return Math.max(0, ...queries.map((q) => q.data?.streakDays ?? 0));
}

/** "45 min", "12 h": play time the way the mockups show it. */
export function formatPlayTime(seconds = 0): string {
  if (seconds < 3600) return `${Math.max(1, Math.round(seconds / 60))} min`;
  return `${Math.round(seconds / 3600)} h`;
}
