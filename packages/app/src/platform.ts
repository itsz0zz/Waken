import type { ComponentType } from 'react';
import type { GamepadsApi } from './gamepads';
import type { StateStorage } from 'zustand/middleware';
import type { StreamSettings, TunnelApi, AppleCredential } from '@waken/core';

/** What the native stream view reports (waken-stream on iOS, the AppKit view on Mac, Direct3D on Windows). */
export type StreamState =
  | { state: 'connecting'; stage?: string }
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
  /** The sound off, the picture on (the HUD's menu). */
  muted?: boolean;
  /** The HUD's menu is open: the pointer and keys stay with this device (the Mac shows its cursor again). */
  paused?: boolean;
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
  /**
   * Asks for the permission to notify, then this device's push token (APNs, hex). Null when refused
   * or when this build cannot receive notifications.
   */
  pushToken?: () => Promise<string | null>;
  /** Sign in with Apple's sheet: Apple's identity token, or null when the user closed it. */
  appleSignIn?: () => Promise<AppleCredential | null>;
  /** ios | macos: which app the server addresses the notifications to. */
  pushPlatform?: 'ios' | 'macos';
  /**
   * The Mac: on Wi-Fi with AWDL up (AirDrop, Handoff), whose scans take the radio away several times a second and
   * make the stream stutter. Only the user can turn it off (an administrator command).
   */
  wifiInfo?: () => Promise<{ wifi: boolean; awdl: boolean }>;
  /** The window full screen or back (a desktop playing): the stream's HUD shows the button when this is there. */
  setFullscreen?: (on: boolean) => void;
  /** Puts a text on the clipboard. */
  copyText?: (text: string) => Promise<void>;
  /**
   * Sends a Wake-on-LAN magic packet from this device (UDP port 9) to these addresses; how many left. Desktops have
   * no need: their own agent sends it. On iPhone a broadcast needs Apple's multicast entitlement, a plain address not.
   */
  sendMagicPacket?: (mac: string, targets: string[]) => Promise<number>;
  /**
   * Windows: Waken starts with the PC, before anybody signs in, and its network card answers the magic packet.
   * set asks Windows for the administrator's confirmation; fastStartupOff also turns off Windows' fast startup.
   */
  startup?: { get(): Promise<boolean>; set(on: boolean, fastStartupOff: boolean): Promise<void> };
  /** The controllers connected to this device (the Manettes page). */
  gamepads?: GamepadsApi;
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
