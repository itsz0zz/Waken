import { StyleSheet } from 'react-native';
import { BlurView } from 'expo-blur';
import type { GlassProps } from './types';

export function Glass({ style, intensity = 40, children }: GlassProps) {
  return (
    <BlurView intensity={intensity} tint="dark" style={[styles.glass, style]}>
      {children}
    </BlurView>
  );
}

const styles = StyleSheet.create({ glass: { overflow: 'hidden' } });
