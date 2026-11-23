import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronLeft } from 'lucide-react-native';
import { defaultAgentUrl, validateDevice, type Device, type WakeMethod } from '@waken/core';
import { Button, colors, fonts, IconButton, type } from '@waken/ui';
import { useWaken } from '../../src/store';
import { Choice, Field, Section } from '../../src/fields';

export default function EditDeviceScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const device = useWaken((s) => s.devices.find((d) => d.id === id));
  return device ? <DeviceForm device={device} /> : null;
}

function DeviceForm({ device }: { device: Device }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const save = useWaken((s) => s.updateDevice);

  const [name, setName] = useState(device.name);
  const [detail, setDetail] = useState(device.detail ?? '');
  const [host, setHost] = useState(device.stream?.host ?? '');
  const [port, setPort] = useState(device.stream?.sunshinePort?.toString() ?? '');
  const [agentUrl, setAgentUrl] = useState(device.stream?.agentUrl ?? '');
  const [agentToken, setAgentToken] = useState(device.stream?.agentToken ?? '');
  const [method, setMethod] = useState<WakeMethod['type']>(device.wake.type);
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
    if (method === 'homelab-relay') return { type: method, apiUrl: '', apiToken: '', deviceId: relayId.trim() };
    if (method === 'shelly-cloud') return { ...plug, type: method, server: server.trim(), authKey: authKey.trim(), shellyId: shellyId.trim() };
    return { type: method };
  };

  const submit = () => {
    const next: Device = {
      ...device,
      name: name.trim(),
      detail: detail.trim() || undefined,
      wake: wakeMethod(),
      stream: device.stream && {
        ...device.stream,
        host,
        sunshinePort: port ? Number(port) : undefined,
        agentUrl: agentUrl.trim(),
        agentToken: agentToken.trim(),
      },
    };
    const problem = validateDevice(next);
    setError(problem);
    if (problem) return;
    save(next);
    router.back();
  };

  return (
    <ScrollView
      automaticallyAdjustKeyboardInsets
      keyboardShouldPersistTaps="handled"
      style={{ backgroundColor: colors.bg0 }}
      contentContainerStyle={{ paddingTop: insets.top + 8, paddingHorizontal: 18, paddingBottom: insets.bottom + 32, gap: 22, maxWidth: 700, width: '100%', alignSelf: 'center' }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <IconButton icon={ChevronLeft} label="Retour" onPress={() => router.back()} />
        <Text style={{ fontFamily: fonts.display, fontSize: 24, color: colors.ink }}>Modifier</Text>
      </View>

      <Section title="Appareil">
        <Field label="Nom" value={name} onChangeText={setName} autoCapitalize="words" />
        <Field label="Détail" value={detail} onChangeText={setDetail} placeholder="RTX 4070" />
      </Section>

      {device.stream ? (
        <Section title="Connexion">
          <Field label="Hôte" hint="Nom MagicDNS, ou IP Tailscale en 100.x." value={host} onChangeText={changeHost} placeholder="pc-gaming" />
          <Field label="Adresse de l'agent" value={agentUrl} onChangeText={setAgentUrl} keyboardType="url" />
          <Field label="Jeton de l'agent" hint="Affiché par install-agent.ps1 sur le PC." value={agentToken} onChangeText={setAgentToken} secureTextEntry />
          <Field label="Port Sunshine" value={port} onChangeText={setPort} keyboardType="number-pad" placeholder="47989" />
        </Section>
      ) : null}

      {device.kind === 'pc' ? (
        <Section title="Réveil">
          <Choice label="Relais homelab" hint="Wake-on-LAN, avec l'adresse et le jeton des Réglages." selected={method === 'homelab-relay'} onPress={() => setMethod('homelab-relay')} />
          <Choice label="Prise Shelly" hint="Coupe seulement si la prise mesure que le PC est éteint." selected={method === 'shelly-cloud'} onPress={() => setMethod('shelly-cloud')} />
          <Choice label="Aucun" hint="Le PC est toujours allumé." selected={method === 'none'} onPress={() => setMethod('none')} />
          {method === 'homelab-relay' ? (
            <Field label="Identifiant dans le relais" hint="Waken__Devices__0__Id sur le homelab." value={relayId} onChangeText={setRelayId} />
          ) : null}
          {method === 'shelly-cloud' ? (
            <>
              <Field label="Serveur Shelly Cloud" value={server} onChangeText={setServer} placeholder="shelly-XX-eu.shelly.cloud" />
              <Field label="Clé d'autorisation" value={authKey} onChangeText={setAuthKey} secureTextEntry />
              <Field label="Identifiant de la prise" value={shellyId} onChangeText={setShellyId} />
            </>
          ) : null}
        </Section>
      ) : null}

      {error ? <Text accessibilityRole="alert" style={[type.body, { color: colors.danger }]}>{error}</Text> : null}
      <Button label="Enregistrer" onPress={submit} />
    </ScrollView>
  );
}
