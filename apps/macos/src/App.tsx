import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Monitor, MousePointer2, TriangleAlert } from 'lucide-react-native';
import {
  AddMachineScreen,
  FrameContext,
  GameScreen,
  GamesScreen,
  HomeScreen,
  MachineEditScreen,
  MachinesScreen,
  NavContext,
  SettingsScreen,
  StreamScreen,
  WakeScreen,
  setPlatform,
  useConfigLoad,
  useNetworkRunner,
} from '@waken/app';
import { colors, fonts, IconBubble, PillButton, shadows, StatusTag, type, Wordmark } from '@waken/ui';
import { host, hostTunnel, type HostStatus } from './host';
import { tabs, useDesktopNav, type Route, type Tab } from './nav';

setPlatform({
  storage: {
    getItem: (k) => host.storageGet(k),
    setItem: (k, v) => host.storageSet(k, v),
    removeItem: (k) => host.storageRemove(k),
  },
  tunnel: hostTunnel,
  // Playing FROM this Mac on another computer needs the AppKit stream view: next step.
  StreamView: null,
  form: 'desktop',
  deviceName: 'Mac',
});

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const TOP_BAR = 76;

const labels: Record<Tab, string> = { home: 'Accueil', games: 'Jeux', machines: 'Machines', settings: 'Réglages' };

export default function App() {
  const config = useConfigLoad((s) => s.state);
  if (config === 'loading') return <View style={{ flex: 1, backgroundColor: colors.white }} />;
  return (
    <QueryClientProvider client={queryClient}>
      <Shell />
    </QueryClientProvider>
  );
}

function Shell() {
  useNetworkRunner();
  const { route, tab, nav } = useDesktopNav();
  const hostStatus = useHostStatus();
  const immersive = route.name === 'stream';
  return (
    <NavContext.Provider value={nav}>
      <FrameContext.Provider value={{ top: immersive ? 0 : TOP_BAR + 12, bottom: 12, wide: true }}>
        <View style={{ flex: 1, backgroundColor: colors.white }}>
          <Content route={route} />
          {immersive ? null : (
            <View style={{ position: 'absolute', left: 0, right: 0, top: 0 }}>
              <TopBar tab={tab} onSelect={(t) => nav[t === 'home' ? 'home' : t === 'games' ? 'games' : t === 'machines' ? 'machines' : 'settings']()} status={hostStatus} />
              <HostBanner status={hostStatus} />
            </View>
          )}
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

/** The Arcade top bar of the Mac mockups: wordmark, four tabs, and this Mac's server state. */
function TopBar({ tab, onSelect, status }: { tab: Tab; onSelect: (t: Tab) => void; status: HostStatus | null }) {
  const ready = !!status?.sunshine && !!status.agent;
  return (
    <View style={{ height: TOP_BAR, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 32, gap: 28 }}>
      <Wordmark height={24} />
      <View style={{ flexDirection: 'row', gap: 6, flex: 1 }}>
        {tabs.map((t) => {
          const on = t === tab;
          return (
            <Pressable
              key={t}
              onPress={() => onSelect(t)}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              style={{ height: 40, paddingHorizontal: 18, borderRadius: 999, justifyContent: 'center', backgroundColor: on ? colors.ink : 'transparent' }}
            >
              <Text style={[type.button, { fontSize: 15, color: on ? colors.white : colors.ink }]}>{labels[t]}</Text>
            </Pressable>
          );
        })}
      </View>
      <StatusTag status={!status ? 'unknown' : ready ? 'online' : status.error ? 'unreachable' : 'waking'} label={!status ? 'Ce Mac…' : ready ? 'Ce Mac est prêt' : status.error ? 'Ce Mac : erreur' : 'Ce Mac démarre…'} />
    </View>
  );
}

/** What this Mac still needs before it can be played from elsewhere, asked in plain words. */
function HostBanner({ status }: { status: HostStatus | null }) {
  if (!status) return null;
  const items: { key: string; icon: typeof Monitor; text: string; action: string; onPress: () => void }[] = [];
  if (!status.embedded || status.error) {
    items.push({ key: 'error', icon: TriangleAlert, text: status.error ?? 'Le serveur de stream manque dans cette app.', action: 'Réessayer', onPress: () => void host.start() });
  }
  if (!status.screen) {
    items.push({ key: 'screen', icon: Monitor, text: "Autorise l'enregistrement de l'écran pour qu'on voie ce Mac depuis tes autres appareils.", action: 'Autoriser', onPress: () => void host.requestPermission('screen').then(() => host.openSettings('screen')) });
  }
  if (!status.control) {
    items.push({ key: 'control', icon: MousePointer2, text: 'Autorise le contrôle du Mac pour la souris et le clavier à distance.', action: 'Autoriser', onPress: () => void host.requestPermission('control').then(() => host.openSettings('control')) });
  }
  if (items.length === 0) return null;
  return (
    <View style={{ paddingHorizontal: 32, gap: 8 }}>
      {items.map((i) => (
        <View key={i.key} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, paddingLeft: 12, borderRadius: 999, backgroundColor: colors.white, ...shadows.card }}>
          <IconBubble icon={i.icon} color={colors.ink} fg={colors.lime} size={34} />
          <Text style={[type.label, { flex: 1, color: colors.ink, fontFamily: fonts.semibold }]}>{i.text}</Text>
          <PillButton label={i.action} size="sm" onPress={i.onPress} />
        </View>
      ))}
    </View>
  );
}

/** Polls this Mac's services and permissions; restarts the stream server once mouse control is granted. */
function useHostStatus() {
  const [status, setStatus] = useState<HostStatus | null>(null);
  const control = useRef<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    void host.start();
    const tick = async () => {
      try {
        const s = await host.status();
        if (!alive) return;
        // macOS only gives a new permission to processes started after it: restart Sunshine, not Waken.
        if (control.current === false && s.control && s.sunshine) void host.restartServer();
        control.current = s.control;
        setStatus(s);
      } catch {
        // The next tick tries again.
      }
    };
    void tick();
    const timer = setInterval(tick, 2000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);
  return status;
}
