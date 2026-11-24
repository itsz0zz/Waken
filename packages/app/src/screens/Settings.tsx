import { useState } from 'react';
import { Alert, Linking, Text, View } from 'react-native';
import { ChevronRight, Gamepad2, LogOut, Power, Server, Smartphone, Trash2, UserRound, Wifi } from 'lucide-react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { cloud, setNetworkMode, signOutAccount, useAccount } from '../account';
import { hostDisplayName, validateApiUrl } from '@waken/core';
import { AppMark, Card, colors, Display, Field, IconBubble, PillButton, Segmented, SettingRow, type } from '@waken/ui';
import { useBestStreak } from '../hooks';
import { useGamepads } from '../gamepads';
import { useFrame, useNav } from '../nav';
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
  const mode = useAccount((s) => s.mode);
  const quality = qualityOf(settings.stream);
  // The longest run of days played, across the machines (each one keeps its own).
  const streak = useBestStreak(devices);

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
              <Text style={[type.headline, { fontSize: 20, color: colors.ink }]}>{devices.find((d) => d.local)?.name ?? platform().deviceName ?? 'Cet appareil'}</Text>
              <Text style={[type.caption, { color: colors.ink2 }]}>
                {devices.filter((d) => !d.local).length} {devices.filter((d) => !d.local).length > 1 ? 'autres machines' : 'autre machine'}
                {streak ? ` · ${streak} ${streak > 1 ? 'jours' : 'jour'} de suite` : ''}
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

          <StartupCard />

          <GamepadsCard />

          <AccountCard />

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
              {mode === 'tailscale' && status?.state === 'needs-login' && status.loginUrl ? (
                <PillButton label="Se connecter à Tailscale" size="sm" onPress={() => Linking.openURL(status.loginUrl!)} />
              ) : null}
              {mode === 'tailscale' && status?.state === 'running' ? <PillButton label="Se déconnecter de Tailscale" icon={LogOut} variant="ghost" size="sm" onPress={confirmSignOut} /> : null}
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

/** The Waken account: who is signed in, the account's devices, sign out, delete. */
/**
 * Windows: Waken from the PC's start, sign-in screen included, and woken from the network. Windows asks for the
 * administrator's confirmation each time it changes.
 */
