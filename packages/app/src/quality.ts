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
