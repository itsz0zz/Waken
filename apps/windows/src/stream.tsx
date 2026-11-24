import { playStationState, type PlayStationViewProps, type StreamViewProps } from '@waken/app';
import NativeStreamView from './WakenStreamViewNativeComponent';

/**
 * Playing from this PC on another of the owner's computers: the native view (Media Foundation and Direct3D for the
 * picture, this PC's keyboard, mouse and Xbox controllers), behind the shared screens' simpler props.
 */
export function StreamView({ launch, settings, remote, muted, onStateChange, onStats }: StreamViewProps) {
  return (
    <NativeStreamView
      style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      // Focusable: the keys go to the game while the stream has the focus.
      focusable
      address={launch.address}
      appVersion={launch.appVersion}
      gfeVersion={launch.gfeVersion}
      rtspSessionUrl={launch.rtspSessionUrl}
      riKey={launch.riKey}
      riKeyId={launch.riKeyId}
      serverCodecModeSupport={launch.serverCodecModeSupport}
      videoWidth={settings.width}
      videoHeight={settings.height}
      fps={settings.fps}
      bitrateKbps={settings.bitrate}
      hevc={settings.codec !== 'h264'}
      remote={remote}
      muted={muted ?? false}
      onStateChange={(e) => {
        const s = e.nativeEvent;
        if (s.state === 'error') onStateChange({ state: 'error', message: s.message ?? 'Erreur de stream' });
        else if (s.state === 'connecting') onStateChange({ state: 'connecting', stage: s.message });
        else if (s.state === 'streaming' || s.state === 'stopped') onStateChange({ state: s.state });
      }}
      onStats={(e) => onStats(e.nativeEvent)}
    />
  );
}

/** A linked PS5 or PS4 (chiaki): the same native view, given the console's link instead of a launch. */
export function PlayStationView({ link, settings, muted, onStateChange, onStats }: PlayStationViewProps) {
  const height = settings.height >= 1080 ? 1080 : 720;
  return (
    <NativeStreamView
      style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      address=""
      appVersion=""
      rtspSessionUrl=""
      riKey=""
      riKeyId={0}
      serverCodecModeSupport={0}
      videoWidth={height === 1080 ? 1920 : 1280}
      videoHeight={height}
      fps={settings.fps >= 60 ? 60 : 30}
      bitrateKbps={settings.bitrate}
      hevc={settings.codec !== 'h264'}
      remote={false}
      muted={muted ?? false}
      psHost={link.host}
      psRegistKey={link.registKey}
      psRpKey={link.rpKey}
      psAccountId={link.accountId ?? ''}
      psPs5={link.ps5}
      onStateChange={(e) => onStateChange(playStationState(e.nativeEvent))}
      onStats={(e) => onStats(e.nativeEvent)}
    />
  );
}
