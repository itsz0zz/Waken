import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo';

import type { TunnelApi, TunnelHello, TunnelStatus } from '@waken/core';

export type { TunnelApi, TunnelHello, TunnelNode, TunnelStatus } from '@waken/core';
export { agentUrlFor } from '@waken/core';

interface Native {
  start(name?: string): Promise<string>;
  status(): Promise<string>;
  setPeer(peer: string): Promise<string>;
  hello(peer: string): Promise<string>;
  logout(): Promise<string>;
  stop(): Promise<void>;
}

const native = Platform.OS === 'ios' ? requireOptionalNativeModule<Native>('WakenTunnel') : null;

/** False in Expo Go, on the web, and on Android until its build (V3). */
export const isTunnelAvailable = native != null;

function parse<T>(json: string): T {
  const value = JSON.parse(json) as T & { error?: string };
  if (value && typeof value === 'object' && 'error' in value && value.error && !('state' in value)) throw new Error(value.error);
  return value;
}

/** A status from an older native build may say hosts: null. */
const parseStatus = (json: string): TunnelStatus => {
  const status = parse<TunnelStatus>(json);
  return { ...status, hosts: status.hosts ?? [] };
};

function need(): Native {
  if (!native) throw new Error("Le réseau Waken n'est pas disponible sur cet appareil.");
  return native;
}

export const WakenTunnel: TunnelApi = {
  start: async (name?: string) => parseStatus(await need().start(name)),
  status: async () => parseStatus(await need().status()),
  setPeer: async (peer: string) => {
    parse(await need().setPeer(peer));
  },
  hello: async (peer: string) => parse<TunnelHello>(await need().hello(peer)),
  logout: async () => {
    parse(await need().logout());
  },
  stop: async () => {
    await need().stop();
  },
};
