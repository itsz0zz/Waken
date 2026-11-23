import { afterEach, describe, expect, it, vi } from 'vitest';
import { identityError, WakenCloud, type CloudSession } from '../src';

afterEach(() => vi.unstubAllGlobals());

const tokens = (n: number) => ({ accessToken: `access-${n}`, refreshToken: `refresh-${n}`, expiresIn: 3600 });
const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

/** fetch that answers by path and records each call. */
function server(routes: Record<string, (init: RequestInit) => Response>) {
  const calls: { path: string; auth?: string; body?: unknown }[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const path = url.replace('https://comptes.test', '').split('?')[0];
    const headers = (init.headers ?? {}) as Record<string, string>;
    calls.push({ path, auth: headers.Authorization, body: init.body ? JSON.parse(init.body as string) : undefined });
    const route = routes[path];
    return route ? route(init) : new Response('', { status: 404 });
  });
  return calls;
}

describe('WakenCloud', () => {
  it('signs in and saves the session', async () => {
    server({ '/account/login': () => ok(tokens(1)) });
    const saved: (CloudSession | null)[] = [];
    const cloud = new WakenCloud('https://comptes.test/', null, (s) => saved.push(s));
    await cloud.signIn(' enzo@waken.test ', 'un mot de passe long');
    expect(cloud.signedIn).toBe(true);
    expect(saved[0]?.accessToken).toBe('access-1');
    expect(saved[0]!.expiresAt).toBeGreaterThan(Date.now() + 3500_000);
  });

  it('says a wrong password in words', async () => {
    server({ '/account/login': () => new Response('', { status: 401 }) });
    const cloud = new WakenCloud('https://comptes.test', null, () => {});
    await expect(cloud.signIn('a@b.c', 'mauvais')).rejects.toThrow('mot de passe incorrect');
  });

  it('joins with the access token in a header', async () => {
    const calls = server({ '/network/join': () => ok({ controlUrl: 'https://reseau.test', authKey: 'k', expiresAt: '' }) });
    const cloud = new WakenCloud('https://comptes.test', { accessToken: 'a', refreshToken: 'r', expiresAt: Date.now() + 3600_000 }, () => {});
    expect((await cloud.join()).authKey).toBe('k');
    expect(calls[0].auth).toBe('Bearer a');
  });

  it('refreshes an expiring token first, once for two calls', async () => {
    const calls = server({
      '/account/refresh': () => ok(tokens(2)),
      '/network/devices': () => ok([]),
    });
    const cloud = new WakenCloud('https://comptes.test', { accessToken: 'old', refreshToken: 'r1', expiresAt: Date.now() + 10_000 }, () => {});
    await Promise.all([cloud.devices(), cloud.devices()]);
    expect(calls.filter((c) => c.path === '/account/refresh')).toHaveLength(1);
    expect(calls.filter((c) => c.path === '/network/devices').map((c) => c.auth)).toEqual(['Bearer access-2', 'Bearer access-2']);
  });

  it('signs out when the refresh token is refused', async () => {
    server({ '/account/refresh': () => new Response('', { status: 401 }) });
    const saved: (CloudSession | null)[] = [];
    const cloud = new WakenCloud('https://comptes.test', { accessToken: 'old', refreshToken: 'r', expiresAt: 0 }, (s) => saved.push(s));
    await expect(cloud.join()).rejects.toThrow('reconnecte-toi');
    expect(cloud.signedIn).toBe(false);
    expect(saved).toEqual([null]);
  });

  it('signs in again after a refused refresh', async () => {
    let refreshOk = false;
    server({
      '/account/refresh': () => (refreshOk ? ok(tokens(3)) : new Response('', { status: 401 })),
      '/account/login': () => ok({ ...tokens(4), expiresIn: 0 }),
      '/network/devices': () => ok([]),
    });
    const cloud = new WakenCloud('https://comptes.test', { accessToken: 'old', refreshToken: 'r', expiresAt: 0 }, () => {});
    await expect(Promise.all([cloud.devices(), cloud.devices()])).rejects.toThrow();
    await cloud.signIn('a@b.c', 'un mot de passe long');
    refreshOk = true;
    await expect(cloud.devices()).resolves.toEqual([]);
  });

  it('asks to sign in before any network call', async () => {
    const calls = server({});
    const cloud = new WakenCloud('https://comptes.test', null, () => {});
    await expect(cloud.join()).rejects.toThrow('Connecte-toi');
    expect(calls).toHaveLength(0);
  });
});

describe('identityError', () => {
  it('turns Identity codes into the app’s words', () => {
    expect(identityError('{"errors":{"DuplicateUserName":["x"]}}')).toContain('existe déjà');
    expect(identityError('{"errors":{"PasswordRequiresDigit":["x"]}}')).toContain('10 caractères');
    expect(identityError('pas du json')).toBeUndefined();
  });
});
