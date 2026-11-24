import type { StreamSettings } from '@waken/core';

/** The three image qualities of the Settings screen. Codec stays HEVC: every Waken host encodes it. */
export type Quality = 'eco' | 'balanced' | 'max';

export const qualities: Record<Quality, { label: string; settings: StreamSettings }> = {
  eco: { label: 'Éco', settings: { width: 1280, height: 720, fps: 60, bitrate: 6_000, codec: 'hevc' } },
  balanced: { label: 'Équilibrée', settings: { width: 1920, height: 1080, fps: 60, bitrate: 20_000, codec: 'hevc' } },
  max: { label: 'Max', settings: { width: 2560, height: 1440, fps: 120, bitrate: 50_000, codec: 'hevc' } },
};

/** The quality a saved setting is closest to (settings saved before the three presets existed). */
export function qualityOf(s: StreamSettings): Quality {
  if (s.height <= 720) return 'eco';
  if (s.height <= 1080) return 'balanced';
  return 'max';
}

/** Full quality needs a direct path; a relayed one gets this much at most. */
export function forPath(chosen: StreamSettings, path: 'direct' | 'relayed'): StreamSettings {
  if (path === 'direct') return chosen;
  const eco = qualities.eco.settings;
  return { ...chosen, width: Math.min(chosen.width, eco.width), height: Math.min(chosen.height, eco.height), fps: Math.min(chosen.fps, eco.fps), bitrate: Math.min(chosen.bitrate, eco.bitrate) };
}

/** Screen sizes a physical screen takes (or its graphics card scales to), by shape. */
const standardModes: [number, number][] = [
  [1280, 720], [1600, 900], [1920, 1080], [2560, 1440], [3840, 2160], // 16:9
  [1280, 800], [1440, 900], [1680, 1050], [1920, 1200], [2560, 1600], // 16:10
  [2560, 1080], [3440, 1440], // 21:9
  [1024, 768], [1600, 1200], // 4:3
];

/**
 * The size to ask a PC for, so that its picture has the shape of the window showing it (no black bars): the
 * standard size of the nearest shape with about the pixels of the chosen quality. The PC's screen takes that size
 * for the stream (Sunshine's dd_resolution_option), as with Parsec. A Mac keeps its own screen: not for Macs.
 */
export function fitToWindow(settings: StreamSettings, windowWidth: number, windowHeight: number): StreamSettings {
  if (windowWidth <= 0 || windowHeight <= 0) return settings;
  const aspect = windowWidth / windowHeight;
  const shape = (m: [number, number]) => m[0] / m[1];
  const nearest = standardModes.reduce((best, m) => (Math.abs(shape(m) - aspect) < Math.abs(shape(best) - aspect) ? m : best));
  const sameShape = standardModes.filter((m) => Math.abs(shape(m) - shape(nearest)) < 0.01);
  const pixels = settings.width * settings.height;
  const [width, height] = sameShape.reduce((best, m) => (Math.abs(m[0] * m[1] - pixels) < Math.abs(best[0] * best[1] - pixels) ? m : best));
  return { ...settings, width, height };
}
