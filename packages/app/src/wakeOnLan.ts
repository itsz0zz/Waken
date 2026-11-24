import { AgentClient, type Device, type WakeOnLanMethod } from '@waken/core';
import { useNetwork } from './network';
import { platform } from './platform';
import { useWaken } from './store';

const LIMITED_BROADCAST = '255.255.255.255';

/**
 * Wakes a computer with its magic packet, every way at once; the first that arrives wakes it:
 * - this device, on its own network: the broadcasts and the computer's address (a desktop through its own agent,
 *   the iPhone through its socket, where iOS allows it), and the home's public address (a port forwarded by the box);
 * - the account's other computers that are awake, through the Waken network: whichever is at home sends it there.
 * Fails only when not one of these could even send it.
 */
export async function sendWakeOnLan(target: Device, method: WakeOnLanMethod): Promise<void> {
  const nearby = [method.broadcast, method.address].filter((a): a is string => !!a);
  const outside = method.publicAddress ? [method.publicAddress] : [];
  const { devices } = useWaken.getState();
  const local = devices.find((d) => d.local && d.stream?.agentToken);
  const sends: Promise<unknown>[] = [];

  if (local) sends.push(new AgentClient(local).wake(method.mac, [...nearby, ...outside]));
  else if (platform().sendMagicPacket) sends.push(platform().sendMagicPacket!(method.mac, [LIMITED_BROADCAST, ...nearby, ...outside]));

  // Awake computers of the account, but not the one to wake nor this device itself.
  const online = new Set((useNetwork.getState().status?.hosts ?? []).filter((h) => h.online).map((h) => h.name));
  for (const helper of devices) {
    const host = helper.stream?.tunnelHost;
    if (!host || helper.local || helper.id === target.id || !online.has(host) || !helper.stream?.agentToken) continue;
    sends.push(new AgentClient(helper).wake(method.mac, nearby));
  }

  const results = await Promise.allSettled(sends);
  const sent = results.filter((r) => r.status === 'fulfilled').length;
  console.log(`[réveil] paquet magique pour ${target.name} : ${sent} envoi(s) sur ${results.length}`);
  if (sent === 0) {
    throw new Error(
      results.length === 0
        ? `Aucun moyen d'envoyer le paquet de réveil d'ici. Sur le réseau de ${target.name}, ou avec un autre ordinateur Waken allumé chez toi, ça marche.`
        : `Le paquet de réveil n'est parti par aucun chemin (${(results.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason}).`
    );
  }
}

/**
 * The wake method a computer left on the account's server, for a computer found on the Waken network that has no
 * other (a Shelly plug or the homelab relay chosen by hand stay as they are).
 */
export function withWakeInfo(device: Device, wake: { mac: string; address: string; broadcast: string; publicAddress?: string | null } | null | undefined): Device {
  if (!wake?.mac || (device.wake.type !== 'none' && device.wake.type !== 'wake-on-lan')) return device;
  const method: WakeOnLanMethod = {
    type: 'wake-on-lan',
    mac: wake.mac,
    address: wake.address,
    broadcast: wake.broadcast,
    ...(wake.publicAddress ? { publicAddress: wake.publicAddress } : {}),
  };
  return JSON.stringify(device.wake) === JSON.stringify(method) ? device : { ...device, wake: method };
}
