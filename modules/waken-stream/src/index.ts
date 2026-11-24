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
  gamepads?(): Promise<Record<string, unknown>[]>;
  testGamepad?(id: string): Promise<void>;
  setGamepadOptions?(rumble: number, motion: boolean, kind: string): void;
  discoverConsoles?(seconds: number): Promise<Record<string, unknown>[]>;
  registerConsole?(host: string, ps5: boolean, accountId: string, pin: string): Promise<Record<string, unknown>>;
  wakeConsole?(host: string, registKey: string, ps5: boolean): Promise<void>;
}

const native = requireOptionalNativeModule<WakenStreamNative>('WakenStream');

/** False in Expo Go / web: the app then falls back to the Moonlight app (V1). */
export const isNativeStreamAvailable = native != null;

export const WakenStream = { stop: () => native?.stop(), toggleKeyboard: () => native?.toggleKeyboard?.() };

/** PS5 and PS4 through chiaki (absent from a build older than these functions). */
export const PlayStation = native?.discoverConsoles
  ? {
      discover: (seconds: number) => native.discoverConsoles!(seconds),
      registerConsole: (host: string, ps5: boolean, accountId: string, pin: string) => native.registerConsole!(host, ps5, accountId, pin),
      wake: (host: string, registKey: string, ps5: boolean) => native.wakeConsole!(host, registKey, ps5),
    }
  : null;

/** The controllers of this iPhone or iPad (absent from a build older than these functions). */
export const Gamepads = native?.gamepads
  ? {
      list: () => native.gamepads!(),
      test: (id: string) => native.testGamepad!(id),
      setOptions: (rumble: number, motion: boolean, kind: string) => native.setGamepadOptions!(rumble, motion, kind),
    }
  : null;

/** The PS5 / PS4 stream view (chiaki), props as in packages/app's PlayStationViewProps, flattened. */
export interface PlayStationNativeProps extends ViewProps {
  link: Record<string, unknown>;
  videoHeight: number;
  fps: number;
  bitrateKbps: number;
  hevc: boolean;
  muted?: boolean;
  onStateChange?: (e: NativeSyntheticEvent<StreamState>) => void;
  onStats?: (e: NativeSyntheticEvent<StreamStats>) => void;
}

export const isPlayStationViewAvailable = requireOptionalNativeModule('WakenPlayStation') != null;

export const PlayStationView = (isPlayStationViewAvailable ? requireNativeView<PlayStationNativeProps>('WakenPlayStation') : () => null) as React.ComponentType<PlayStationNativeProps>;

export const StreamView = (isNativeStreamAvailable ? requireNativeView<StreamViewProps>('WakenStream') : () => null) as React.ComponentType<StreamViewProps>;
