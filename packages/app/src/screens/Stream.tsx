import { useEffect, useRef, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { ChevronDown, ChevronUp, Keyboard, X } from 'lucide-react-native';
import { AgentClient, HttpError } from '@waken/core';
import { colors, fonts, PillButton, PressScale, RoundButton, type } from '@waken/ui';
import { useDevice, useGame } from '../hooks';
import { useNav } from '../nav';
import { pathTo, pointStreamAt } from '../network';
import { platform, type LaunchInfo, type StreamState, type StreamStats } from '../platform';
import { forPath } from '../quality';
import { useWaken } from '../store';

const CONFLICT = 409;

/** In game: the native video view, and a small HUD (game, connection, keyboard, quit). */
export function StreamScreen({ deviceId, gameId, app: appParam }: { deviceId: string; gameId?: string; app?: string }) {
  const nav = useNav();
  const device = useDevice(deviceId);
  const game = useGame(gameId);
  const chosen = useWaken((s) => s.settings.stream);
  const { StreamView, toggleKeyboard, form } = platform();
  // Lowered when the tunnel only has a relayed path: 40 Mb/s through a relay loses most of the video.
  const [q, setQ] = useState(chosen);
  const [relayed, setRelayed] = useState(false);
  const [hud, setHud] = useState(true);
  const [state, setState] = useState<StreamState>({ state: 'connecting' });
  const [stats, setStats] = useState<StreamStats | null>(null);
  const [launch, setLaunch] = useState<LaunchInfo | null>(null);
  const requested = useRef(false);
  const title = game?.title ?? (appParam && appParam !== 'Desktop' ? appParam : 'Bureau');

  // Ask the machine's agent to launch the game (it pairs with Sunshine by itself the first time).
  useEffect(() => {
    // Only once: Sunshine ignores a second launch while the first waits for its stream, whose key would then be lost.
    if (!StreamView || !device || requested.current) return;
    requested.current = true;

    const agent = new AgentClient(device);
    const app = appParam || 'Desktop';
    const start = async (replace: boolean) => {
      await pointStreamAt(device);
      const path = await pathTo(device);
      const quality = forPath(chosen, path);
      setRelayed(path === 'relayed');
      setQ(quality);
      const launched = await agent.launch(app, quality, replace);
      setLaunch({ ...launched, address: device.stream!.host });
    };
    const fail = (e: Error) => setState({ state: 'error', message: `Lancement impossible : ${e.message}` });

    start(false).catch((e: Error) => {
      if (!(e instanceof HttpError && e.status === CONFLICT)) return fail(e);
      // Another game runs: closing it loses what was not saved, so ask.
      Alert.alert('Un autre jeu tourne', e.message, [
        { text: 'Annuler', style: 'cancel', onPress: nav.back },
        { text: `Fermer et lancer ${title}`, style: 'destructive', onPress: () => start(true).catch(fail) },
      ]);
    });
  }, []);

  const closeGame = async () => {
    try {
      await new AgentClient(device!).quit();
      nav.back();
    } catch (e) {
      Alert.alert('Le jeu tourne encore', e instanceof Error ? e.message : String(e));
    }
  };

  // Leaving only disconnects: closing the game loses what was not saved, so it is always an explicit choice.
  const leave = () => {
    if (!launch) return nav.back();
    Alert.alert('Quitter le stream ?', 'Le jeu continue sur ta machine, tu pourras le reprendre.', [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Quitter le stream', onPress: nav.back },
      { text: 'Fermer le jeu', style: 'destructive', onPress: () => void closeGame() },
    ]);
  };

  if (!StreamView || !device) {
    return (
      <View style={[styles.root, { alignItems: 'center', justifyContent: 'center', padding: 32, gap: 16 }]}>
        <Text style={[type.title, { color: colors.white, textAlign: 'center' }]}>Stream indisponible</Text>
        <Text style={[type.body, { color: colors.sky, textAlign: 'center', maxWidth: 480 }]}>
          Ce build ne contient pas le module de stream. Lance un vrai build de l'app, pas Expo Go.
        </Text>
        <PillButton label="Retour" variant="white" onPress={nav.back} />
      </View>
    );
  }

  const quality = state.state === 'error' ? 'Erreur' : state.state !== 'streaming' ? 'Connexion…' : relayed ? 'Relais · 720p' : 'Connexion top';
  const dot = state.state === 'error' ? colors.danger : state.state !== 'streaming' ? colors.waking : relayed ? colors.hot : colors.online;

  return (
    <View style={styles.root}>
      {launch ? (
        <StreamView launch={launch} settings={q} remote onStateChange={setState} onStats={setStats} />
      ) : null}
      {hud ? (
        <>
          <View pointerEvents="none" style={[styles.pill, { top: 18, left: 24 }]}>
            <Text numberOfLines={1} style={[type.display, { fontSize: 20, lineHeight: 26, color: colors.white, maxWidth: 260 }]}>
              {title}
            </Text>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: dot }} />
            <Text style={[type.chip, { color: colors.white }]}>{quality}</Text>
            {stats ? <Text style={styles.metric}>{`${stats.rttMs} ms · ${Math.round(stats.fps)} i/s`}</Text> : null}
          </View>
          <View style={{ position: 'absolute', top: 18, right: 24, flexDirection: 'row', gap: 8 }}>
            {toggleKeyboard ? <RoundButton icon={Keyboard} label="Clavier" size={44} variant="frost" onPress={toggleKeyboard} /> : null}
            <RoundButton icon={ChevronUp} label="Masquer les contrôles" size={44} variant="frost" onPress={() => setHud(false)} />
            <PressScale onPress={leave} style={styles.quit} accessibilityRole="button" accessibilityLabel="Quitter">
              <X size={16} color={colors.white} strokeWidth={3} />
              <Text style={[type.button, { fontSize: 14, color: colors.white }]}>Quitter</Text>
            </PressScale>
          </View>
          <View pointerEvents="none" style={[styles.pill, { bottom: 18, alignSelf: 'center' }]}>
            <Text style={[type.caption, { color: colors.white }]}>
              {state.state === 'error' ? state.message : state.state === 'connecting' ? 'Connexion à ta machine…' : form === 'phone' ? 'Masque les contrôles pour jouer plein écran' : 'Ctrl + Alt + Maj + Q pour quitter'}
            </Text>
          </View>
        </>
      ) : (
        // A button, not a full-screen overlay: every other touch belongs to the game.
        <View style={styles.showControls}>
          <RoundButton icon={ChevronDown} label="Afficher les contrôles" size={34} variant="frost" onPress={() => setHud(true)} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  pill: { position: 'absolute', flexDirection: 'row', alignItems: 'center', gap: 10, height: 44, paddingHorizontal: 16, borderRadius: 999, backgroundColor: colors.glass, borderWidth: 1, borderColor: colors.glassLine },
  metric: { fontFamily: fonts.semibold, fontSize: 12, color: colors.sky },
  showControls: { position: 'absolute', top: 8, alignSelf: 'center', opacity: 0.6 },
  quit: { height: 44, paddingHorizontal: 18, borderRadius: 999, backgroundColor: colors.danger, flexDirection: 'row', alignItems: 'center', gap: 7 },
});
