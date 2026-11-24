import * as AppleAuthentication from 'expo-apple-authentication';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';
import { Gamepads, PlayStation, PlayStationView as NativePlayStationView, isPlayStationViewAvailable, StreamView as NativeStreamView, WakenStream, isNativeStreamAvailable } from 'waken-stream';
import { isTunnelAvailable, sendMagicPacket, WakenTunnel } from 'waken-tunnel';
import { gamepadsFrom, playstationFrom, playStationNativeProps, type PlayStationViewProps, type StreamViewProps, type WakenPlatform } from '@waken/app';

/** The native stream view, behind the shared screens' simpler props. */
function StreamView({ launch, settings, remote, muted, smooth, onStateChange, onStats }: StreamViewProps) {
  return (
    <NativeStreamView
      style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      launch={launch}
      videoWidth={settings.width}
      videoHeight={settings.height}
      fps={settings.fps}
      bitrateKbps={settings.bitrate}
      hevc={settings.codec !== 'h264'}
      remote={remote}
      muted={muted ?? false}
      smooth={smooth ?? true}
      onStateChange={(e) => {
        const s = e.nativeEvent;
        if (s.state === 'error') onStateChange({ state: 'error', message: s.message ?? 'Erreur de stream' });
        else if (s.state === 'connecting') onStateChange({ state: 'connecting', stage: s.stage });
        else onStateChange({ state: s.state });
      }}
      onStats={(e) => onStats(e.nativeEvent)}
    />
  );
}

/** The PS5 / PS4 stream view (chiaki). */
function PlayStationView(props: PlayStationViewProps) {
  return <NativePlayStationView style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} {...playStationNativeProps(props)} />;
}

// A notification arriving while Waken is open still shows (new device on the account, machine ready).
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
});

/** Asks once, then Apple's own token for this device (hex): the Waken server talks to APNs directly. */
async function pushToken(): Promise<string | null> {
  if (Platform.OS !== 'ios') return null;
  const current = await Notifications.getPermissionsAsync();
  const granted = current.granted || (current.canAskAgain && (await Notifications.requestPermissionsAsync()).granted);
  if (!granted) return null;
  const token = await Notifications.getDevicePushTokenAsync();
  return typeof token.data === 'string' ? token.data : null;
}

/** Apple's own sheet; null when the user closes it. */
async function appleSignIn() {
  try {
    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [AppleAuthentication.AppleAuthenticationScope.FULL_NAME, AppleAuthentication.AppleAuthenticationScope.EMAIL],
    });
    if (!credential.identityToken) throw new Error("Apple n'a pas renvoyé d'identité.");
    return { identityToken: credential.identityToken, authorizationCode: credential.authorizationCode };
  } catch (e) {
    if ((e as { code?: string }).code === 'ERR_REQUEST_CANCELED') return null;
    throw e;
  }
}

/** iPhone and iPad: Keychain for the configuration (it holds tokens), the tunnel and stream native modules. */
export const mobilePlatform: WakenPlatform = {
  storage: {
    getItem: (k) => SecureStore.getItemAsync(k),
    setItem: (k, v) => SecureStore.setItemAsync(k, v),
    removeItem: (k) => SecureStore.deleteItemAsync(k),
  },
  // The library cache: a file in the app's documents, nothing secret (titles, picture paths, play times).
  cacheStorage: {
    getItem: async (k) => {
      const file = new File(Paths.document, `${k}.json`);
      return file.exists ? file.text() : null;
    },
    setItem: (k, v) => new File(Paths.document, `${k}.json`).write(v),
    removeItem: (k) => {
      const file = new File(Paths.document, `${k}.json`);
      if (file.exists) file.delete();
    },
  },
  tunnel: isTunnelAvailable ? WakenTunnel : null,
  sendMagicPacket,
  gamepads: Gamepads ? gamepadsFrom(Gamepads) : undefined,
  playstation: PlayStation ? playstationFrom(PlayStation) : undefined,
  PlayStationView: isPlayStationViewAvailable ? PlayStationView : undefined,
  StreamView: isNativeStreamAvailable ? StreamView : null,
  toggleKeyboard: isNativeStreamAvailable ? () => WakenStream.toggleKeyboard() : undefined,
  form: 'phone',
  deviceName: Platform.OS === 'ios' ? (Platform.isPad ? 'iPad' : 'iPhone') : 'Android',
  canUseMoonlightApp: true,
  pushToken,
  pushPlatform: 'ios',
  appleSignIn: Platform.OS === 'ios' ? appleSignIn : undefined,
};
