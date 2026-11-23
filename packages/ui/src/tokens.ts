import { fonts } from './fontNames';

/**
 * Waken design tokens, theme "Arcade" (mockups: claude.ai canvas "Waken, mockups macOS & iOS", page Arcade).
 * Bright gradient grounds, black ink, white cards, giant Anton titles, blue and lime accents.
 */
export const colors = {
  ink: '#0B0B0F',
  /** Secondary text on white and on the light end of the gradients. */
  ink2: '#3F424D',
  /** Disabled, "à venir", machine switched off. */
  muted: '#8A8D96',
  white: '#FFFFFF',
  /** Soft fill of chips and inactive segments on white cards. */
  soft: '#F1F2F6',
  /** Frosted white of the round buttons over a gradient. */
  frost: 'rgba(255,255,255,0.88)',
  frostLight: 'rgba(255,255,255,0.5)',
  /** Dark frosted surface of the in-game HUD, over the video. */
  glass: 'rgba(11,11,15,0.55)',
  glassLine: 'rgba(255,255,255,0.16)',
  /** Signature accents. */
  blue: '#2F7BFF',
  lime: '#C8FF2E',
  /** States. */
  online: '#1FBF6A',
  waking: '#FFB13D',
  hot: '#FF7A1A',
  danger: '#FF5A36',
  violet: '#7A5CFF',
  /** Pastels for avatars and illustrations. */
  sky: '#A6CBFF',
  lilac: '#D6CCFF',
  peach: '#FFC9AE',
} as const;

/** Each screen family has its own ground, always fading to white at the bottom. */
export const grounds = {
  /** Home, settings. 165 degrees. */
  sun: { colors: ['#EFFF3A', '#F6FF9E', '#FFFFFF'], locations: [0, 0.42, 1], angle: 165 },
  /** Games, game page, add a machine. */
  sky: { colors: ['#4E97FF', '#A6CBFF', '#FFFFFF'], locations: [0, 0.52, 1], angle: 180 },
  /** Machines, wake. */
  lime: { colors: ['#BDFF2E', '#E6FFA6', '#FFFFFF'], locations: [0, 0.5, 1], angle: 180 },
  /** Something went wrong. */
  ember: { colors: ['#FF8A5B', '#FFC9AE', '#FFFFFF'], locations: [0, 0.5, 1], angle: 180 },
} as const;

export type Ground = keyof typeof grounds;

export const space = { 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32, 12: 48 } as const;

export const radius = { chip: 9, md: 16, card: 24, art: 22, hero: 28, pill: 999 } as const;

/** Font family names: per platform (fontNames.ts, .macos.ts, .windows.ts). */
export { fonts };

export const type = {
  /** Giant uppercase screen title: "ON JOUE ?", "TES JEUX". Scale it with `size`. */
  display: { fontFamily: fonts.display, textTransform: 'uppercase', letterSpacing: -1 },
  /** "Réveille ta machine", "Ton PC se réveille". */
  title: { fontFamily: fonts.heavy, fontSize: 26, lineHeight: 32, letterSpacing: -0.5 },
  /** Game or machine name in a card. */
  headline: { fontFamily: fonts.heavy, fontSize: 18, lineHeight: 22 },
  body: { fontFamily: fonts.medium, fontSize: 15, lineHeight: 21 },
  label: { fontFamily: fonts.bold, fontSize: 15, lineHeight: 19 },
  caption: { fontFamily: fonts.semibold, fontSize: 12, lineHeight: 16 },
  chip: { fontFamily: fonts.heavy, fontSize: 12, lineHeight: 16 },
  button: { fontFamily: fonts.heavy, fontSize: 15, lineHeight: 19 },
} as const;

/** Card lift, tilted art lift. */
export const shadows = {
  card: { shadowColor: colors.ink, shadowOpacity: 0.08, shadowRadius: 11, shadowOffset: { width: 0, height: 8 }, elevation: 4 },
  lift: { shadowColor: colors.ink, shadowOpacity: 0.16, shadowRadius: 15, shadowOffset: { width: 0, height: 14 }, elevation: 8 },
} as const;

export type DeviceTint = 'pc' | 'playstation' | 'homelab';
