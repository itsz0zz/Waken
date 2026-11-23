import type { Game, HostGame } from './types';

/** Id of a host game in the app: the same game on two machines is two entries. */
export const hostGameId = (deviceId: string, game: HostGame) => `${deviceId}/${game.id}`;

/**
 * The library shown in the app: every game found on every host, plus the entries kept in the app
 * (the desktop, for instance). Sunshine launches by title, so a host game is its own Sunshine app;
 * a kept entry with the same app on the same host is a duplicate and is dropped.
 * Sorted by last played, then games before launchers, then by title.
 */
export function mergeLibrary(found: Record<string, HostGame[]>, kept: Game[], lastPlayed: Record<string, string>): Game[] {
  const games: Game[] = [];
  const seen = new Set<string>();
  const key = (deviceId: string, app: string) => `${deviceId}\n${app.toLocaleLowerCase()}`;

  for (const [deviceId, hostGames] of Object.entries(found)) {
    for (const g of hostGames) {
      if (seen.has(key(deviceId, g.title))) continue;
      seen.add(key(deviceId, g.title));
      const id = hostGameId(deviceId, g);
      games.push({
        id,
        title: g.title,
        deviceId,
        sunshineApp: g.title,
        store: g.store,
        art: { cover: g.cover, hero: g.hero, logo: g.logo, icon: g.icon },
        lastPlayedAt: lastPlayed[id],
      });
    }
  }
  for (const g of kept) {
    if (g.sunshineApp && seen.has(key(g.deviceId, g.sunshineApp))) continue;
    games.push({ ...g, lastPlayedAt: lastPlayed[g.id] ?? g.lastPlayedAt });
  }

  // Launchers (Steam Big Picture, CrossOver...) come after the games, unless one was played more recently.
  const launcher = (g: Game) => (g.store === 'Launcher' ? 1 : 0);
  return games.sort(
    (a, b) =>
      (b.lastPlayedAt ?? '').localeCompare(a.lastPlayedAt ?? '') ||
      launcher(a) - launcher(b) ||
      a.title.localeCompare(b.title, 'fr', { sensitivity: 'base' })
  );
}
