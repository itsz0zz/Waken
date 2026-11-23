import { Image, View, type ImageSourcePropType } from 'react-native';
import type { ArtProps } from './types';

/**
 * Mac and Windows: React Native's own Image (no Expo there). It sends the headers of a { uri, headers } source,
 * so the agent's token stays out of the URL like on the phone.
 */
export function Art({ source, style, fit = 'cover', align = 'center', onError, accessibilityLabel }: ArtProps) {
  const image = (
    <Image
      source={(typeof source === 'string' ? { uri: source } : source) as ImageSourcePropType}
      style={[{ width: '100%', height: '100%' }, align === 'left bottom' ? null : style]}
      resizeMode={fit}
      onError={onError}
      accessibilityLabel={accessibilityLabel}
    />
  );
  if (align !== 'left bottom') return image;
  // resizeMode has no anchor: a contained logo is placed by its frame instead.
  return <View style={[style, { justifyContent: 'flex-end', alignItems: 'flex-start' }]}>{image}</View>;
}
