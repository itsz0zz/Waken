import { Tabs } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { House, LayoutGrid, Monitor, SlidersHorizontal, type LucideIcon } from 'lucide-react-native';
import { colors, fonts } from '@waken/ui';

const tabs: Record<string, { label: string; icon: LucideIcon }> = {
  index: { label: 'Accueil', icon: House },
  games: { label: 'Jeux', icon: LayoutGrid },
  devices: { label: 'Appareils', icon: Monitor },
  settings: { label: 'Réglages', icon: SlidersHorizontal },
};

/** Floating glass tab bar from the mockup: active tab is a neon pill with its label. */
export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  return (
    <Tabs
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: colors.bg0 } }}
      tabBar={({ state, navigateToTab }) => (
        <View style={[styles.wrap, { bottom: Math.max(insets.bottom, 12) }]}>
          <BlurView intensity={40} tint="dark" style={styles.bar}>
            {state.routes.map((route, i) => {
              const t = tabs[route.name];
              if (!t) return null;
              const active = state.index === i;
              const Icon = t.icon;
              return (
                <Pressable
                  key={route.key}
                  accessibilityRole="tab"
                  accessibilityLabel={t.label}
                  accessibilityState={{ selected: active }}
                  onPress={() => navigateToTab(route.key)}
                  style={[styles.tab, active && styles.tabActive]}
                >
                  <Icon size={active ? 18 : 22} color={active ? colors.neonInk : colors.ink2} strokeWidth={2.2} />
                  {active ? <Text style={styles.label}>{t.label}</Text> : null}
                </Pressable>
              );
            })}
          </BlurView>
        </View>
      )}
    >
      <Tabs.Screen name="index" />
      <Tabs.Screen name="games" />
      <Tabs.Screen name="devices" />
      <Tabs.Screen name="settings" />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 14, right: 14, alignItems: 'center' },
  bar: {
    width: '100%',
    maxWidth: 480,
    height: 64,
    paddingHorizontal: 8,
    borderRadius: 999,
    overflow: 'hidden',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(22,25,37,0.86)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  tab: { flex: 1, height: 48, borderRadius: 999, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6 },
  tabActive: { flex: 1.6, backgroundColor: colors.neon },
  label: { fontFamily: fonts.bold, fontSize: 13, color: colors.neonInk },
});