function StartupCard() {
  const startup = platform().startup;
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [fastStartupOff, setFastStartupOff] = useState(true);
  const { data: on } = useQuery({ queryKey: ['startup'], enabled: !!startup, queryFn: () => startup!.get() });
  if (!startup) return null;
  const change = async (next: boolean) => {
    setBusy(true);
    try {
      await startup.set(next, fastStartupOff);
    } catch (e) {
      Alert.alert('Démarrage avec Windows', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      void queryClient.invalidateQueries({ queryKey: ['startup'] });
    }
  };
  return (
    <Card style={{ gap: 12 }}>
      <SettingRow
        icon={Power}
        color={on ? colors.online : colors.muted}
        label="Démarrer avec Windows et réveil à distance"
        hint={
          busy
            ? 'Confirme dans la fenêtre de Windows…'
            : on
              ? 'Waken tourne dès l’allumage du PC, écran de connexion compris, et sa carte réseau répond au réveil.'
              : 'Waken ne tourne qu’une fois l’app ouverte. Active-le pour réveiller ce PC à distance et jouer dès l’allumage.'
        }
        value={!!on}
        // Kept on screen while Windows asks, so the row does not lose its switch; a second tap does nothing.
        onValueChange={(next) => (busy ? undefined : void change(next))}
      />
      {!on ? (
        <SettingRow
          icon={Power}
          color={colors.muted}
          label="Couper le démarrage rapide de Windows"
          hint="Sans ça, beaucoup de cartes réseau ne réveillent plus un PC éteint (la veille marche toujours)."
          value={fastStartupOff}
          onValueChange={setFastStartupOff}
        />
      ) : null}
      <Text style={[type.caption, { color: colors.ink2 }]}>
        Reste à activer le Wake-on-LAN dans le BIOS. Depuis Internet : sur la box, une IP fixe pour ce PC et une redirection UDP du port 9 vers elle.
      </Text>
    </Card>
  );
}

/** The controllers of this device: how many, and the way to their page. */
function GamepadsCard() {
  const nav = useNav();
  const { data: pads } = useGamepads();
  if (!platform().gamepads) return null;
  const count = pads?.length ?? 0;
  return (
    <Card style={{ gap: 0 }}>
      <SettingRow
        icon={Gamepad2}
        color={count ? colors.online : colors.muted}
        label="Manettes"
        hint={count ? `${count} connectée${count > 1 ? 's' : ''} : ${pads!.map((p) => p.name).join(', ')}` : 'Vibrations, gyroscope, type de manette'}
        right={<PillButton label="Ouvrir" icon={ChevronRight} size="sm" variant="white" onPress={nav.gamepads} />}
      />
    </Card>
  );
}

function AccountCard() {
  const { mode, email, session, provider } = useAccount();
  const queryClient = useQueryClient();
  const devices = useQuery({ queryKey: ['account-devices', email], queryFn: () => cloud().devices(), enabled: mode === 'account' && !!session, refetchInterval: 30_000 });
  const [deleting, setDeleting] = useState(false);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const self = useNetwork((s) => s.status?.self?.name);

  if (mode === 'tailscale') {
    return (
      <Card style={{ gap: 10 }}>
        <SettingRow icon={UserRound} color={colors.muted} label="Compte Waken" hint="Cet appareil utilise Tailscale directement." />
        <PillButton label="Utiliser un compte Waken" size="sm" onPress={() => setNetworkMode('account')} />
      </Card>
    );
  }
  if (!session) return null;

  const remove = (id: string, name: string) =>
    Alert.alert(`Retirer ${name} ?`, "Il ne pourra plus joindre tes machines. Pour le remettre, reconnecte-le à ton compte.", [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Retirer',
        style: 'destructive',
        onPress: () =>
          void cloud()
            .removeDevice(id)
            .then(() => queryClient.invalidateQueries({ queryKey: ['account-devices'] }))
            .catch((e: Error) => Alert.alert('Appareil non retiré', e.message)),
      },
    ]);

  const signOut = () =>
    Alert.alert('Se déconnecter ?', "Tes machines disparaissent de cet appareil jusqu'à la prochaine connexion.", [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Se déconnecter', style: 'destructive', onPress: () => void signOutAccount().catch((e: Error) => Alert.alert('Déconnexion', e.message)) },
    ]);

  const deleteAccount = async () => {
    setBusy(true);
    try {
      if (provider === 'apple') {
        // No password: Apple confirms it is still you.
        const ask = platform().appleSignIn;
        const credential = ask ? await ask() : null;
        if (!credential) return;
        await cloud().deleteAccount({ appleIdentityToken: credential.identityToken });
      } else {
        await cloud().deleteAccount({ password });
      }
      await signOutAccount().catch(() => {});
    } catch (e) {
      Alert.alert('Compte non supprimé', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setPassword('');
    }
  };

  return (
    <Card style={{ gap: 10 }}>
      <SettingRow icon={UserRound} color={colors.violet} label="Compte Waken" hint={email ?? 'Connecté'} />
      <Text style={[type.label, { color: colors.ink, marginTop: 4 }]}>Appareils du compte</Text>
      {devices.isLoading ? <Text style={[type.caption, { color: colors.ink2 }]}>Chargement…</Text> : null}
      {devices.error ? <Text style={[type.caption, { color: colors.danger }]}>{(devices.error as Error).message}</Text> : null}
      {devices.data?.map((d) => (
        <View key={d.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <IconBubble icon={d.name.startsWith('waken-host-') ? Server : Smartphone} color={d.online ? colors.online : colors.muted} size={32} />
          <View style={{ flex: 1 }}>
            <Text style={[type.body, { color: colors.ink, textTransform: 'capitalize' }]} numberOfLines={1}>
              {hostDisplayName(d.name).replace(/^waken /, '')}
              {d.name === self ? ' (cet appareil)' : ''}
            </Text>
            <Text style={[type.caption, { color: colors.ink2 }]}>{d.online ? 'En ligne' : 'Hors ligne'}</Text>
          </View>
          {d.name === self ? null : <PillButton label="Retirer" size="sm" variant="ghost" onPress={() => remove(d.id, hostDisplayName(d.name))} />}
        </View>
      ))}
      <PillButton label="Se déconnecter" icon={LogOut} variant="outline" size="sm" onPress={signOut} />
      {deleting ? (
        <View style={{ gap: 10 }}>
          <Text style={[type.caption, { color: colors.ink2 }]}>
            Tous tes appareils quittent le réseau Waken et le compte est effacé. Ça ne se rattrape pas.
          </Text>
          {provider === 'apple' ? null : <Field label="Mot de passe" value={password} onChangeText={setPassword} secureTextEntry textContentType="password" />}
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <PillButton label="Annuler" variant="ghost" size="sm" onPress={() => setDeleting(false)} />
            <PillButton
              label={provider === 'apple' ? 'Confirmer avec Apple et supprimer' : 'Supprimer définitivement'}
              icon={Trash2}
              size="sm"
              loading={busy}
              disabled={(provider !== 'apple' && !password) || busy}
              onPress={() => void deleteAccount()}
            />
          </View>
        </View>
      ) : (
        <PillButton label="Supprimer le compte" variant="ghost" size="sm" onPress={() => setDeleting(true)} />
      )}
    </Card>
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
