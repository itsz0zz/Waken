import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { platform } from './platform';
import { useWaken } from './store';

/** A controller connected to this device, as its native side sees it. */
export interface GamepadInfo {
  id: string;
  name: string;
  kind: 'xbox' | 'playstation' | 'nintendo' | 'other';
  /** 0 to 1, absent when the controller does not say. */
  battery?: number | null;
  charging?: boolean;
  rumble: boolean;
  motion: boolean;
  touchpad: boolean;
  light: boolean;
}

/** How the controllers behave in a stream, the same for all of them. */
export interface GamepadOptions {
  /** Strength of the vibrations, 0 (off) to 1. */
  rumble: number;
  /** Gyroscope and accelerometer sent to the computer. */
  motion: boolean;
  /** The controller the computer emulates: as plugged in, or always this one (a game that only knows one). */
  kind: 'auto' | 'xbox' | 'playstation';
}

export const defaultGamepadOptions: GamepadOptions = { rumble: 1, motion: true, kind: 'auto' };

/** What each platform gives (iPhone and Mac: GameController; Windows: SDL3). */
export interface GamepadsApi {
  list(): Promise<GamepadInfo[]>;
  /** A short vibration, to know which one is which. */
  test(id: string): Promise<void>;
  setOptions(options: GamepadOptions): void;
}

export const useGamepadOptions = () => useWaken((s) => s.settings.gamepads ?? defaultGamepadOptions);

/** The controllers connected now, asked again every two seconds while a screen shows them. */
export function useGamepads() {
  const api = platform().gamepads;
  return useQuery({
    queryKey: ['gamepads'],
    enabled: !!api,
    refetchInterval: 2000,
    queryFn: () => api!.list(),
  });
}

/** Keeps the native side on the chosen options, from launch on. Mounted once at the app's root. */
export function useGamepadOptionsSync() {
  const options = useGamepadOptions();
  useEffect(() => {
    platform().gamepads?.setOptions(options);
  }, [options.rumble, options.motion, options.kind]);
}

/** What the native modules give: their own list (plain objects), a test, the options as three values. */
export interface NativeGamepads {
  list(): Promise<Record<string, unknown>[] | string>;
  test(id: string): Promise<void> | void;
  setOptions(rumble: number, motion: boolean, kind: string): void;
}

const kinds = ['xbox', 'playstation', 'nintendo', 'other'] as const;

/** The same GamepadsApi on every platform, from its native module (Windows answers JSON text). */
export function gamepadsFrom(native: NativeGamepads): GamepadsApi {
  return {
    list: async () => {
      const raw = await native.list();
      const items = (typeof raw === 'string' ? JSON.parse(raw) : raw) as Record<string, unknown>[];
      return items.map((g) => ({
        id: String(g.id),
        name: String(g.name ?? 'Manette'),
        kind: kinds.includes(g.kind as (typeof kinds)[number]) ? (g.kind as GamepadInfo['kind']) : 'other',
        battery: typeof g.battery === 'number' ? g.battery : null,
        charging: g.charging === true,
        rumble: g.rumble === true,
        motion: g.motion === true,
        touchpad: g.touchpad === true,
        light: g.light === true,
      }));
    },
    test: async (id) => {
      await native.test(id);
    },
    setOptions: (o) => native.setOptions(o.rumble, o.motion, o.kind),
  };
}
