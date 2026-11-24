import type React from 'react';
import { requireNativeView, requireOptionalNativeModule } from 'expo';
import type { NativeSyntheticEvent, ViewProps } from 'react-native';

export type StreamState = { state: 'connecting' | 'streaming' | 'stopped' | 'error'; message?: string; stage?: string };
export type StreamStats = { rttMs: number; fps: number; bitrateKbps: number; droppedFrames: number };

/** What the Waken agent returns from POST /launch (it pairs and launches on the PC side). */
export interface LaunchInfo {
  address: string;
  appVersion: string;
  gfeVersion?: string;
  rtspSessionUrl: string;
  serverCodecModeSupport: number;
  /** 16-byte remote input AES key, hex. */
  riKey: string;
  riKeyId: number;
}

export interface StreamViewProps extends ViewProps {
  launch: LaunchInfo;
  /** Stream resolution. Not "width"/"height": React Native would also use those as the view's layout size. */
  videoWidth: number;
  videoHeight: number;
  fps: number;
  bitrateKbps: number;
  hevc: boolean;
  remote: boolean;
  /** The sound off, the picture on. */
  muted?: boolean;
  onStateChange?: (e: NativeSyntheticEvent<StreamState>) => void;
  onStats?: (e: NativeSyntheticEvent<StreamStats>) => void;
}

interface WakenStreamNative {
  stop(): void;
  toggleKeyboard?(): void;
}

const native = requireOptionalNativeModule<WakenStreamNative>('WakenStream');

/** False in Expo Go / web: the app then falls back to the Moonlight app (V1). */
export const isNativeStreamAvailable = native != null;

export const WakenStream = { stop: () => native?.stop(), toggleKeyboard: () => native?.toggleKeyboard?.() };

export const StreamView = (isNativeStreamAvailable ? requireNativeView<StreamViewProps>('WakenStream') : () => null) as React.ComponentType<StreamViewProps>;
