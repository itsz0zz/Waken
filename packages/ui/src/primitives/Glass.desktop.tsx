import { View } from 'react-native';
import { colors } from '../tokens';
import type { GlassProps } from './types';

/** Desktop: a translucent surface. The window itself is opaque, a live blur would only blur our own background. */
export function Glass({ style, children }: GlassProps) {
  return <View style={[{ overflow: 'hidden', backgroundColor: colors.glass, borderWidth: 1, borderColor: colors.glassLine }, style]}>{children}</View>;
}
