import { useEffect } from 'react';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { WakenCloud, type CloudSession, type TunnelNetwork } from '@waken/core';
import { onPlatformSet, platform } from './platform';
import { useWaken } from './store';

/** The Waken accounts (server/Waken.Cloud) and the network they hand out (Headscale). */
export const CLOUD_URL = 'https://api.wakenplay.fr';

/**
 * account: the Waken account signs every device in, nobody sees Tailscale.
 * tailscale: the device's own Tailscale sign-in, kept for development and until the accounts are online.
 */
export type NetworkMode = 'account' | 'tailscale';

interface AccountState {
  mode: NetworkMode;
  session: CloudSession | null;
  email?: string;
  /** The network the account gave this device, once joined. */
  controlUrl?: string;
  /** The push token registered with the account, so a new one (or a new account) registers again. */
  pushToken?: string;
  /** How the account signs in: an Apple account has no password, deleting it asks Apple again. */
  provider?: 'password' | 'apple';
}

/** Kept with the configuration (Keychain on iPhone): the session holds the account's tokens. */
export const useAccount = create<AccountState>()(
  persist((): AccountState => ({ mode: 'account', session: null }), {
    name: 'waken-account',
    version: 1,
    storage: createJSONStorage(() => ({
      getItem: (k) => platform().storage.getItem(k),
      setItem: (k, v) => platform().storage.setItem(k, v),
      removeItem: (k) => platform().storage.removeItem(k),
    })),
    skipHydration: true,
    // Loaded, or failed to: either way the app can decide what to show.
    onRehydrateStorage: () => () => useAccountLoaded.setState({ loaded: true }),
  }),
);

/** Until the saved session is read, the app shows its boot screen rather than the account screen. */
export const useAccountLoaded = create<{ loaded: boolean }>(() => ({ loaded: false }));
onPlatformSet(() => void useAccount.persist.rehydrate());

let client: WakenCloud | null = null;
let clientSession: CloudSession | null = null;

/** The accounts client, following the saved session (refreshed tokens are saved back). */
export function cloud(): WakenCloud {
  const { session } = useAccount.getState();
  if (!client || clientSession !== session) {
    client = new WakenCloud(CLOUD_URL, session, (next) => {
      clientSession = next;
      useAccount.setState({ session: next, ...(next ? {} : { controlUrl: undefined }) });
    });
    clientSession = session;
  }
  return client;
}

/**
 * Registers this device for the account's notifications once signed in (asks the permission the first
 * time). Mounted once at the app's root.
 */
export function usePushRegistration() {
  const signedIn = useAccount((s) => s.session !== null && s.mode === 'account');
  const loaded = useAccountLoaded((s) => s.loaded);
  useEffect(() => {
    const { pushToken, pushPlatform, deviceName } = platform();
    if (!loaded || !signedIn || !pushToken || !pushPlatform) return;
    let cancelled = false;
    void (async () => {
      try {
        const token = await pushToken();
        if (!token || cancelled || token === useAccount.getState().pushToken) return;
        await cloud().registerPush(token, pushPlatform, deviceName ?? 'Appareil');
        useAccount.setState({ pushToken: token });
      } catch {
        // Retried on the next launch: notifications are a bonus, never a reason to block the app.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loaded, signedIn]);
}

export async function signInAccount(email: string, password: string, create: boolean) {
  const c = new WakenCloud(CLOUD_URL, null, (next) => {
    clientSession = next;
    useAccount.setState({ session: next });
  });
  if (create) await c.register(email, password);
  else await c.signIn(email, password);
  client = c;
  useAccount.setState({ email: email.trim(), mode: 'account', provider: 'password' });
}

/** The e-mail inside Apple's identity token (a JWT): Apple sends it on every sign-in, the name only the first time. */
function emailOf(identityToken: string): string | undefined {
  try {
    const payload = identityToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return (JSON.parse(atob(payload.padEnd(payload.length + ((4 - (payload.length % 4)) % 4), '='))) as { email?: string }).email;
  } catch {
    return undefined;
  }
}

/** Sign in with Apple, where the platform offers it. False when the user closed Apple's sheet. */
export async function signInWithAppleAccount(): Promise<boolean> {
  const ask = platform().appleSignIn;
  if (!ask) throw new Error("La connexion avec Apple n'est pas disponible sur cet appareil.");
  const credential = await ask();
  if (!credential) return false;
  const c = new WakenCloud(CLOUD_URL, null, (next) => {
    clientSession = next;
    useAccount.setState({ session: next });
  });
  await c.signInWithApple(credential);
  client = c;
  useAccount.setState({ email: emailOf(credential.identityToken) ?? 'Compte Apple', mode: 'account', provider: 'apple' });
  return true;
}

/**
 * Off the account on this device: the network signs out and the account's computers leave the list,
 * so the next account never sees them (nor their agent tokens).
 */
export async function signOutAccount() {
  const { pushToken } = useAccount.getState();
  // This device stops receiving the account's notifications first, while the session still works.
  if (pushToken) await cloud().unregisterPush(pushToken).catch(() => {});
  try {
    await platform().tunnel?.logout();
  } finally {
    cloud().signOut();
    forgetNetworkComputers();
    useAccount.setState({ session: null, email: undefined, controlUrl: undefined, pushToken: undefined, provider: undefined });
  }
}

/** Removes the computers found on the network (and their tokens); this device's own machine stays. */
export function forgetNetworkComputers() {
  const { devices } = useWaken.getState();
  useWaken.setState({ devices: devices.filter((d) => d.local || !d.stream?.tunnelHost) });
}

export function setNetworkMode(mode: NetworkMode) {
  forgetNetworkComputers();
  useAccount.setState({ mode, controlUrl: mode === 'tailscale' ? undefined : useAccount.getState().controlUrl });
}

/** True while the app needs the account before anything else (account mode, signed out). */
export function useNeedsAccount() {
  const signedOut = useAccount((s) => s.mode === 'account' && s.session === null);
  const loaded = useAccountLoaded((s) => s.loaded);
  return loaded && signedOut;
}

/** A join at most this often: a failing server is not asked on every poll. */
const JOIN_RETRY_MS = 30_000;
let lastJoin = 0;

/**
 * The network this device should run on right now, and a key when it has to sign in:
 * - Tailscale mode: Tailscale's network, its own sign-in page;
 * - account mode, signed out: nothing (the app shows the account screen);
 * - account mode, signed in: the account's network, with a fresh single-use key the first time and
 *   whenever the device was signed out of it (removed from the account, expired).
 */
export async function networkFor(needsLogin: boolean): Promise<TunnelNetwork | null> {
  const { mode, session, controlUrl } = useAccount.getState();
  if (mode === 'tailscale') return { controlUrl: '' };
  if (!session) return null;
  if (controlUrl && !needsLogin) return { controlUrl };
  if (Date.now() - lastJoin < JOIN_RETRY_MS) return controlUrl ? { controlUrl } : null;
  lastJoin = Date.now();
  const ticket = await cloud().join();
  useAccount.setState({ controlUrl: ticket.controlUrl });
  return { controlUrl: ticket.controlUrl, authKey: ticket.authKey };
}
