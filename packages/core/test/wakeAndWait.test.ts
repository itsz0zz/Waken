import { afterEach, describe, expect, it, vi } from 'vitest';
import { canWake, wakeAndWait, type Device, type WakeMethod } from '../src';

interface Network {
  /** Reachability as seen from the phone. */
  agent?: boolean;
  sunshine?: boolean;
  /** Shelly Cloud's answer to /v2/devices/api/get. */
  plug?: unknown;
  plugAfterConfirmation?: unknown;
}

interface Call {
  url: string;
  body: Record<string, unknown>;
}

function fakeNetwork(network: Network) {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    calls.push({ url, body: init.body ? JSON.parse(String(init.body)) : {} });
    if (url.includes(':47989/')) {
      if (network.sunshine) return new Response('<root><appversion>7.1.431.-1</appversion></root>');
      throw new TypeError('unreachable');
    }
    if (url.includes(':47100/')) {
      if (network.agent) return new Response('{"ok":true}');
      throw new TypeError('unreachable');
    }
    if (url.includes('/v2/devices/api/get')) {
      const reads = calls.filter((call) => call.url.includes('/v2/devices/api/get')).length;
      const plug = reads > 1 && network.plugAfterConfirmation ? network.plugAfterConfirmation : network.plug;
      return new Response(JSON.stringify(plug ?? []));
    }
    return new Response('');
  });
  return {
    switches: () => calls.filter((call) => call.url.includes('/set/switch')).map((call) => call.body),
    wakePackets: () => calls.filter((call) => call.url.includes('/wake')),
  };
}

const relay: WakeMethod = { type: 'homelab-relay', apiUrl: 'http://homelab:8085', apiToken: 't', deviceId: 'pc' };
const shelly: WakeMethod = { type: 'shelly-cloud', server: 'shelly.test', authKey: 'k', shellyId: 'plug', offSeconds: 5 };
const pc = (wake: WakeMethod): Device => ({ id: 'pc', name: 'PC', kind: 'pc', wake, stream: { host: 'pc', agentUrl: 'http://pc:47100' } });
const gen2 = (output: boolean, apower?: number) => [{ id: 'plug', gen: 'G2', online: 1, status: { 'switch:0': { id: 0, output, apower } } }];
const gen1 = (ison: boolean, power: number, code = 'SHPLG-S', valid = true) =>
  [{ id: 'plug', gen: 'G1', code, online: 1, status: { relays: [{ ison }], meters: [{ power, is_valid: valid }] } }];
const fast = { timeoutMs: 40, pollMs: 5, confirmPowerCut: async () => true };
const powerCycle = [{ id: 'plug', channel: 0, on: false, toggle_after: 5 }];

afterEach(() => vi.unstubAllGlobals());

describe('Shelly', () => {
  it('never cuts power when the agent answers', async () => {
    const network = fakeNetwork({ agent: true, plug: gen2(true, 1) });
    await expect(wakeAndWait(pc(shelly), fast)).rejects.toThrow();
    expect(network.switches()).toEqual([]);
  });

  it('never cuts power when the PC draws power, even if nothing answers (Tailscale off)', async () => {
    const network = fakeNetwork({ plug: gen2(true, 85) });
    await expect(wakeAndWait(pc(shelly), fast)).rejects.toThrow(/allumé/);
    expect(network.switches()).toEqual([]);
  });

  it('never cuts power when the plug cannot measure it', async () => {
    const network = fakeNetwork({ plug: gen2(true) });
    await expect(wakeAndWait(pc(shelly), fast)).rejects.toThrow(/mesure/);
    expect(network.switches()).toEqual([]);
  });

  it('never acts on an offline plug', async () => {
    const network = fakeNetwork({ plug: [{ id: 'plug', online: 0 }] });
    await expect(wakeAndWait(pc(shelly), fast)).rejects.toThrow(/hors ligne/);
    expect(network.switches()).toEqual([]);
  });

  it('never acts on the status of another plug', async () => {
    const network = fakeNetwork({ plug: [{ ...gen2(true, 1)[0], id: 'someone-else' }] });
    await expect(wakeAndWait(pc(shelly), fast)).rejects.toThrow();
    expect(network.switches()).toEqual([]);
  });

  it('power-cycles a PC that is off, in one request the plug finishes by itself', async () => {
    const network = fakeNetwork({ plug: gen2(true, 1.4) });
    await expect(wakeAndWait(pc(shelly), fast)).rejects.toThrow();
    expect(network.switches()).toEqual(powerCycle);
  });

  it('reads Gen 1 plugs', async () => {
    const network = fakeNetwork({ plug: gen1(true, 0.8) });
    await expect(wakeAndWait(pc(shelly), fast)).rejects.toThrow();
    expect(network.switches()).toEqual(powerCycle);
  });

  it.each([
    ['a Shelly 1, whose power is a constant typed by the user', gen1(true, 0, 'SHSW-1')],
    ['a Shelly 1L', gen1(true, 0, 'SHSW-L')],
    ['an unknown Gen 1 model', gen1(true, 0, 'SOMETHING')],
    ['an invalid reading', gen1(true, 0, 'SHPLG-S', false)],
  ])('never cuts power on %s', async (_, plug) => {
    const network = fakeNetwork({ plug });
    await expect(wakeAndWait(pc(shelly), fast)).rejects.toThrow(/mesure/);
    expect(network.switches()).toEqual([]);
  });

  it('never cuts power without a confirmation (the PC may be asleep)', async () => {
    const network = fakeNetwork({ plug: gen2(true, 3) });
    await expect(wakeAndWait(pc(shelly), { timeoutMs: 40, pollMs: 5 })).rejects.toThrow();
    expect(network.switches()).toEqual([]);
  });

  it('never cuts power when the confirmation is refused', async () => {
    const network = fakeNetwork({ plug: gen2(true, 3) });
    await expect(wakeAndWait(pc(shelly), { ...fast, confirmPowerCut: async () => false })).rejects.toThrow();
    expect(network.switches()).toEqual([]);
  });

  it('measures again after the confirmation', async () => {
    const network = fakeNetwork({ plug: gen2(true, 1), plugAfterConfirmation: gen2(true, 90) });
    await expect(wakeAndWait(pc(shelly), fast)).rejects.toThrow(/allumé/);
    expect(network.switches()).toEqual([]);
  });

  it('only switches on a plug that is off', async () => {
    const network = fakeNetwork({ plug: gen2(false, 0) });
    await expect(wakeAndWait(pc(shelly), fast)).rejects.toThrow();
    expect(network.switches()).toEqual([{ id: 'plug', channel: 0, on: true }]);
  });
});

