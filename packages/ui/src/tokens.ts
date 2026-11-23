/**
 * Waken design tokens — mirror of the "Waken" design system (theme Nuit).
 * Keep names identical to the design system so designers and code speak the same language.
 */
export const colors = {
  bg0: '#07080C',
  bg1: '#0E1017',
  bg2: '#161925',
  bg3: '#20243A',
  line: '#2A2F45',
  ink: '#F4F5FA',
  ink2: '#A9AEC4',
  ink3: '#6F7590',
  /** Signature colour: primary button, logo, active tab, progress. */
  neon: '#FF3D7F',
  /** Text and icons placed on `neon`. */
  neonInk: '#0A0B10',
  violet: '#8B6CFF',
  blue: '#3D8BFF',
  teal: '#2FD3C1',
  online: '#34E39B',
  waking: '#FFB13D',
  offline: '#6F7590',
  danger: '#FF7A45',
  glass: 'rgba(16,18,28,0.62)',
  glassLine: 'rgba(255,255,255,0.14)',
  /** Secondary text over artwork (lighter than ink2 for contrast on images). */
  onArt: '#C9CDDD',
} as const;

export const space = { 1: 4, 2: 8, 3: 12, 4: 16, 6: 24, 8: 32, 12: 48 } as const;

export const radius = { sm: 10, md: 16, lg: 24, xl: 32, pill: 999 } as const;

export const fonts = {
  display: 'Unbounded_700Bold',
  displaySemi: 'Unbounded_600SemiBold',
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
  mono: 'JetBrainsMono_600SemiBold',
} as const;

export const type = {
  displayXl: { fontFamily: fonts.display, fontSize: 56, lineHeight: 60, letterSpacing: -1.5 },
  displayL: { fontFamily: fonts.display, fontSize: 40, lineHeight: 44, letterSpacing: -1 },
  title: { fontFamily: fonts.displaySemi, fontSize: 22, lineHeight: 28, letterSpacing: -0.3 },
  headline: { fontFamily: fonts.semibold, fontSize: 17, lineHeight: 24 },
  body: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 22 },
  caption: { fontFamily: fonts.medium, fontSize: 13, lineHeight: 18 },
  overline: { fontFamily: fonts.bold, fontSize: 11, lineHeight: 14, letterSpacing: 1.2 },
  metric: { fontFamily: fonts.mono, fontSize: 20, lineHeight: 24 },
  metricS: { fontFamily: fonts.mono, fontSize: 12, lineHeight: 16 },
} as const;

export const shadows = {
  glowNeon: {
    shadowColor: colors.neon,
    shadowOpacity: 0.35,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
} as const;

export type DeviceTint = 'pc' | 'playstation' | 'homelab';
export const deviceTint: Record<DeviceTint, { bg: string; fg: string }> = {
  pc: { bg: colors.violet, fg: '#FFFFFF' },
  playstation: { bg: colors.blue, fg: '#FFFFFF' },
  homelab: { bg: colors.teal, fg: colors.neonInk },
};
