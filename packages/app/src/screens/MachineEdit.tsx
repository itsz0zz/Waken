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

type WakeChoice = 'wake-on-lan' | 'shelly-cloud' | 'homelab-relay';

/**
 * How a computer is woken. The network (Wake-on-LAN) is the default: the computer itself leaves its details on the
 * account, nothing to type. The homelab relay only shows for a machine that already uses it.
 */
function wakeChoices(device: Device): { id: WakeChoice; label: string; hint: string }[] {
  return [
    { id: 'wake-on-lan', label: 'Réseau', hint: 'Wake-on-LAN : Waken envoie le signal de réveil à la carte réseau du PC, sur ton réseau ou depuis Internet.' },
    { id: 'shelly-cloud', label: 'Prise', hint: 'Prise connectée Shelly : elle coupe puis remet le courant, seulement si elle mesure que le PC est éteint.' },
    ...(device.wake.type === 'homelab-relay'
      ? [{ id: 'homelab-relay' as const, label: 'Relais', hint: 'Wake-on-LAN par le relais du homelab (adresse et jeton dans Réglages, Avancé).' }]
      : []),
  ];
}

/** One line of what the computer left to be woken: a label, its value. */
function WakeDetail({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
      <Text style={[type.caption, { color: colors.ink2 }]}>{label}</Text>
      <Text selectable style={[type.label, { color: colors.ink }]}>
        {value}
      </Text>
    </View>
  );
}

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
  const [method, setMethod] = useState<WakeChoice>(
    device.wake.type === 'shelly-cloud' || device.wake.type === 'homelab-relay' ? device.wake.type : 'wake-on-lan'
  );
  const lan = device.wake.type === 'wake-on-lan' ? device.wake : undefined;
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
    // The network: what the computer left (kept as it is), or nothing yet; its next library fills it in.
    return lan ?? { type: 'none' };
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

        {device.kind === 'pc' && !device.local ? (
          <Card style={{ gap: 12 }}>
            <Text style={[type.label, { color: colors.ink }]}>Réveil</Text>
            <Segmented label="Réveil" value={method} options={wakeChoices(device)} onChange={setMethod} />
            <Text style={[type.caption, { color: colors.ink2 }]}>{wakeChoices(device).find((c) => c.id === method)?.hint}</Text>
            {method === 'wake-on-lan' ? (
              lan ? (
                <View style={{ gap: 8, padding: 14, borderRadius: 16, backgroundColor: colors.soft }}>
                  <WakeDetail label="Carte réseau" value={lan.mac} />
                  <WakeDetail label="Sur ton réseau" value={lan.address ?? lan.broadcast ?? 'adresse inconnue'} />
                  <WakeDetail label="Depuis Internet" value={lan.publicAddress ?? 'adresse inconnue'} />
                  <Text style={[type.caption, { color: colors.ink2 }]}>
                    {`Laissé par ${device.name} sur ton compte, mis à jour à chaque démarrage de Waken. Depuis Internet, la box doit rediriger le port UDP 9 vers ${lan.address ?? 'ce PC'}.`}
                  </Text>
                </View>
              ) : (
                <Text style={[type.caption, { color: colors.danger }]}>
                  {`Pas encore d’infos de réveil. Ouvre Waken sur ${device.name} une fois (sur un PC, active aussi « Démarrer avec Windows » dans ses Réglages) : il les laissera sur ton compte.`}
                </Text>
              )
            ) : null}
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
