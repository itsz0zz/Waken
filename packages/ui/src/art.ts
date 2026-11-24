import type { ArtSource } from './primitives/types';

/**
 * Waken's own pictures, for what has none: the computer's whole desktop ("Bureau", the Desktop app of Sunshine).
 * Drawn by docs/readme/render.swift, which also uses them in the README: rerun it to change them.
 */
export const desktopArt: { hero: ArtSource; cover: ArtSource } = {
  hero: require('../assets/art/desktop-hero.png'),
  cover: require('../assets/art/desktop-cover.png'),
};
