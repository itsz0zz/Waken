import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, View } from 'react-native';
import { Check, ChevronDown, ChevronUp, Keyboard, X } from 'lucide-react-native';
import { AgentClient, HttpError, type Game } from '@waken/core';
import { Art, colors, FadeIn, fonts, PillButton, PressScale, RoundButton, TiltedArt, type } from '@waken/ui';
import { useDevice, useGame, useGameArt } from '../hooks';
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
  const run = () => {
    if (!device) return;
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
  };
  useEffect(() => {
    // Only once: Sunshine ignores a second launch while the first waits for its stream, whose key would then be lost.
    if (!StreamView || !device || requested.current) return;
    requested.current = true;
    run();
  }, []);

  const retry = () => {
    setLaunch(null);
    setStats(null);
    setState({ state: 'connecting' });
    run();
  };

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

  // Until the first picture, the player sees a loading screen, never a black screen with a status line.
  const live = state.state === 'streaming';
  const quality = state.state === 'error' ? 'Erreur' : state.state !== 'streaming' ? 'Connexion…' : relayed ? 'Relais · 720p' : 'Connexion top';
  const dot = state.state === 'error' ? colors.danger : state.state !== 'streaming' ? colors.waking : relayed ? colors.hot : colors.online;

  return (
    <View style={styles.root}>
      {launch ? (
        <StreamView launch={launch} settings={q} remote onStateChange={setState} onStats={setStats} />
      ) : null}
      {!live ? (
        <StreamLoading
          game={game}
          title={title}
          machine={device.name}
          step={!launch ? 'launch' : 'connect'}
          error={state.state === 'error' ? state.message : state.state === 'stopped' ? 'La machine a arrêté le stream.' : undefined}
          onCancel={nav.back}
          onRetry={retry}
        />
      ) : hud ? (
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
              {form === 'phone' ? 'Masque les contrôles pour jouer plein écran' : 'Ctrl + Alt + Maj + Q pour quitter'}
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

type Step = 'launch' | 'connect';
const steps: { id: Step | 'play'; label: string }[] = [
  { id: 'launch', label: 'Lancement du jeu sur ta machine' },
  { id: 'connect', label: 'Connexion au stream' },
  { id: 'play', label: "Première image" },
];

/** Over the stream until its first picture: the game, what is happening, and a way out. */
function StreamLoading({ game, title, machine, step, error, onCancel, onRetry }: {
  game?: Game;
  title: string;
  machine: string;
  step: Step;
  error?: string;
  onCancel: () => void;
  onRetry: () => void;
}) {
  const hero = useGameArt(game, 'hero');
  const cover = useGameArt(game, 'cover');
  const current = steps.findIndex((s) => s.id === step);
  return (
    <View style={[StyleSheet.absoluteFill, styles.loading]}>
      {hero ? <Art source={hero} blur={30} style={[StyleSheet.absoluteFill, { opacity: 0.35 }]} /> : null}
      <FadeIn style={{ alignItems: 'center', gap: 22, maxWidth: 440, width: '100%', paddingHorizontal: 28 }}>
        <TiltedArt source={cover} title={title} width={150} height={196} rotate={-4} />
        <View style={{ alignItems: 'center', gap: 4 }}>
          <Text numberOfLines={2} style={[type.display, { fontSize: 30, lineHeight: 38, color: colors.white, textAlign: 'center' }]}>{title}</Text>
          <Text style={[type.caption, { color: colors.sky }]}>{machine}</Text>
        </View>
        {error ? (
          <View style={{ alignItems: 'center', gap: 16 }}>
            <Text style={[type.body, { color: colors.white, textAlign: 'center' }]}>{error}</Text>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <PillButton label="Retour" variant="frost" onPress={onCancel} />
              <PillButton label="Réessayer" variant="white" onPress={onRetry} />
            </View>
          </View>
        ) : (
          <>
            <View style={{ alignSelf: 'stretch', gap: 12 }}>
              {steps.map((s, i) => (
                <View key={s.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, opacity: i > current ? 0.45 : 1 }}>
                  <View style={styles.stepDot}>
                    {i < current ? <Check size={14} color={colors.ink} strokeWidth={3} /> : i === current ? <ActivityIndicator size="small" color={colors.ink} /> : null}
                  </View>
                  <Text style={[type.body, { color: colors.white }]}>{s.label}</Text>
                </View>
              ))}
            </View>
            <PillButton label="Annuler" variant="frost" onPress={onCancel} />
          </>
        )}
      </FadeIn>
    </View>
  );
}

const styles = StyleSheet.create({
  loading: { backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' },
  stepDot: { width: 26, height: 26, borderRadius: 13, backgroundColor: colors.lime, alignItems: 'center', justifyContent: 'center' },
  root: { flex: 1, backgroundColor: '#000' },
  pill: { position: 'absolute', flexDirection: 'row', alignItems: 'center', gap: 10, height: 44, paddingHorizontal: 16, borderRadius: 999, backgroundColor: colors.glass, borderWidth: 1, borderColor: colors.glassLine },
  metric: { fontFamily: fonts.semibold, fontSize: 12, color: colors.sky },
  showControls: { position: 'absolute', top: 8, alignSelf: 'center', opacity: 0.6 },
  quit: { height: 44, paddingHorizontal: 18, borderRadius: 999, backgroundColor: colors.danger, flexDirection: 'row', alignItems: 'center', gap: 7 },
});
