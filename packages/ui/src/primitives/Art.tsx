import { Image } from 'expo-image';
import type { ArtProps } from './types';

/** iPhone, iPad, Android: expo-image (disk cache, fade in). Desktop apps use Art.macos.tsx / Art.windows.tsx. */
export function Art({ source, style, fit = 'cover', align = 'center', onError, accessibilityLabel, blur }: ArtProps) {
  return (
    <Image
      source={source}
      style={style}
      contentFit={fit}
      contentPosition={align === 'left bottom' ? 'left bottom' : 'center'}
      transition={200}
      onError={onError}
      blurRadius={blur}
      accessibilityLabel={accessibilityLabel}
    />
  );
}
