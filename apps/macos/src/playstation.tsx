import { requireNativeComponent, type ViewProps } from 'react-native';
import { playStationNativeProps, type PlayStationViewProps } from '@waken/app';

/** The AppKit view (modules/waken-stream/macos/WakenPlayStationView.m): a PS5 / PS4 through chiaki. */
const NativePlayStationView = requireNativeComponent<ViewProps & ReturnType<typeof playStationNativeProps>>('WakenPlayStationView');

export function PlayStationView(props: PlayStationViewProps) {
  return <NativePlayStationView style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} {...playStationNativeProps(props)} />;
}
