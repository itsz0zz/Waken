import { useEffect, useRef, useState } from 'react';
import { NativeModules, Text, View } from 'react-native';
import { Monitor, MousePointer2, TriangleAlert } from 'lucide-react-native';
import { DesktopApp, ensureLocalMachine, gamepadsFrom, setPlatform, type NativeGamepads } from '@waken/app';
import { colors, fonts, IconBubble, PillButton, shadows, type } from '@waken/ui';
import { host, hostTunnel, localDevice, type HostStatus } from './host';
import { StreamView } from './stream';

setPlatform({
  storage: {
    getItem: (k) => host.storageGet(k),
    setItem: (k, v) => host.storageSet(k, v),
    removeItem: (k) => host.storageRemove(k),
  },
  // The app's private folder too: the cache has nothing secret, but one place for all its files.
  cacheStorage: {
    getItem: (k) => host.storageGet(k),
    setItem: (k, v) => host.storageSet(k, v),
    removeItem: (k) => host.storageRemove(k),
  },
  tunnel: hostTunnel,
  // Playing from this Mac on another computer: the AppKit view, through the Waken network on ::1.
  StreamView,
  form: 'desktop',
  deviceName: 'Mac',
  pushToken: () => host.pushToken(),
  appleSignIn: () => host.appleSignIn(),
  wifiInfo: () => host.wifiInfo(),
  copyText: (text) => host.copyText(text),
  pushPlatform: 'macos',
  // The Mac's controllers (MLGamepads, modules/waken-stream/macos/WakenGamepadsModule.m).
  gamepads: NativeModules.WakenGamepads ? gamepadsFrom(NativeModules.WakenGamepads as NativeGamepads) : undefined,
});


/** The Mac app: the shared desktop app, with this Mac's services and permissions. */
export default function App() {
  // Room for the traffic lights, at the window's top left.
  return <DesktopApp useHost={useMacHost} leftInset={44} />;
}

function useMacHost() {
  const status = useHostStatus();
  return { up: !!status?.sunshine && !!status.agent, banner: <HostBanner status={status} /> };
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
    <View style={{ paddingHorizontal: 44, gap: 8 }}>
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
        if (s.agentToken) ensureLocalMachine(localDevice(s.deviceName, s.agentToken));
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
