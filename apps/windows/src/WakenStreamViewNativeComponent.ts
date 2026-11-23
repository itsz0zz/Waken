import { codegenNativeComponent, type CodegenTypes, type HostComponent, type ViewProps } from 'react-native';

/**
 * The stream view of the Windows app (windows/Waken/Stream/StreamView.cpp). The launch comes as plain props:
 * React Native's static view config is generated from this file (the name must end in NativeComponent).
 */
type StateEvent = Readonly<{ state: string; message?: string }>;
type StatsEvent = Readonly<{
  rttMs: CodegenTypes.Double;
  fps: CodegenTypes.Double;
  bitrateKbps: CodegenTypes.Double;
  droppedFrames: CodegenTypes.Double;
}>;

export interface NativeProps extends ViewProps {
  address: string;
  appVersion: string;
  gfeVersion?: string;
  rtspSessionUrl: string;
  riKey: string;
  riKeyId: CodegenTypes.Int32;
  serverCodecModeSupport: CodegenTypes.Int32;
  videoWidth: CodegenTypes.Int32;
  videoHeight: CodegenTypes.Int32;
  fps: CodegenTypes.Int32;
  bitrateKbps: CodegenTypes.Int32;
  hevc: boolean;
  remote: boolean;
  onStateChange?: CodegenTypes.DirectEventHandler<StateEvent>;
  onStats?: CodegenTypes.DirectEventHandler<StatsEvent>;
}

export default codegenNativeComponent<NativeProps>('WakenStreamView') as HostComponent<NativeProps>;