describe('wakeAndWait', () => {
  it('goes straight to the stream when Sunshine answers', async () => {
    const network = fakeNetwork({ sunshine: true });
    await wakeAndWait(pc(relay), fast);
    expect(network.wakePackets()).toEqual([]);
  });

  it('does not send a wake signal to a PC that already runs', async () => {
    const network = fakeNetwork({ agent: true });
    await expect(wakeAndWait(pc(relay), fast)).rejects.toThrow();
    expect(network.wakePackets()).toEqual([]);
  });

  it('sends the wake signal to a PC that is off', async () => {
    const network = fakeNetwork({});
    await expect(wakeAndWait(pc(relay), fast)).rejects.toThrow();
    expect(network.wakePackets()).toHaveLength(1);
  });

  it('sends nothing when cancelled before the signal', async () => {
    const network = fakeNetwork({});
    await expect(wakeAndWait(pc(relay), { ...fast, signal: AbortSignal.abort() })).rejects.toThrow('Annulé');
    expect(network.wakePackets()).toEqual([]);
  });

  it('stops waiting as soon as it is cancelled', async () => {
    fakeNetwork({});
    const started = Date.now();
    await expect(wakeAndWait(pc(relay), { timeoutMs: 3000, pollMs: 1000, signal: AbortSignal.timeout(30) })).rejects.toThrow('Annulé');
    expect(Date.now() - started).toBeLessThan(500);
  });

  it('marks the step as failed when the signal cannot be sent', async () => {
    fakeNetwork({ plug: [] });
    const states: string[] = [];
    await expect(wakeAndWait(pc(shelly), { ...fast, onProgress: (progress) => states.push(progress.states.signal) })).rejects.toThrow();
    expect(states.at(-1)).toBe('error');
  });
});

describe('health checks', () => {
  it('never carry the agent token', async () => {
    const sent: unknown[] = [];
    vi.stubGlobal('fetch', async (_: string, init: RequestInit = {}) => {
      sent.push(init.headers);
      return new Response('{}');
    });
    const device = pc(relay);
    await wakeAndWait({ ...device, stream: { ...device.stream!, agentToken: 'SECRET' } }, fast);
    expect(JSON.stringify(sent)).not.toContain('SECRET');
  });
});

describe('canWake', () => {
  it('offers power only where it can work', () => {
    expect(canWake(pc(relay))).toBe(true);
    expect(canWake({ id: 'ps5', name: 'PS5', kind: 'playstation', wake: { type: 'playstation' } })).toBe(false);
    expect(canWake({ id: 'nas', name: 'Homelab', kind: 'homelab', wake: { type: 'none' } })).toBe(false);
  });
});

describe('Through the Waken network', () => {
  // 127.0.0.1 is this device's own end of the tunnel: on a Mac, its own Sunshine answers there.
  const tunnelled = (): Device => ({
    id: 'pc',
    name: 'PC',
    kind: 'pc',
    wake: { type: 'none' },
    stream: { host: '127.0.0.1', agentUrl: 'http://127.0.0.1:47102/h/pc/', tunnelHost: 'pc' },
  });

  it('does not take this Mac’s own Sunshine for the machine’s', async () => {
    vi.stubGlobal('fetch', async (url: string) => {
      if (url.includes(':47989/')) return new Response('<root><appversion>7.1.431.-1</appversion></root>');
      throw new TypeError('unreachable');
    });
    await expect(wakeAndWait(tunnelled(), fast)).rejects.toThrow();
  });

  it('is ready when the machine’s agent answers', async () => {
    vi.stubGlobal('fetch', async (url: string) => {
      if (url.includes('/h/pc/health')) return new Response('{"ok":true}');
      throw new TypeError('unreachable');
    });
    const steps: string[] = [];
    await wakeAndWait(tunnelled(), { ...fast, onProgress: (p) => steps.push(p.message ?? p.step) });
    expect(steps).toEqual(['Déjà allumé']);
  });
});
