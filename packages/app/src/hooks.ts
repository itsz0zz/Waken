import { useQueries, useQuery } from '@tanstack/react-query';
import { AgentClient, checkDevice, mergeLibrary, probeSunshine, type Device, type Game, type GameArtKind, type HostGame } from '@waken/core';
import type { ArtSource, DeviceStatus } from '@waken/ui';
import { useShallow } from 'zustand/react/shallow';
import { platform } from './platform';
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
      queryFn: () => new AgentClient(device).games(),
    })),
  });
  const found: Record<string, HostGame[]> = {};
  hosts.forEach((d, i) => {
    if (queries[i].data) found[d.id] = queries[i].data!;
  });
  return {
    games: mergeLibrary(found, kept, lastPlayed),
    loading: queries.some((q) => q.isLoading),
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
