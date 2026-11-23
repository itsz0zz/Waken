import { useContext } from 'react';
import { View } from 'react-native';
import { Tabs } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { House, LayoutGrid, Monitor, Power, SlidersHorizontal } from 'lucide-react-native';
import { FrameContext, useLibrary, useNav } from '@waken/app';
import { NavDock } from '@waken/ui';

const DOCK_HEIGHT = 76;
const DOCK_GAP = 30;
const routes = { home: 'index', games: 'games', machines: 'devices', settings: 'settings' } as const;

/** The arcade dock at the bottom: Accueil, Jeux | power | Machines, Réglages. */
export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  const frame = useContext(FrameContext);
  const nav = useNav();
  const { games } = useLibrary();
  const next = games[0];
  const bottom = Math.max(insets.bottom, DOCK_GAP);

  return (
    <FrameContext.Provider value={{ ...frame, bottom: bottom + DOCK_HEIGHT + 12 }}>
      <Tabs
        screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: 'transparent' } }}
        tabBar={({ state, navigateToTab }) => {
          const active = (Object.keys(routes) as (keyof typeof routes)[]).find((k) => routes[k] === state.routes[state.index]?.name) ?? 'home';
          return (
            <View style={{ position: 'absolute', left: 0, right: 0, bottom }}>
              <NavDock
                left={[
                  { key: 'home', label: 'Accueil', icon: House },
                  { key: 'games', label: 'Jeux', icon: LayoutGrid },
                ]}
                right={[
                  { key: 'machines', label: 'Machines', icon: Monitor },
                  { key: 'settings', label: 'Réglages', icon: SlidersHorizontal },
                ]}
                active={active}
                onSelect={(key) => {
                  const route = state.routes.find((r) => r.name === routes[key as keyof typeof routes]);
                  if (route) navigateToTab(route.key);
                }}
                center={{
                  icon: Power,
                  label: next ? `Jouer à ${next.title}` : 'Machines',
                  onPress: () => (next ? nav.play(next.deviceId, next.id, next.sunshineApp) : nav.machines()),
                }}
              />
            </View>
          );
        }}
      >
        <Tabs.Screen name="index" />
        <Tabs.Screen name="games" />
        <Tabs.Screen name="devices" />
        <Tabs.Screen name="settings" />
      </Tabs>
    </FrameContext.Provider>
  );
}
