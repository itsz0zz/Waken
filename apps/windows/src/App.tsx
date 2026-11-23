import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { TriangleAlert } from 'lucide-react-native';
import { DesktopApp, ensureLocalMachine, setPlatform } from '@waken/app';
import { colors, fonts, IconBubble, PillButton, shadows, type } from '@waken/ui';
import { hostStatus, hostTunnel, localDevice, native, type HostStatus } from './host';
import { StreamView } from './stream';

setPlatform({
  // The app's folder in the user's profile (%LOCALAPPDATA%\Waken\app): one file per key.
  storage: {
    getItem: (k) => native.storageGet(k),
    setItem: (k, v) => native.storageSet(k, v),
    removeItem: (k) => native.storageRemove(k),
  },
  cacheStorage: {
    getItem: (k) => native.storageGet(k),
    setItem: (k, v) => native.storageSet(k, v),
    removeItem: (k) => native.storageRemove(k),
  },
  tunnel: hostTunnel,
  // Playing from this PC on another computer: the native view, through the Waken network on ::1.
  StreamView,
  setFullscreen: (on) => native.setFullscreen(on),
  form: 'desktop',
  deviceName: 'PC',
});

/** The Windows app: the shared desktop app, with this PC's services. */
export default function App() {
  return <DesktopApp useHost={useWindowsHost} />;
}

function useWindowsHost() {
  const status = useHostStatus();
  return { up: !!status?.sunshine && !!status.agent, banner: <HostBanner status={status} /> };
}

/** Windows asks no permission for the screen or the input: only a service that would not start shows here. */
function HostBanner({ status }: { status: HostStatus | null }) {
  if (!status) return null;
  const problem = !status.embedded ? 'Le serveur de stream manque dans cette app : reconstruis-la avec scripts\\build.ps1.' : status.error;
  if (!problem) return null;
  return (
    <View style={{ paddingHorizontal: 32 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, paddingLeft: 12, borderRadius: 999, backgroundColor: colors.white, ...shadows.card }}>
        <IconBubble icon={TriangleAlert} color={colors.ink} fg={colors.lime} size={34} />
        <Text style={[type.label, { flex: 1, color: colors.ink, fontFamily: fonts.semibold }]}>{problem}</Text>
        <PillButton label="Réessayer" size="sm" onPress={() => void native.start()} />
      </View>
    </View>
  );
}

/** Polls this PC's services every 2 seconds; keeps this PC in the machine list. */
function useHostStatus() {
  const [status, setStatus] = useState<HostStatus | null>(null);
  useEffect(() => {
    let alive = true;
    void native.start();
    const tick = async () => {
      try {
        const s = await hostStatus();
        if (!alive) return;
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
