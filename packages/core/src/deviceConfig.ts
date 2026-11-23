import type { Device } from './types';

const AGENT_PORT = 47100;
const MAX_PORT = 65535;
const MAX_OFF_SECONDS = 60;

export const defaultAgentUrl = (host: string) => `http://${host}:${AGENT_PORT}`;

/** The relay's address and token live in Réglages only: a device gets them when it is used. */
export function withRelaySettings(device: Device, relay: { apiUrl: string; apiToken: string }): Device {
  if (device.wake.type !== 'homelab-relay') return device;
  return { ...device, wake: { ...device.wake, apiUrl: relay.apiUrl.trim(), apiToken: relay.apiToken.trim() } };
}

/** Where iOS lets the app use clear-text HTTP. Keep in sync with NSExceptionDomains in apps/mobile/app.json. */
export function isPrivateHost(host: string): boolean {
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (ipv4) {
    const [a, b, c, d] = ipv4.slice(1).map(Number) as [number, number, number, number];
    if ([a, b, c, d].some((part) => part > 255)) return false;
    return a === 10 || (a === 100 && b >= 64 && b <= 127) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  if (!/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/i.test(host)) return false;
  if (/^(0x[0-9a-f]+|\d+)$/i.test(host)) return false; // another spelling of an IPv4 address
  return !host.includes('.') || /\.(ts\.net|local)$/i.test(host);
}

/** The first problem of the relay's address, or null. */
export function validateApiUrl(url: string): string | null {
  const match = /^(https?):\/\/([^/:?#@]+)(:\d+)?\/?$/i.exec(url);
  if (!match) return 'Adresse invalide, par exemple http://homelab:8085.';
  if (match[1]?.toLowerCase() === 'http' && !isPrivateHost(match[2] ?? '')) return 'iOS bloque le http hors Tailscale et réseau local.';
  return null;
}

/** The first problem of a device's configuration, worded for the screen, or null. */
export function validateDevice(device: Device): string | null {
  if (!device.name.trim()) return 'Donne un nom à cet appareil.';

  const { stream, wake } = device;
  if (stream?.tunnelHost) {
    // Found on the Waken network: addresses are the tunnel's own, only the token comes from the computer.
    if (!stream.agentToken) return "Ce Mac ou PC n'a pas encore donné son jeton : rouvre Waken dessus.";
  } else if (stream) {
    if (!isPrivateHost(stream.host)) return "Hôte invalide : nom Tailscale (pc-gaming, pc.xxx.ts.net) ou IP privée, sans http:// ni port.";

    const port = stream.sunshinePort;
    if (port !== undefined && !(Number.isInteger(port) && port > 0 && port <= MAX_PORT)) return 'Le port Sunshine doit être entre 1 et 65535.';

    const agent = /^(https?):\/\/([^/:?#@]+)(:\d+)?\/?$/i.exec(stream.agentUrl ?? '');
    if (!agent) return "Adresse de l'agent invalide, par exemple http://pc-gaming:47100.";
    if (agent[1]?.toLowerCase() === 'http' && !isPrivateHost(agent[2] ?? '')) return "iOS bloque l'agent en http hors Tailscale et réseau local.";
    if (!stream.agentToken) return "Renseigne le jeton de l'agent (affiché à son installation).";
  }

  if (wake.type === 'homelab-relay' && !wake.deviceId) return "Renseigne l'identifiant de l'appareil dans le relais.";
  if (wake.type === 'shelly-cloud') {
    if (!wake.server || !wake.authKey || !wake.shellyId) return 'Renseigne le serveur, la clé et l\'identifiant de la prise Shelly.';
    if (wake.server.startsWith('http://')) return 'Le serveur Shelly doit être en https.';
    const seconds = wake.offSeconds;
    if (seconds !== undefined && !(seconds > 0 && seconds <= MAX_OFF_SECONDS)) return 'La coupure Shelly doit durer entre 1 et 60 secondes.';
  }

  return null;
}
