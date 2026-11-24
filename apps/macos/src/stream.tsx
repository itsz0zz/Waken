import { requireNativeComponent, type NativeSyntheticEvent, type ViewProps } from 'react-native';
import type { LaunchInfo, StreamStats, StreamViewProps } from '@waken/app';

type NativeState = { state: 'connecting' | 'streaming' | 'stopped' | 'error'; message?: string; stage?: string };
type NativeStats = StreamStats;

/** The AppKit view (modules/waken-stream/macos): the iPhone's stream code, with the Mac's keyboard and mouse. */
const NativeStreamView = requireNativeComponent<
  ViewProps & {
    launch: LaunchInfo;
    videoWidth: number;
    videoHeight: number;
    fps: number;
    bitrateKbps: number;
    hevc: boolean;
    remote: boolean;
    muted: boolean;
    smooth: boolean;
    paused: boolean;
    onStateChange: (e: NativeSyntheticEvent<NativeState>) => void;
    onStats: (e: NativeSyntheticEvent<NativeStats>) => void;
  }
>('WakenStreamView');

/** Playing from this Mac on another of the owner's computers, behind the shared screens' simpler props. */
export function StreamView({ launch, settings, remote, muted, paused, smooth, onStateChange, onStats }: StreamViewProps) {
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
      paused={paused ?? false}
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
