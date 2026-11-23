import { describe, expect, it } from 'vitest';
import { mergeLibrary, type HostGame } from '../src';

const host = (id: string, title: string): HostGame => ({
  id,
  title,
  store: 'Steam',
  cover: `/games/${id}/cover`,
  hero: `/games/${id}/hero`,
  logo: `/games/${id}/logo`,
  icon: `/games/${id}/icon`,
});

describe('mergeLibrary', () => {
  it('lists every host game with its art, launched by its title', () => {
    const [game] = mergeLibrary({ pc: [host('steam:620', 'Portal 2')] }, [], {});
    expect(game).toMatchObject({ id: 'pc/steam:620', deviceId: 'pc', sunshineApp: 'Portal 2', store: 'Steam' });
    expect(game.art?.hero).toBe('/games/steam:620/hero');
  });

  it('keeps the same game on two hosts as two entries', () => {
    const games = mergeLibrary({ pc: [host('steam:620', 'Portal 2')], mac: [host('steam:620', 'Portal 2')] }, [], {});
    expect(games.map((g) => g.id).sort()).toEqual(['mac/steam:620', 'pc/steam:620']);
  });

  it('keeps entries added in the app unless the host already lists that app', () => {
    const kept = [
      { id: 'desktop', title: 'Bureau', deviceId: 'pc', sunshineApp: 'Desktop' },
      { id: 'old-portal', title: 'Portal', deviceId: 'pc', sunshineApp: 'portal 2' },
    ];
    const games = mergeLibrary({ pc: [host('steam:620', 'Portal 2')] }, kept, {});
    expect(games.map((g) => g.id)).toEqual(['desktop', 'pc/steam:620']);
  });

  it('puts the last played first, then sorts by title', () => {
    const games = mergeLibrary(
      { pc: [host('a', 'Zelda'), host('b', 'astro'), host('c', 'Hades')] },
      [],
      { 'pc/a': '2026-11-20T10:00:00Z' }
    );
    expect(games.map((g) => g.title)).toEqual(['Zelda', 'astro', 'Hades']);
  });

  it('lists a host game once when the host reports it twice', () => {
    expect(mergeLibrary({ pc: [host('steam:1', 'Hades'), host('epic:2', 'HADES')] }, [], {})).toHaveLength(1);
  });
});
