import { useState } from 'react';
import { Alert, Linking, Text, View } from 'react-native';
import { Gamepad2, LogOut, Server, Wifi } from 'lucide-react-native';
import { hostDisplayName, validateApiUrl } from '@waken/core';
import { AppMark, Card, colors, Display, Field, IconBubble, PillButton, Segmented, SettingRow, type } from '@waken/ui';
import { useFrame } from '../nav';
import { hasTunnel, signOut, useNetwork } from '../network';
import { platform } from '../platform';
import { qualities, qualityOf, type Quality } from '../quality';
import { useWaken, type StreamEngine } from '../store';
import { PhoneHeader } from './parts';
import { Screen } from './Screen';

export function SettingsScreen() {
  const { wide } = useFrame();
  const settings = useWaken((s) => s.settings);
  const update = useWaken((s) => s.updateSettings);
  const devices = useWaken((s) => s.devices);
  const status = useNetwork((s) => s.status);
  const quality = qualityOf(settings.stream);

  return (
    <Screen ground="sun" maxWidth={wide ? 1100 : 600}>
      <PhoneHeader />
      <Display size={wide ? 110 : 86} align={wide ? 'left' : 'center'} style={{ marginTop: 14 }}>
        Réglages
      </Display>
      <View style={{ marginTop: 20, gap: 16, flexDirection: wide ? 'row' : 'column', alignItems: wide ? 'flex-start' : 'stretch' }}>
        <View style={{ flex: wide ? 1 : undefined, gap: 16 }}>
          <Card lifted style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
            <AppMark size={56} />
            <View style={{ flex: 1 }}>
              <Text style={[type.headline, { fontSize: 20, color: colors.ink }]}>{platform().deviceName ?? 'Cet appareil'}</Text>
              <Text style={[type.caption, { color: colors.ink2 }]}>
                {devices.length} {devices.length > 1 ? 'machines' : 'machine'}
              </Text>
            </View>
          </Card>

          <Card style={{ gap: 12 }}>
            <Text style={[type.label, { color: colors.ink }]}>Qualité d'image</Text>
            <Segmented<Quality>
              label="Qualité d'image"
              value={quality}
              options={(Object.keys(qualities) as Quality[]).map((id) => ({ id, label: qualities[id].label }))}
              onChange={(q) => update({ stream: qualities[q].settings })}
            />
            <Text style={[type.caption, { color: colors.ink2 }]}>
              Max : l'image la plus nette. Éco : idéal en 4G. Sur une connexion relayée, Waken passe seul en Éco.
            </Text>
          </Card>

          {hasTunnel() ? (
            <Card style={{ gap: 8 }}>
              <SettingRow
                icon={Wifi}
                color={status?.state === 'running' ? colors.online : colors.muted}
                label="Réseau Waken"
                hint={
                  status?.state === 'running'
                    ? `Connecté${status.self ? ` (${status.self.ip})` : ''}`
                    : status?.state === 'needs-login'
                      ? 'Pas encore connecté'
                      : status?.error ?? 'Démarrage…'
                }
              />
              {status?.state === 'running'
                ? status.hosts
                    .filter((h) => h.name !== status.self?.name)
                    .map((h) => (
                      <Text key={h.name} style={[type.caption, { color: colors.ink2, textTransform: 'capitalize' }]}>
                        {hostDisplayName(h.name)} · {!h.online ? 'hors ligne' : h.direct ? 'connexion directe' : `via un relais${h.relay ? ` (${h.relay})` : ''}, image en 720p`}
                      </Text>
                    ))
                : null}
              {status?.state === 'needs-login' && status.loginUrl ? (
                <PillButton label="Se connecter" size="sm" onPress={() => Linking.openURL(status.loginUrl!)} />
              ) : null}
              {status?.state === 'running' ? <PillButton label="Se déconnecter" icon={LogOut} variant="ghost" size="sm" onPress={confirmSignOut} /> : null}
            </Card>
          ) : null}
        </View>

        <View style={{ flex: wide ? 1 : undefined }}>
          <Advanced />
        </View>
      </View>
    </Screen>
  );
}

