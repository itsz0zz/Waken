import type { Device, WakeMethod } from './types';
import { HttpError, json, sleep, throwIfAborted } from './http';

const DEFAULT_OFF_SECONDS = 5;
/** A PC that is off draws 0.5 to 3 W; a running one, even idle, far more. */
const MAX_WATTS_WHEN_OFF = 5;
/** The Cloud API accepts one request per second. */
const SHELLY_REQUEST_GAP_MS = 1100;
/**
 * Gen 1 models with a real power meter. The others (Shelly 1, 1L) report a constant typed by the user in the same
 * field, 0 by default and flagged valid.
 */
const GEN1_METERED_MODELS = new Set(['SHPLG-1', 'SHPLG2-1', 'SHPLG-S', 'SHPLG-U1', 'SHSW-PM', 'SHSW-25']);

type RelayMethod = Extract<WakeMethod, { type: 'homelab-relay' }>;
type ShellyMethod = Extract<WakeMethod, { type: 'shelly-cloud' }>;

/** Sends the magic packet every way this app can (its own network, the public address, the computers at home). */
export type SendWakeOnLan = (method: Extract<WakeMethod, { type: 'wake-on-lan' }>) => Promise<void>;

/** Asked before power is cut: a sleeping PC draws as little as one that is off, and would lose its memory. */
export type ConfirmPowerCut = (watts: number) => Promise<boolean>;

interface ShellyState {
  id: string;
  code?: string;
  online?: 0 | 1;
  status?: {
    /** Gen 1. */
    relays?: { ison?: boolean }[];
    meters?: { power?: number; is_valid?: boolean }[];
    /** Gen 2+: `switch:<channel>`. */
    [component: `switch:${number}`]: { output?: boolean; apower?: number } | undefined;
  };
}

/** Whether a power button makes sense for this device. */
export function canWake(device: Device): boolean {
  return !!device.stream && (device.wake.type === 'homelab-relay' || device.wake.type === 'shelly-cloud' || device.wake.type === 'wake-on-lan');
}

/** Sends the wake signal for a device. Resolves once the signal is sent (not when the device is up). */
export async function sendWakeSignal(device: Device, signal?: AbortSignal, confirmPowerCut?: ConfirmPowerCut, wakeOnLan?: SendWakeOnLan): Promise<void> {
  const method = device.wake;
  switch (method.type) {
    case 'homelab-relay':
      return wakeViaRelay(method);
    case 'wake-on-lan':
      if (!wakeOnLan) throw new Error("Cette app ne sait pas envoyer de paquet de réveil.");
      return wakeOnLan(method);
    case 'shelly-cloud':
      return wakeViaShelly(method, signal, confirmPowerCut);
    case 'playstation':
    case 'none':
      return;
  }
}

/** Waken API on the homelab: POST /devices/{id}/wake → magic packet on the LAN. */
async function wakeViaRelay(method: RelayMethod) {
  await json(`${method.apiUrl.replace(/\/$/, '')}/devices/${encodeURIComponent(method.deviceId)}/wake`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${method.apiToken}` },
  });
}

/**
 * Shelly Cloud Control API v2. With "Restore on AC power loss = Power On" in the BIOS, the PC boots when power returns.
 *
 * An unreachable PC is not a PC that is off (Tailscale may be down on the phone, and Shelly still works over the
 * Internet). So power is only cut when the plug itself measures that the PC draws almost nothing.
 * The cut uses `toggle_after`: the plug switches back on by itself, even if the phone loses the network.
 */
async function wakeViaShelly(method: ShellyMethod, signal?: AbortSignal, confirmPowerCut?: ConfirmPowerCut) {
  const base = (method.server.startsWith('http') ? method.server : `https://${method.server}`).replace(/\/$/, '');
  const channel = method.channel ?? 0;
  const post = <T>(path: string, body: object) =>
    json<T>(`${base}/v2/devices/api/${path}?auth_key=${encodeURIComponent(method.authKey)}`, { method: 'POST', body: JSON.stringify(body) });
  const readPlug = async () => inspectPlug(await post<ShellyState[] | undefined>('get', { ids: [method.shellyId], select: ['status'] }), method.shellyId, channel);

  try {
    let plug = await readPlug();
    if (plug.on) {
      if (!(await confirmPowerCut?.(plug.watts))) throw new Error('Coupure non confirmée : le courant reste en place.');
      throwIfAborted(signal);
      await sleep(SHELLY_REQUEST_GAP_MS, signal);
      // The question may have stayed on screen for minutes: the PC can be running by now.
      plug = await readPlug();
    }

    const command = plug.on ? { on: false, toggle_after: method.offSeconds || DEFAULT_OFF_SECONDS } : { on: true };
    await sleep(SHELLY_REQUEST_GAP_MS, signal);
    throwIfAborted(signal);
    await post('set/switch', { id: method.shellyId, channel, ...command });
  } catch (error) {
    if (error instanceof HttpError && error.status === 429) {
      throw new Error('Shelly Cloud limite à 1 requête par seconde : réessaie dans un instant.');
    }
    throw error;
  }
}

/** Throws unless the plug is off, or is on and really measures that the PC draws almost nothing. */
function inspectPlug(states: ShellyState[] | undefined, id: string, channel: number): { on: false } | { on: true; watts: number } {
  const plug = states?.find((state) => state.id === id);
  if (!plug) throw new Error('Prise Shelly introuvable : vérifie son identifiant.');
  if (!plug.online) throw new Error('La prise Shelly est hors ligne.');

  const gen2 = plug.status?.[`switch:${channel}`];
  const on = gen2 ? gen2.output : plug.status?.relays?.[channel]?.ison;
  if (on === false) return { on: false };

  const meter = plug.status?.meters?.[channel];
  const gen1IsMeasured = GEN1_METERED_MODELS.has(plug.code ?? '') && meter?.is_valid === true;
  const watts = gen2 ? gen2.apower : gen1IsMeasured ? meter?.power : undefined;
  if (on === undefined || typeof watts !== 'number' || !Number.isFinite(watts)) {
    throw new Error("Cette prise ne donne pas de mesure de puissance fiable : impossible de savoir si le PC est éteint, je ne coupe pas le courant.");
  }
  if (Math.abs(watts) > MAX_WATTS_WHEN_OFF) {
    throw new Error(`Le PC semble allumé (${Math.round(watts)} W) mais ne répond pas. Je ne coupe pas le courant : vérifie Tailscale.`);
  }
  return { on: true, watts };
}
