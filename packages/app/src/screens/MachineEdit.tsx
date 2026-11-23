import { useState } from 'react';
import { Text, View } from 'react-native';
import { defaultAgentUrl, validateDevice, type Device, type WakeMethod } from '@waken/core';
import { Card, colors, Field, PillButton, Segmented, type } from '@waken/ui';
import { useDevice } from '../hooks';
import { useNav } from '../nav';
import { useWaken } from '../store';
import { BackHeader } from './parts';
import { Screen } from './Screen';

/** A machine's own settings: its name and, for a PC, how it is woken. Machines found on the network connect by themselves. */
export function MachineEditScreen({ deviceId }: { deviceId: string }) {
  const device = useDevice(deviceId);
  return device ? <MachineForm device={device} /> : null;
}

const wakeChoices: { id: WakeMethod['type']; label: string; hint: string }[] = [
  { id: 'none', label: 'Aucun', hint: 'La machine reste allumée, avec Waken ouvert.' },
  { id: 'homelab-relay', label: 'Relais', hint: "Wake-on-LAN par le relais homelab (adresse et jeton dans Réglages, Avancé)." },
  { id: 'shelly-cloud', label: 'Prise', hint: 'Prise Shelly : coupe seulement si elle mesure que le PC est éteint.' },
];

function MachineForm({ device }: { device: Device }) {
  const nav = useNav();
  const save = useWaken((s) => s.updateDevice);
  const found = !!device.stream?.tunnelHost;

  const [name, setName] = useState(device.name);
  const [detail, setDetail] = useState(device.detail ?? '');
  const [host, setHost] = useState(device.stream?.host ?? '');
  const [port, setPort] = useState(device.stream?.sunshinePort?.toString() ?? '');
  const [agentUrl, setAgentUrl] = useState(device.stream?.agentUrl ?? '');
  const [agentToken, setAgentToken] = useState(device.stream?.agentToken ?? '');
  const [method, setMethod] = useState<WakeMethod['type']>(device.wake.type === 'playstation' ? 'none' : device.wake.type);
  const [relayId, setRelayId] = useState(device.wake.type === 'homelab-relay' ? device.wake.deviceId : device.id);
  const plug = device.wake.type === 'shelly-cloud' ? device.wake : undefined;
  const [server, setServer] = useState(plug?.server ?? '');
  const [authKey, setAuthKey] = useState(plug?.authKey ?? '');
  const [shellyId, setShellyId] = useState(plug?.shellyId ?? '');
  const [error, setError] = useState<string | null>(null);

  const changeHost = (next: string) => {
    // The agent address follows the host until it has been customised.
    if (!agentUrl || agentUrl === defaultAgentUrl(host)) setAgentUrl(defaultAgentUrl(next.trim()));
    setHost(next.trim());
  };

  const wakeMethod = (): WakeMethod => {
    if (device.kind === 'playstation') return device.wake;
    if (method === 'homelab-relay') return { type: method, apiUrl: '', apiToken: '', deviceId: relayId.trim() };
    if (method === 'shelly-cloud') return { ...plug, type: method, server: server.trim(), authKey: authKey.trim(), shellyId: shellyId.trim() };
    return { type: 'none' };
  };

  const submit = () => {
    const next: Device = {
      ...device,
      name: name.trim(),
      detail: detail.trim() || undefined,
      wake: wakeMethod(),
      stream:
        device.stream &&
        (found
          ? device.stream
          : { ...device.stream, host, sunshinePort: port ? Number(port) : undefined, agentUrl: agentUrl.trim(), agentToken: agentToken.trim() }),
    };
    const problem = validateDevice(next);
    setError(problem);
    if (problem) return;
    save(next);
    nav.back();
  };

  return (
    <Screen ground="lime" maxWidth={640}>
      <BackHeader title="Modifier" />
      <View style={{ gap: 16, marginTop: 20 }}>
        <Card style={{ gap: 12 }}>
          <Text style={[type.label, { color: colors.ink }]}>Machine</Text>
          <Field label="Nom" value={name} onChangeText={setName} autoCapitalize="words" />
          <Field label="Détail" value={detail} onChangeText={setDetail} placeholder="RTX 4070" />
        </Card>

        {device.stream && !found ? (
          <Card style={{ gap: 12 }}>
            <Text style={[type.label, { color: colors.ink }]}>Connexion</Text>
            <Field label="Hôte" hint="Nom ou IP sur ton réseau." value={host} onChangeText={changeHost} placeholder="pc-gaming" />
            <Field label="Adresse de l'agent" value={agentUrl} onChangeText={setAgentUrl} keyboardType="url" />
            <Field label="Jeton de l'agent" value={agentToken} onChangeText={setAgentToken} secureTextEntry />
            <Field label="Port Sunshine" value={port} onChangeText={setPort} keyboardType="number-pad" placeholder="47989" />
          </Card>
        ) : null}

        {device.kind === 'pc' ? (
          <Card style={{ gap: 12 }}>
            <Text style={[type.label, { color: colors.ink }]}>Réveil</Text>
            <Segmented label="Réveil" value={method} options={wakeChoices} onChange={setMethod} />
            <Text style={[type.caption, { color: colors.ink2 }]}>{wakeChoices.find((c) => c.id === method)?.hint}</Text>
            {method === 'homelab-relay' ? <Field label="Identifiant dans le relais" value={relayId} onChangeText={setRelayId} /> : null}
            {method === 'shelly-cloud' ? (
              <>
                <Field label="Serveur Shelly Cloud" value={server} onChangeText={setServer} placeholder="shelly-XX-eu.shelly.cloud" />
                <Field label="Clé d'autorisation" value={authKey} onChangeText={setAuthKey} secureTextEntry />
                <Field label="Identifiant de la prise" value={shellyId} onChangeText={setShellyId} />
              </>
            ) : null}
          </Card>
        ) : null}

        {error ? (
          <Text accessibilityRole="alert" style={[type.label, { color: colors.danger }]}>
            {error}
          </Text>
        ) : null}
        <PillButton label="Enregistrer" size="lg" onPress={submit} />
      </View>
    </Screen>
  );
}
