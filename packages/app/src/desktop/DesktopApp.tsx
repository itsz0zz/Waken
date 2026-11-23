import { useEffect, useState, type ReactNode } from 'react';
import { Text, View } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { colors, fonts, PressScale, type, Wordmark } from '@waken/ui';
import { usePushRegistration } from '../account';
import { useLibrarySync } from '../hooks';
import { FrameContext, NavContext } from '../nav';
import { useNetworkRunner } from '../network';
import { useSessionRecaps } from '../recaps';
import { AccountOverlay } from '../screens/Account';
import { BootScreen } from '../screens/Boot';
import { GameScreen } from '../screens/Game';
import { GamesScreen } from '../screens/Games';
import { HomeScreen } from '../screens/Home';
import { MachineEditScreen } from '../screens/MachineEdit';
import { AccountButtons, NotificationsOverlay } from '../screens/Notifications';
import { AddMachineScreen, MachinesScreen } from '../screens/Machines';
import { GameSearch } from '../screens/Search';
import { SettingsScreen } from '../screens/Settings';
import { StreamScreen } from '../screens/Stream';
import { WakeScreen } from '../screens/Wake';
import { useConfigLoad, useWaken } from '../store';
import { tabs, useDesktopNav, type Route, type Tab } from './nav';

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const TOP_BAR = 96;
const labels: Record<Tab, string> = { home: 'Accueil', games: 'Jeux', machines: 'Machines', settings: 'Réglages' };

/** What the platform's host side reports: its services are up, and what still needs the user (a banner). */
export interface DesktopHost {
  up: boolean;
  banner: ReactNode;
}

/**
 * The desktop apps (Mac, Windows): boot screen, top bar with the tabs and the search, the shared screens.
 * useHost is the platform's own: it starts this computer's services and says what they need.
 * leftInset leaves room for the window's own buttons (the Mac's traffic lights).
 */
export function DesktopApp({ useHost, leftInset = 32 }: { useHost: () => DesktopHost; leftInset?: number }) {
  const config = useConfigLoad((s) => s.state);
  // The boot screen lays over the app until its configuration is read and its server has started (3 s at most).
  const [waited, setWaited] = useState(false);
  const [hostUp, setHostUp] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setWaited(true), 3000);
    return () => clearTimeout(timer);
  }, []);
  return (
    <View style={{ flex: 1, backgroundColor: colors.white }}>
      {config === 'loading' ? null : (
        <QueryClientProvider client={queryClient}>
          <Shell useHost={useHost} leftInset={leftInset} onHostUp={() => setHostUp(true)} />
        </QueryClientProvider>
      )}
      <BootScreen ready={config !== 'loading' && (hostUp || waited)} />
    </View>
  );
}

function Shell({ useHost, leftInset, onHostUp }: { useHost: () => DesktopHost; leftInset: number; onHostUp: () => void }) {
  useNetworkRunner();
  usePushRegistration();
  // This computer streams: the end of a session here sends its recap to the account's other devices.
  useSessionRecaps(useWaken((s) => s.devices.find((d) => d.local)));
  useLibrarySync();
  const { route, tab, nav } = useDesktopNav();
  const host = useHost();
  useEffect(() => {
    if (host.up) onHostUp();
  }, [host.up, onHostUp]);
  const immersive = route.name === 'stream';
  return (
    <NavContext.Provider value={nav}>
      <FrameContext.Provider value={{ top: immersive ? 0 : TOP_BAR + 12, bottom: 12, wide: true }}>
        <View style={{ flex: 1, backgroundColor: colors.white }}>
          <Content route={route} />
          {immersive ? null : (
            <View style={{ position: 'absolute', left: 0, right: 0, top: 0 }}>
              <TopBar tab={tab} leftInset={leftInset} onSelect={(t) => nav[t === 'home' ? 'home' : t === 'games' ? 'games' : t === 'machines' ? 'machines' : 'settings']()} />
              {host.banner}
            </View>
          )}
          <NotificationsOverlay />
          <AccountOverlay />
        </View>
      </FrameContext.Provider>
    </NavContext.Provider>
  );
}

function Content({ route }: { route: Route }) {
  switch (route.name) {
    case 'home':
      return <HomeScreen />;
    case 'games':
      return <GamesScreen query={route.query} />;
    case 'game':
      return <GameScreen gameId={route.gameId} />;
    case 'machines':
      return <MachinesScreen />;
    case 'machine':
      return <MachineEditScreen deviceId={route.deviceId} />;
    case 'add':
      return <AddMachineScreen />;
    case 'settings':
      return <SettingsScreen />;
    case 'wake':
      return <WakeScreen deviceId={route.deviceId} gameId={route.gameId} app={route.app} only={route.only} />;
    case 'stream':
      return <StreamScreen deviceId={route.deviceId} gameId={route.gameId} app={route.app} />;
  }
}

/** The Arcade top bar: wordmark, tabs in a frosted pill, and the game search. */
function TopBar({ tab, leftInset, onSelect }: { tab: Tab; leftInset: number; onSelect: (t: Tab) => void }) {
  return (
    <View style={{ height: TOP_BAR, flexDirection: 'row', alignItems: 'center', paddingLeft: leftInset, paddingRight: 44, gap: 16 }}>
      <Wordmark height={30} />
      <View style={{ flexDirection: 'row', gap: 2, marginLeft: 20, padding: 4, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.75)' }}>
        {tabs.map((t) => {
          const on = t === tab;
          return (
            <PressScale
              key={t}
              onPress={() => onSelect(t)}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              hoverTo={1.05}
              style={{ height: 44, paddingHorizontal: 18, borderRadius: 999, justifyContent: 'center', backgroundColor: on ? colors.ink : 'transparent' }}
            >
              <Text style={[type.button, { fontSize: 14, fontFamily: fonts.bold, color: on ? colors.white : colors.ink }]}>{labels[t]}</Text>
            </PressScale>
          );
        })}
      </View>
      <View style={{ flex: 1 }} />
      <GameSearch height={52} floating tone="frost" style={{ width: 300 }} />
      <AccountButtons />
    </View>
  );
}

/** Keeps this computer in the machine list, once the configuration is loaded and when its name or token changes. */
export function ensureLocalMachine(device: import('@waken/core').Device) {
  const { devices, upsertDevice } = useWaken.getState();
  const known = devices.find((d) => d.id === device.id);
  if (known?.stream?.agentToken === device.stream?.agentToken && known?.name === device.name) return;
  upsertDevice(device);
}
