import { createContext, useContext } from 'react';

/** Where the screens can go. Each app implements it with its own navigation (expo-router, desktop stack). */
export interface WakenNav {
  home(): void;
  games(query?: string): void;
  game(gameId: string): void;
  machines(): void;
  /** Manual settings of a machine (iPhone: the edit screen). Optional on desktop. */
  machine?(deviceId: string): void;
  addMachine(): void;
  settings(): void;
  /** The Manettes page. */
  gamepads(): void;
  /** Linking a PS5 or PS4. */
  addPlayStation(): void;
  /** Wakes the machine if needed, then streams the game (wake screen, then stream screen). */
  play(deviceId: string, gameId?: string, app?: string): void;
  /** Wakes the machine only. */
  wakeOnly(deviceId: string): void;
  /** From the wake screen: replace it with the stream. */
  stream(deviceId: string, gameId?: string, app?: string): void;
  back(): void;
}

/** Space the app keeps around the screens: notch and dock on iPhone, title bar on desktop. */
export interface Frame {
  top: number;
  bottom: number;
  /** The sides' safe area (a phone held sideways: its notch and rounded corners). Absent on desktop. */
  left?: number;
  right?: number;
  /** Wide layouts (desktop windows, iPad landscape): two columns where the mockups have them. */
  wide: boolean;
}

export const NavContext = createContext<WakenNav | null>(null);
export const FrameContext = createContext<Frame>({ top: 0, bottom: 0, wide: false });

export function useNav(): WakenNav {
  const nav = useContext(NavContext);
  if (!nav) throw new Error('Waken : NavContext manquant.');
  return nav;
}

export const useFrame = () => useContext(FrameContext);
