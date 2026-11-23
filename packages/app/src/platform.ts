import type { ComponentType } from 'react';
import type { StateStorage } from 'zustand/middleware';
import type { StreamSettings, TunnelApi } from '@waken/core';

/** What the native stream view reports (waken-stream on iOS, the AppKit view on Mac, Direct3D on Windows). */
export type StreamState =
  | { state: 'connecting' }
  | { state: 'streaming' }
  | { state: 'stopped' }
  | { state: 'error'; message: string };
export type StreamStats = { rttMs: number; fps: number; bitrateKbps: number; droppedFrames: number };
export interface LaunchInfo {
  address: string;
  appVersion: string;
  gfeVersion?: string;
  rtspSessionUrl: string;
  serverCodecModeSupport: number;
  riKey: string;
  riKeyId: number;
}

export interface StreamViewProps {
  launch: LaunchInfo;
  settings: StreamSettings;
  /** Smaller packets for a path that is not the local network. */
  remote: boolean;
  onStateChange: (s: StreamState) => void;
  onStats: (s: StreamStats) => void;
}

/** Everything that differs between the iPhone, Mac and Windows apps. */
export interface WakenPlatform {
  /** Where the configuration is kept: Keychain on iPhone, the app's private folder on desktop. */
  storage: StateStorage;
  /** Where the library cache is kept: a plain file, nothing secret in it, and too big for the Keychain. */
  cacheStorage: StateStorage;
  /** The Waken network, when this build has it. */
  tunnel: TunnelApi | null;
  /** The native stream view, when this build has it. */
  StreamView: ComponentType<StreamViewProps> | null;
  /** Shows or hides the on-screen keyboard during a stream (phones and tablets). */
  toggleKeyboard?: () => void;
  /** phone: dock at the bottom, portrait. desktop: top bar, wide layouts. */
  form: 'phone' | 'desktop';
  /** This device's name on the network ("iPhone", "Mac de Enzo"). */
  deviceName?: string;
  /** Hands the stream to the Moonlight app (iPhone only, kept from V1). */
  canUseMoonlightApp?: boolean;
}

let current: WakenPlatform | null = null;
const listeners = new Set<() => void>();

/** Called once by each app before rendering anything. */
export function setPlatform(platform: WakenPlatform) {
  current = platform;
  listeners.forEach((l) => l());
}

export function platform(): WakenPlatform {
  if (!current) throw new Error('Waken : setPlatform() doit être appelé au démarrage de l’app.');
  return current;
}

export function onPlatformSet(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
