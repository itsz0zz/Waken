import { Animated, View, type ImageSourcePropType } from 'react-native';
import { useFadeOnLoad } from '../motion';
import type { ArtProps } from './types';

/**
 * Mac and Windows: React Native's own Image (no Expo there). It sends the headers of a { uri, headers } source,
 * so the agent's token stays out of the URL like on the phone.
 */
export function Art({ source, style, fit = 'cover', align = 'center', onError, accessibilityLabel }: ArtProps) {
  // React Native's Image pops in: fade it like expo-image does on the phone.
  const { opacity, onLoad } = useFadeOnLoad();
  const image = (
    <Animated.Image
      onLoad={onLoad}
      source={(typeof source === 'string' ? { uri: source } : source) as ImageSourcePropType}
      style={[{ width: '100%', height: '100%' }, align === 'left bottom' ? null : style, { opacity }]}
      resizeMode={fit}
      onError={onError}
      accessibilityLabel={accessibilityLabel}
    />
  );
  if (align !== 'left bottom') return image;
  // resizeMode has no anchor: a contained logo is placed by its frame instead.
  return <View style={[style, { justifyContent: 'flex-end', alignItems: 'flex-start' }]}>{image}</View>;
}
