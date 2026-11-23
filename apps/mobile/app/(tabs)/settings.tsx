import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, colors, fonts, radius, type } from '@waken/ui';
import { useWaken, type StreamEngine } from '../../src/store';
import { Choice, Field, Section } from '../../src/fields';
import { isTunnelAvailable, signOut, useNetwork } from '../../src/network';

/** Homelab API, stream engine (V1/V2), external apps and stream quality. Devices are edited from Appareils. */
function NetworkSection() {
  const status = useNetwork((s) => s.status);
  const confirmSignOut = () =>
    Alert.alert('Se déconnecter du réseau Waken ?', 'Tes ordinateurs ne seront plus joignables depuis cet appareil jusqu\'à la prochaine connexion.', [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Se déconnecter', style: 'destructive', onPress: () => signOut().catch((e: Error) => Alert.alert('Déconnexion impossible', e.message)) },
    ]);
  return (
    <Section title="Réseau Waken">
      <Text style={[type.body, { color: colors.ink2, fontSize: 14 }]}>
        {status?.state === 'running'
          ? `Connecté${status.self ? ` (${status.self.ip})` : ''}. ${status.hosts.length} ${status.hosts.length > 1 ? 'ordinateurs' : 'ordinateur'} sur ton réseau.`
          : status?.state === 'needs-login'
            ? 'Pas encore connecté : connecte-toi depuis l\'accueil.'
            : status?.error ?? 'Démarrage…'}
      </Text>
      {status?.state === 'running'
        ? status.hosts.map((h) => (
            <Text key={h.name} style={[type.caption, { color: colors.ink3 }]}>
              {h.name.replace(/^waken-host-/, '')} · {!h.online ? 'hors ligne' : h.direct ? 'connexion directe' : `via un relais${h.relay ? ` (${h.relay})` : ''} : qualité réduite`}
            </Text>
          ))
        : null}
      {status?.state === 'running' ? <Button label="Se déconnecter" variant="ghost" onPress={confirmSignOut} /> : null}
    </Section>
  );
}

export default function Settings() {
  const insets = useSafeAreaInsets();
  const settings = useWaken((s) => s.settings);
  const update = useWaken((s) => s.updateSettings);

  const engines: { id: StreamEngine; label: string; hint: string }[] = [
    { id: 'native', label: 'Dans Waken (V2)', hint: 'Stream intégré via le module natif waken-stream.' },
    { id: 'moonlight-app', label: 'App Moonlight (V1)', hint: 'Waken réveille le PC puis ouvre Moonlight.' },
  ];
  const qualities = [
    { label: '1080p · 60', s: { width: 1920, height: 1080, fps: 60, bitrate: 20_000 } },
    { label: '1440p · 120', s: { width: 2560, height: 1440, fps: 120, bitrate: 50_000 } },
    { label: '4K · 60', s: { width: 3840, height: 2160, fps: 60, bitrate: 80_000 } },
  ];

  return (
    <ScrollView automaticallyAdjustKeyboardInsets keyboardShouldPersistTaps="handled" style={{ backgroundColor: colors.bg0 }} contentContainerStyle={{ paddingTop: insets.top + 16, paddingHorizontal: 18, paddingBottom: insets.bottom + 110, gap: 22, maxWidth: 700, width: '100%', alignSelf: 'center' }}>
      <Text style={{ fontFamily: fonts.display, fontSize: 28, color: colors.ink }}>Réglages</Text>

      {isTunnelAvailable ? <NetworkSection /> : null}

      <Section title="API homelab">
        <Field label="Adresse (via Tailscale)" value={settings.apiUrl} onChangeText={(apiUrl) => update({ apiUrl: apiUrl.trim() })} keyboardType="url" placeholder="http://homelab:8085" />
        <Field label="Jeton" value={settings.apiToken} onChangeText={(apiToken) => update({ apiToken: apiToken.trim() })} secureTextEntry placeholder="WAKEN_TOKEN du homelab" />
      </Section>

      <Section title="Moteur de stream">
        {engines.map((e) => (
          <Choice key={e.id} label={e.label} hint={e.hint} selected={settings.engine === e.id} onPress={() => update({ engine: e.id })} />
        ))}
        {settings.engine === 'moonlight-app' ? (
          <Field label="Lien d'ouverture de Moonlight" value={settings.moonlightUrl} onChangeText={(moonlightUrl) => update({ moonlightUrl: moonlightUrl.trim() })} keyboardType="url" placeholder="schéma:// ou lien de raccourci" />
        ) : null}
      </Section>

      <Section title="PlayStation">
        <Field label="Lien d'ouverture de PS Remote Play" value={settings.psRemotePlayUrl} onChangeText={(psRemotePlayUrl) => update({ psRemotePlayUrl: psRemotePlayUrl.trim() })} keyboardType="url" placeholder="schéma:// ou lien de raccourci" />
      </Section>

      <Section title="Qualité">
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {qualities.map((q) => {
            const sel = settings.stream.width === q.s.width && settings.stream.fps === q.s.fps;
            return (
              <Pressable key={q.label} onPress={() => update({ stream: { ...settings.stream, ...q.s } })} style={[styles.chip, sel && styles.chipSel]}>
                <Text style={[type.metricS, { color: sel ? colors.neonInk : colors.ink }]}>{q.label}</Text>
              </Pressable>
            );
          })}
        </View>
      </Section>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  chip: { height: 40, paddingHorizontal: 14, borderRadius: radius.pill, backgroundColor: colors.bg2, borderWidth: 1, borderColor: colors.line, justifyContent: 'center' },
  chipSel: { backgroundColor: colors.neon, borderColor: colors.neon },
});
