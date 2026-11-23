import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { AppMark, nativeDriver, ScreenGround, Wordmark } from '@waken/ui';

/** Long enough to see the logo land, short enough not to be in the way. */
const MIN_MS = 1100;

/**
 * The boot screen, laid over the app while it loads: the W lands with a bounce and a twist, WAKEN fades in
 * under it, the W breathes until everything is ready, then the whole screen fades away on the home screen.
 */
export function BootScreen({ ready }: { ready: boolean }) {
  const [gone, setGone] = useState(false);
  const enter = useRef(new Animated.Value(0)).current;
  const word = useRef(new Animated.Value(0)).current;
  const breath = useRef(new Animated.Value(0)).current;
  const leave = useRef(new Animated.Value(1)).current;
  const shownAt = useRef(Date.now()).current;

  useEffect(() => {
    Animated.sequence([
      Animated.spring(enter, { toValue: 1, useNativeDriver: nativeDriver, speed: 9, bounciness: 14 }),
      Animated.timing(word, { toValue: 1, duration: 280, easing: Easing.out(Easing.cubic), useNativeDriver: nativeDriver }),
    ]).start();
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breath, { toValue: 1, duration: 650, easing: Easing.inOut(Easing.quad), useNativeDriver: nativeDriver }),
        Animated.timing(breath, { toValue: 0, duration: 650, easing: Easing.inOut(Easing.quad), useNativeDriver: nativeDriver }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [enter, word, breath]);

  useEffect(() => {
    if (!ready) return;
    const wait = Math.max(0, MIN_MS - (Date.now() - shownAt));
    const timer = setTimeout(() => {
      Animated.timing(leave, { toValue: 0, duration: 320, easing: Easing.in(Easing.quad), useNativeDriver: nativeDriver }).start(() => setGone(true));
    }, wait);
    return () => clearTimeout(timer);
  }, [ready, leave, shownAt]);

  if (gone) return null;
  const markScale = Animated.multiply(
    enter.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }),
    breath.interpolate({ inputRange: [0, 1], outputRange: [1, 1.05] })
  );
  return (
    <Animated.View
      pointerEvents={ready ? 'none' : 'auto'}
      accessibilityLabel="Waken démarre"
      style={[StyleSheet.absoluteFill, { opacity: leave, zIndex: 100 }]}
    >
      <ScreenGround ground="sun" />
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 22 }}>
        <Animated.View
          style={{
            opacity: enter,
            transform: [
              { scale: markScale },
              { rotate: enter.interpolate({ inputRange: [0, 0.6, 1], outputRange: ['-24deg', '8deg', '-6deg'] }) },
              { translateY: leave.interpolate({ inputRange: [0, 1], outputRange: [-16, 0] }) },
            ],
          }}
        >
          <AppMark size={132} />
        </Animated.View>
        <Animated.View style={{ opacity: word, transform: [{ translateY: word.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }] }}>
          <Wordmark height={34} />
        </Animated.View>
      </View>
    </Animated.View>
  );
}
