import { describe, expect, it } from 'vitest';
import { defaultAgentUrl, validateDevice, withRelaySettings, type Device } from '../src';

const pc: Device = {
  id: 'pc',
  name: 'PC',
  kind: 'pc',
  wake: { type: 'homelab-relay', apiUrl: '', apiToken: '', deviceId: 'pc' },
  stream: { host: 'pc', agentUrl: 'http://pc:47100', agentToken: 't' },
};
const withHost = (host: string): Device => ({ ...pc, stream: { ...pc.stream!, host, agentUrl: defaultAgentUrl(host) } });

describe('withRelaySettings', () => {
  it('gives the relay the address and token typed in Réglages', () => {
    expect(withRelaySettings(pc, { apiUrl: ' http://homelab:8085 ', apiToken: ' secret ' }).wake)
      .toMatchObject({ apiUrl: 'http://homelab:8085', apiToken: 'secret' });
  });

  it('leaves a Shelly plug alone', () => {
    const device: Device = { ...pc, wake: { type: 'shelly-cloud', server: 's', authKey: 'k', shellyId: 'i' } };
    expect(withRelaySettings(device, { apiUrl: 'x', apiToken: 'y' })).toEqual(device);
  });
});

describe('validateDevice', () => {
  it.each(['pc-gaming', 'pc.tail1234.ts.net', '100.101.102.103', '192.168.1.42', '10.0.0.4', '172.16.3.4', 'pc.local'])('accepts %s', (host) => {
    expect(validateDevice(withHost(host))).toBeNull();
  });

  // iOS refuses clear-text HTTP outside these networks (see NSExceptionDomains in app.json).
  it.each(['', 'http://pc', 'pc gaming', '100.128.0.1', '172.32.0.1', '8.8.8.8', 'example.com', 'pc:47989', '134744072', '0x08080808'])('rejects "%s"', (host) => {
    expect(validateDevice(withHost(host))).not.toBeNull();
  });

  it('requires the agent token', () => {
    expect(validateDevice({ ...pc, stream: { ...pc.stream!, agentToken: '' } })).toMatch(/jeton/i);
  });

  it('rejects a port out of range', () => {
    expect(validateDevice({ ...pc, stream: { ...pc.stream!, sunshinePort: 70000 } })).toMatch(/port/i);
  });

  it('requires the Shelly plug settings', () => {
    expect(validateDevice({ ...pc, wake: { type: 'shelly-cloud', server: '', authKey: '', shellyId: '' } })).toMatch(/Shelly/);
  });
});

describe('computers found on the Waken network', () => {
  const found = {
    id: 'waken-host-mac',
    name: 'Mac de Enzo',
    kind: 'pc' as const,
    wake: { type: 'none' as const },
    stream: { host: '127.0.0.1', agentUrl: 'http://127.0.0.1:47102/h/waken-host-mac', agentToken: 't'.repeat(40), tunnelHost: 'waken-host-mac' },
  };

  it('accepts the tunnel addresses', () => {
    expect(validateDevice(found)).toBeNull();
  });

  it('still needs the token the computer gave', () => {
    expect(validateDevice({ ...found, stream: { ...found.stream, agentToken: '' } })).toMatch(/jeton/);
  });
});
