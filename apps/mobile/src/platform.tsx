import * as SecureStore from 'expo-secure-store';
import { File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';
import { StreamView as NativeStreamView, WakenStream, isNativeStreamAvailable } from 'waken-stream';
import { isTunnelAvailable, WakenTunnel } from 'waken-tunnel';
import type { StreamViewProps, WakenPlatform } from '@waken/app';

/** The native stream view, behind the shared screens' simpler props. */
function StreamView({ launch, settings, remote, onStateChange, onStats }: StreamViewProps) {
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
      onStateChange={(e) => {
        const s = e.nativeEvent;
        onStateChange(s.state === 'error' ? { state: 'error', message: s.message ?? 'Erreur de stream' } : { state: s.state });
      }}
      onStats={(e) => onStats(e.nativeEvent)}
    />
  );
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
  StreamView: isNativeStreamAvailable ? StreamView : null,
  toggleKeyboard: isNativeStreamAvailable ? () => WakenStream.toggleKeyboard() : undefined,
  form: 'phone',
  deviceName: Platform.OS === 'ios' ? (Platform.isPad ? 'iPad' : 'iPhone') : 'Android',
  canUseMoonlightApp: true,
};
