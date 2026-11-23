import React from 'react';
import { RefreshControl, ScrollView, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors, FadeIn, ScreenGround, type Ground } from '@waken/ui';
import { useFrame } from '../nav';

/** A screen: its gradient ground, then content that scrolls under the app's own chrome (notch, dock, title bar). */
export function Screen({
  ground,
  children,
  scroll = true,
  maxWidth = 1100,
  refreshing,
  onRefresh,
  contentStyle,
}: {
  ground: Ground;
  children: React.ReactNode;
  scroll?: boolean;
  maxWidth?: number;
  refreshing?: boolean;
  onRefresh?: () => void;
  contentStyle?: StyleProp<ViewStyle>;
}) {
  const frame = useFrame();
  const padding: ViewStyle = { paddingTop: frame.top + 14, paddingBottom: frame.bottom + 24, paddingHorizontal: frame.wide ? 40 : 20 };
  const inner: StyleProp<ViewStyle> = [{ width: '100%', maxWidth, alignSelf: 'center' }, contentStyle];
  return (
    <View style={{ flex: 1, backgroundColor: colors.white }}>
      <ScreenGround ground={ground} />
      {scroll ? (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={padding}
          keyboardShouldPersistTaps="handled"
          refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={colors.ink} /> : undefined}
        >
          {/* Each screen arrives: a short fade and rise, the ground stays put. */}
          <FadeIn style={inner}>{children}</FadeIn>
        </ScrollView>
      ) : (
        <View style={[{ flex: 1 }, padding]}>
          <FadeIn style={[inner, { flex: 1 }]}>{children}</FadeIn>
        </View>
      )}
    </View>
  );
}
