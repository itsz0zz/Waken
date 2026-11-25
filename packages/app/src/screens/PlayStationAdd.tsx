import { useState } from 'react';
import { ActivityIndicator, Linking, Text, View } from 'react-native';
import { Check, Gamepad2, Search, UserRound } from 'lucide-react-native';
import { PSN_LOGIN_URL, psnAccountFromCode, psnCodeFrom } from '@waken/core';
import { Card, colors, Display, Field, IconBubble, PillButton, type } from '@waken/ui';
import { useNav } from '../nav';
import { platform } from '../platform';
import { consoleDevice, type FoundConsole } from '../playstation';
import { useWaken } from '../store';
import { BackHeader } from './parts';
import { Screen } from './Screen';

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Linking a PS5 or PS4, once: the PlayStation Network account (signed in on Sony's own page), the console on this
 * network, then the 8-digit code it shows in Settings, System, Remote Play, Link device.
 */
export function PlayStationAddScreen() {
  const nav = useNav();
  const api = platform().playstation;
  const account = useWaken((s) => s.settings.psn);
  const update = useWaken((s) => s.updateSettings);
  const upsert = useWaken((s) => s.upsertDevice);

  const [pasted, setPasted] = useState('');
  const [signingIn, setSigningIn] = useState(false);
  const [consoles, setConsoles] = useState<FoundConsole[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [chosen, setChosen] = useState<{ host: string; ps5: boolean } | null>(null);
  const [manual, setManual] = useState('');
  const [manualPs5, setManualPs5] = useState(true);
  const [pin, setPin] = useState('');
  const [linking, setLinking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!api) {
    return (
      <Screen ground="sky" maxWidth={600}>
        <BackHeader title="PlayStation" />
        <Card style={{ marginTop: 22 }}>
          <Text style={[type.body, { color: colors.ink2 }]}>Cette version de l'app ne gère pas encore la PlayStation.</Text>
        </Card>
      </Screen>
    );
  }

  const signIn = async () => {
    const code = psnCodeFrom(pasted);
    if (!code) return setError("Colle l'adresse complète de la page où Sony t'a envoyé après la connexion.");
    setSigningIn(true);
    setError(null);
    try {
      const { accountId } = await psnAccountFromCode(code);
      update({ psn: { accountId } });
      setPasted('');
    } catch (e) {
      setError(message(e));
    } finally {
      setSigningIn(false);
    }
  };

  const search = async () => {
    setSearching(true);
    setError(null);
    try {
      const found = await api.discover(3);
      setConsoles(found);
      if (found.length === 1) setChosen({ host: found[0]!.host, ps5: found[0]!.ps5 });
    } catch (e) {
      setError(message(e));
    } finally {
      setSearching(false);
    }
  };

  const link = async () => {
    const target = chosen ?? (manual.trim() ? { host: manual.trim(), ps5: manualPs5 } : null);
    if (!target || !account) return;
    setLinking(true);
    setError(null);
    try {
      const linked = await api.register(target.host, target.ps5, account.accountId, pin);
      upsert(consoleDevice(target.host, linked));
      nav.machines();
    } catch (e) {
      setError(message(e));
    } finally {
      setLinking(false);
    }
  };

  return (
    <Screen ground="sky" maxWidth={600}>
      <BackHeader title="PlayStation" />
      <Display size={64} style={{ marginTop: 18 }}>
        Ta PS5
      </Display>

      <Card lifted style={{ marginTop: 22, gap: 12 }}>
        <Step n={1} icon={UserRound} title="Compte PlayStation Network" done={!!account} />
        {account ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Text style={[type.caption, { flex: 1, color: colors.ink2 }]}>Connecté. Les consoles se lient avec ce compte.</Text>
            <PillButton label="Changer" size="sm" variant="white" onPress={() => update({ psn: undefined })} />
          </View>
        ) : (
          <>
            <Text style={[type.caption, { color: colors.ink2 }]}>
              Connecte-toi sur la page de Sony (ton mot de passe reste chez Sony). Une fois connecté, la page affiche une adresse
              « remoteplay.dl.playstation.net/… » : copie-la et colle-la ici.
            </Text>
            <PillButton label="Se connecter à PlayStation Network" onPress={() => void Linking.openURL(PSN_LOGIN_URL)} />
            <Field label="Adresse de la page après la connexion" value={pasted} onChangeText={setPasted} placeholder="https://remoteplay.dl.playstation.net/remoteplay/redirect?code=…" />
            <PillButton label="Valider" size="sm" loading={signingIn} disabled={!pasted.trim() || signingIn} onPress={() => void signIn()} />
          </>
        )}
      </Card>

      <Card lifted style={{ marginTop: 16, gap: 12, opacity: account ? 1 : 0.5 }}>
        <Step n={2} icon={Search} title="La console" done={!!chosen} />
        <Text style={[type.caption, { color: colors.ink2 }]}>Allumée ou en mode repos, sur le même réseau que cet appareil.</Text>
        <PillButton label="Chercher" icon={Search} size="sm" variant="white" loading={searching} disabled={!account || searching} onPress={() => void search()} />
        {searching ? <ActivityIndicator color={colors.ink} /> : null}
        {consoles?.map((c) => {
          const on = chosen?.host === c.host;
          return (
            <PillButton
              key={c.host}
              label={`${c.name} · ${c.ps5 ? 'PS5' : 'PS4'} · ${c.state === 'ready' ? 'allumée' : c.state === 'standby' ? 'en repos' : c.host}`}
              size="sm"
              variant={on ? 'ink' : 'white'}
              icon={on ? Check : Gamepad2}
              onPress={() => setChosen({ host: c.host, ps5: c.ps5 })}
            />
          );
        })}
        {consoles && consoles.length === 0 ? <Text style={[type.caption, { color: colors.ink2 }]}>Aucune console trouvée sur ce réseau.</Text> : null}
        {/* Always there: the search can miss a console (another network, a blocked broadcast). */}
        <Text style={[type.caption, { color: colors.ink2 }]}>
          Ou tape son adresse : sur la console, Paramètres, Réseau, Afficher l’état de la connexion (adresse IP).
        </Text>
        <Field
          label="Adresse de la console"
          value={manual}
          onChangeText={(t) => {
            setManual(t);
            if (t.trim()) setChosen(null);
          }}
          placeholder="192.168.1.20"
          keyboardType="numbers-and-punctuation"
        />
        {manual.trim() ? (
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <PillButton label="PS5" size="sm" variant={manualPs5 ? 'ink' : 'white'} onPress={() => setManualPs5(true)} />
            <PillButton label="PS4" size="sm" variant={manualPs5 ? 'white' : 'ink'} onPress={() => setManualPs5(false)} />
          </View>
        ) : null}
      </Card>

      <Card lifted style={{ marginTop: 16, gap: 12, opacity: chosen || manual.trim() ? 1 : 0.5 }}>
        <Step n={3} icon={Gamepad2} title="Le code de liaison" done={false} />
        <Text style={[type.caption, { color: colors.ink2 }]}>
          Sur la console : Paramètres, Système, Lecture à distance. Active d’abord « Activer la lecture à distance » : l’option
          « Associer un appareil » apparaît alors, avec un code à 8 chiffres.
        </Text>
        <Field label="Code à 8 chiffres" value={pin} onChangeText={(t) => setPin(t.replace(/\D/g, '').slice(0, 8))} keyboardType="number-pad" placeholder="12345678" />
        <PillButton label="Lier la console" loading={linking} disabled={!account || !(chosen || manual.trim()) || pin.length !== 8 || linking} onPress={() => void link()} />
      </Card>

      {error ? <Text style={[type.body, { color: colors.danger, marginTop: 16 }]}>{error}</Text> : null}
    </Screen>
  );
}

function Step({ n, icon, title, done }: { n: number; icon: typeof Search; title: string; done: boolean }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <IconBubble icon={done ? Check : icon} color={done ? colors.online : colors.violet} />
      <Text style={[type.label, { color: colors.ink }]}>
        {n}. {title}
      </Text>
    </View>
  );
}