function confirmSignOut() {
  Alert.alert('Se déconnecter du réseau Waken ?', "Tes ordinateurs ne seront plus joignables depuis cet appareil jusqu'à la prochaine connexion.", [
    { text: 'Annuler', style: 'cancel' },
    { text: 'Se déconnecter', style: 'destructive', onPress: () => signOut().catch((e: Error) => Alert.alert('Déconnexion impossible', e.message)) },
  ]);
}

/**
 * Kept from V1 for whoever uses them: the homelab relay (wake a computer that is off), PS Remote Play,
 * Moonlight. Saved with a button: a field saved on each keystroke would send the token to half-typed addresses.
 */
function Advanced() {
  const settings = useWaken((s) => s.settings);
  const update = useWaken((s) => s.updateSettings);
  const [draft, setDraft] = useState({ apiUrl: settings.apiUrl, apiToken: settings.apiToken, psRemotePlayUrl: settings.psRemotePlayUrl, moonlightUrl: settings.moonlightUrl });
  const [open, setOpen] = useState(false);
  const changed = (Object.keys(draft) as (keyof typeof draft)[]).some((k) => draft[k] !== settings[k]);
  const save = () => {
    const problem = draft.apiToken ? validateApiUrl(draft.apiUrl) : null;
    if (problem) return Alert.alert('Adresse du relais', problem);
    update({ ...draft, apiUrl: draft.apiUrl.trim(), apiToken: draft.apiToken.trim(), psRemotePlayUrl: draft.psRemotePlayUrl.trim(), moonlightUrl: draft.moonlightUrl.trim() });
  };
  const engines: { id: StreamEngine; label: string }[] = [
    { id: 'native', label: 'Dans Waken' },
    { id: 'moonlight-app', label: 'App Moonlight' },
  ];

  return (
    <Card style={{ gap: 12 }}>
      <SettingRow icon={Server} color={colors.ink} label="Avancé" hint="Relais de réveil, PS Remote Play" right={<PillButton label={open ? 'Fermer' : 'Ouvrir'} size="sm" variant="outline" onPress={() => setOpen(!open)} />} />
      {open ? (
        <View style={{ gap: 12 }}>
          <Field label="Relais homelab (réveil)" value={draft.apiUrl} onChangeText={(apiUrl) => setDraft({ ...draft, apiUrl })} keyboardType="url" placeholder="http://homelab:8085" />
          <Field label="Jeton du relais" value={draft.apiToken} onChangeText={(apiToken) => setDraft({ ...draft, apiToken })} secureTextEntry placeholder="WAKEN_TOKEN du homelab" />
          <Field label="Lien PS Remote Play" value={draft.psRemotePlayUrl} onChangeText={(psRemotePlayUrl) => setDraft({ ...draft, psRemotePlayUrl })} keyboardType="url" />
          {platform().canUseMoonlightApp ? (
            <>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <IconBubble icon={Gamepad2} color={colors.blue} size={32} />
                <Text style={[type.label, { color: colors.ink }]}>Moteur de stream</Text>
              </View>
              <Segmented<StreamEngine> label="Moteur de stream" value={settings.engine} options={engines} onChange={(engine) => update({ engine })} />
              {settings.engine === 'moonlight-app' ? (
                <Field label="Lien d'ouverture de Moonlight" value={draft.moonlightUrl} onChangeText={(moonlightUrl) => setDraft({ ...draft, moonlightUrl })} keyboardType="url" placeholder="moonlight://" />
              ) : null}
            </>
          ) : null}
          <PillButton label="Enregistrer" size="md" disabled={!changed} onPress={save} />
        </View>
      ) : null}
    </Card>
  );
}
