import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Platform, Pressable, StyleSheet, View, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import { colors } from './tokens';

/**
 * Motion for every platform Waken runs on. React Native's own Animated (Reanimated does not run on Mac and Windows),
 * on the native thread where the platform has one for opacity and transforms.
 */
// macOS and Windows: the native driver does not run there (the content stayed at opacity 0 on the Mac).
export const nativeDriver = Platform.OS === 'ios' || Platform.OS === 'android';

/** Arrives softly: fades in while rising a few points. `delay` staggers the items of a list. */
export function FadeIn({ children, delay = 0, distance = 12, style }: { children: React.ReactNode; delay?: number; distance?: number; style?: StyleProp<ViewStyle> }) {
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(progress, { toValue: 1, duration: 320, delay, easing: Easing.out(Easing.cubic), useNativeDriver: nativeDriver }).start();
  }, [progress, delay]);
  return (
    <Animated.View
      style={[
        style,
        { opacity: progress, transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [distance, 0] }) }] },
      ]}
    >
      {children}
    </Animated.View>
  );
}

/** Stagger of a list: 40 ms between items, capped so a long list does not keep the last ones waiting. */
export const stagger = (index: number) => Math.min(index, 8) * 40;

/**
 * A pressable that lifts a little under the mouse (desktop), sinks under the finger or the click, and springs back.
 * The hand cursor says it is clickable on the Mac.
 */
export function PressScale({
  children,
  style,
  scaleTo = 0.96,
  hoverTo = 1.03,
  ...rest
}: PressableProps & { children: React.ReactNode; style?: StyleProp<ViewStyle>; scaleTo?: number; hoverTo?: number }) {
  const scale = useRef(new Animated.Value(1)).current;
  const hovered = useRef(false);
  const { outer, inner } = splitLayout(style);
  const to = (value: number) => Animated.spring(scale, { toValue: value, useNativeDriver: nativeDriver, speed: 40, bounciness: value >= 1 ? 8 : 0 }).start();
  const hover = rest as PressableProps & { onHoverIn?: (e: unknown) => void; onHoverOut?: (e: unknown) => void };
  return (
    <Pressable
      {...rest}
      {...({
        onHoverIn: (e: unknown) => {
          hovered.current = true;
          if (!rest.disabled) to(hoverTo);
          hover.onHoverIn?.(e);
        },
        onHoverOut: (e: unknown) => {
          hovered.current = false;
          to(1);
          hover.onHoverOut?.(e);
        },
      } as object)}
      onPressIn={(e) => {
        to(scaleTo);
        rest.onPressIn?.(e);
      }}
      onPressOut={(e) => {
        to(hovered.current ? hoverTo : 1);
        rest.onPressOut?.(e);
      }}
      style={[outer, rest.disabled ? null : ({ cursor: 'pointer' } as ViewStyle)]}
    >
      <Animated.View style={[inner, { transform: [{ scale }] }]}>{children}</Animated.View>
    </Pressable>
  );
}

/** Layout keys place the pressable itself; everything else (colours, padding, radius) is the animated surface. */
const layoutKeys = new Set([
  'flex', 'flexGrow', 'flexShrink', 'flexBasis', 'alignSelf', 'width', 'minWidth', 'maxWidth',
  // The height too: without it the pressable has none of its own and a row can stretch it (the Mac's top bar did).
  'height', 'minHeight', 'maxHeight',
  'margin', 'marginTop', 'marginBottom', 'marginLeft', 'marginRight', 'marginHorizontal', 'marginVertical',
  'position', 'top', 'left', 'right', 'bottom', 'zIndex',
]);

function splitLayout(style: StyleProp<ViewStyle>) {
  const flat = (StyleSheet.flatten(style) ?? {}) as Record<string, unknown>;
  const outer: Record<string, unknown> = {};
  const inner: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(flat)) (layoutKeys.has(key) ? outer : inner)[key] = value;
  // A sized pressable: the surface fills it.
  if ('width' in outer || 'height' in outer || 'flex' in outer || 'flexGrow' in outer) inner.flexGrow = 1;
  return { outer: outer as ViewStyle, inner: inner as ViewStyle };
}

/** One shared pulse for every skeleton on screen: they breathe together, like one surface loading. */
const pulse = new Animated.Value(0);
let pulseRunning = false;
function startPulse() {
  if (pulseRunning) return;
  pulseRunning = true;
  Animated.loop(
    Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: nativeDriver }),
      Animated.timing(pulse, { toValue: 0, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: nativeDriver }),
    ])
  ).start();
}

/** A placeholder block with the shape of what is loading. */
export function Skeleton({ width, height, radius = 12, style, onDark }: { width?: number | `${number}%`; height: number; radius?: number; style?: StyleProp<ViewStyle>; onDark?: boolean }) {
  useEffect(startPulse, []);
  return (
    <Animated.View
      accessibilityLabel="Chargement"
      style={[
        { width, height, borderRadius: radius, backgroundColor: onDark ? 'rgba(255,255,255,0.18)' : 'rgba(11,11,15,0.08)' },
        { opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1] }) },
        style,
      ]}
    />
  );
}

/** A picture that fades in once loaded instead of popping (desktop: React Native's Image has no transition). */
export function useFadeOnLoad() {
  const opacity = useRef(new Animated.Value(0)).current;
  const onLoad = () => Animated.timing(opacity, { toValue: 1, duration: 220, useNativeDriver: nativeDriver }).start();
  return { opacity, onLoad };
}

export const skeletonColors = { light: 'rgba(11,11,15,0.08)', dark: colors.glassLine };

/* ---------- Skeletons with the shape of what they stand for ---------- */

/** Stands for a GameRow while the library loads. */
export function GameRowSkeleton() {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 9, paddingLeft: 10, paddingRight: 12, borderRadius: 24, backgroundColor: colors.white }}>
      <Skeleton width={90} height={66} radius={16} />
      <View style={{ flex: 1, gap: 8 }}>
        <Skeleton width="60%" height={18} radius={6} />
        <Skeleton width={96} height={26} radius={9} />
      </View>
      <Skeleton width={46} height={46} radius={23} />
    </View>
  );
}

/** Stands for a tilted cover (home cards, desktop grid). */
export function CoverSkeleton({ width, height, rotate = -4 }: { width: number; height: number; rotate?: number }) {
  return (
    <View style={{ width, height, borderRadius: 22, borderWidth: 6, borderColor: colors.white, backgroundColor: colors.white, transform: [{ rotate: `${rotate}deg` }] }}>
      <Skeleton height={height - 12} radius={16} />
    </View>
  );
}
