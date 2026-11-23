/**
 * Query string carrying the game to the wake and stream screens. The Sunshine app name travels with it,
 * so a launch never depends on the library being loaded (it would fall back to the desktop).
 */
export function launchQuery(gameId?: string, app?: string) {
  const params = [gameId ? `game=${encodeURIComponent(gameId)}` : '', app ? `app=${encodeURIComponent(app)}` : ''].filter(Boolean);
  return params.length ? `?${params.join('&')}` : '';
}
