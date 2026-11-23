import type { ImageStyle, StyleProp, ViewStyle } from 'react-native';

/** A bundled picture (require), a URL, or a URL fetched with headers (the agent's token, never in the URL). */
export type ArtSource = number | string | { uri: string; headers?: Record<string, string> };

export interface ArtProps {
  source: ArtSource;
  style?: StyleProp<ImageStyle>;
  /** cover fills and crops, contain shows all of it (logos). */
  fit?: 'cover' | 'contain';
  /** Where a contained picture sits: logos sit bottom left over the banner. */
  align?: 'center' | 'left bottom';
  onError?: () => void;
  accessibilityLabel?: string;
}

export interface GlassProps {
  style?: StyleProp<ViewStyle>;
  intensity?: number;
  children?: React.ReactNode;
}
