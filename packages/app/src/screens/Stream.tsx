import { useEffect, useRef, useState } from 'react';
import { Alert, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { AgentClient, HttpError } from '@waken/core';
import { colors, PillButton, type } from '@waken/ui';
import { useDevice, useGame } from '../hooks';
import { useNav } from '../nav';
import { connectionLog, pathTo, pointStreamAt, streamAddress } from '../network';
import { platform, type LaunchInfo, type StreamState, type StreamStats } from '../platform';
import { fitToWindow, forPath } from '../quality';
import { useWaken } from '../store';
import { platformOf } from './parts';
import { applyChoices, defaultChoices, StreamHud, type StreamChoices } from './StreamHud';

const CONFLICT = 409;
/** Connected without a single picture for this long: something is wrong on the computer. */
const NO_PICTURE_MS = 20_000;
/** How long a direct path may take to appear before the stream settles for the relay's quality. */
const PATH_WAIT_MS = 3000;

/**
 * In game: the native video view, and the HUD (StreamHud: one button, its menu, the figures).
 * Until the first picture it shows nothing: it sits, invisible, over the screen that started it (Réveil), which
 * keeps the player waiting. onLive says when the picture is there; onFail, why it never came.
 */
export function StreamScreen({
  deviceId,
  gameId,
  app: appParam,
  onLive,
  onFail,
  startedAt,
}: {
  deviceId: string;
  /** When the player asked, for the timings of the log. */
  startedAt?: number;
  gameId?: string;
  app?: string;
  onLive?: (live: boolean) => void;
  onFail?: (message: string) => void;
}) {
  const nav = useNav();
  const device = useDevice(deviceId);
  const game = useGame(gameId);
  const chosen = useWaken((s) => s.settings.stream);
  const smooth = useWaken((s) => s.settings.smoothing ?? true);
  const textInput = useWaken((s) => s.settings.keyboard === 'text');
  const { StreamView, toggleKeyboard, setFullscreen } = platform();
  // The desktop's full screen: the window's, given back when the stream ends.
  const [fullscreen, setFullscreenState] = useState(false);
  const toggleFullscreen = () => {
    setFullscreen?.(!fullscreen);
    setFullscreenState(!fullscreen);
  };
  useEffect(() => () => setFullscreen?.(false), []);
  // Lowered when the tunnel only has a relayed path: 40 Mb/s through a relay loses most of the video.
  const [q, setQ] = useState(chosen);
  const [relayed, setRelayed] = useState(false);
  // What the player changed from the menu: sound at once, the rest by restarting the stream with it.
  const [choices, setChoices] = useState<StreamChoices>(defaultChoices);
  const [muted, setMuted] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [state, setState] = useState<StreamState>({ state: 'connecting' });
  const [stats, setStats] = useState<StreamStats | null>(null);
  const [launch, setLaunch] = useState<LaunchInfo | null>(null);
  const requested = useRef(false);
  const began = useRef(startedAt ?? Date.now());
  const log = (step: string) => connectionLog(began.current, step);
  const title = game?.title ?? (appParam && appParam !== 'Desktop' ? appParam : 'Bureau');
  const window = useWindowDimensions();

  // Ask the machine's agent to launch the game (it pairs with Sunshine by itself the first time).
  const run = (with_: StreamChoices = choices) => {
    if (!device) return;
    const agent = new AgentClient(device);
    const app = appParam || 'Desktop';
    const start = async (replace: boolean) => {
      log('lancement demandé');
      await pointStreamAt(device);
      // The search for a direct path started with Réveil (pointStreamAt): only what is left of its 3 s is waited for.
      const path = await pathTo(device, Math.max(0, PATH_WAIT_MS - (Date.now() - began.current)));
      log(`chemin ${path === 'direct' ? 'direct' : 'relayé'}`);
      // A PC's screen takes the window's shape for the stream (no black bars); a Mac keeps its own.
      const base = forPath(chosen, path);
      const fitted = device.detail === 'Mac' ? base : fitToWindow(base, Math.max(window.width, window.height), Math.min(window.width, window.height));
      const quality = applyChoices(fitted, with_);
      setRelayed(path === 'relayed');
      setQ(quality);
      const launched = await agent.launch(app, quality, replace);
      const steps = Object.entries(launched.timings ?? {}).map(([name, ms]) => `${name} ${ms} ms`);
      log(`jeu lancé${steps.length ? ` (machine : ${steps.join(', ')})` : ''}`);
      setLaunch({ ...launched, address: await streamAddress(device) });
    };
    const fail = (e: Error) => setState({ state: 'error', message: `Lancement impossible : ${e.message}` });
    setState({ state: 'connecting' });

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

  // Live from the first picture on: from then, a problem shows in the HUD instead of sending back to Réveil.
  const [everLive, setEverLive] = useState(false);
  // Live when pictures arrive, not when the connection is up: a computer that connects but sends nothing
  // (screen recording not allowed, a stale stream server) must not show a black screen.
  const live = state.state === 'streaming' && (stats?.fps ?? 0) > 0;
  useEffect(() => {
    if (everLive) return;
    const detail = state.state === 'connecting' ? state.stage : state.state === 'error' ? state.message : undefined;
    log(`stream : ${state.state}${detail ? ` (${detail})` : ''}`);
  }, [state]);
  useEffect(() => {
    if (everLive || state.state !== 'streaming') return;
    const timer = setTimeout(
      () => onFail?.("Ta machine est connectée mais n'envoie aucune image. Sur le Mac, vérifie que Waken peut enregistrer l'écran, puis relance Waken."),
      NO_PICTURE_MS
    );
    return () => clearTimeout(timer);
  }, [state.state, everLive]);
  useEffect(() => {
    if (live && !everLive) log('première image');
    if (live) setEverLive(true);
    onLive?.(live || everLive);
  }, [live]);
  useEffect(() => {
    if (everLive) return;
    if (state.state === 'error') onFail?.(state.message);
    else if (state.state === 'stopped') onFail?.('La machine a arrêté le stream avant la première image.');
  }, [state, everLive]);

  // A setting of the menu: the stream starts again with it (the game keeps running, Sunshine resumes it).
  const changeChoices = (next: StreamChoices) => {
    began.current = Date.now();
    setChoices(next);
    setLaunch(null);
    setStats(null);
    setState({ state: 'connecting' });
    run(next);
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

  const unavailable = !StreamView || !device;
  useEffect(() => {
    // Inside Réveil: it says it, with its own error screen.
    if (unavailable) onFail?.(!device ? 'Machine introuvable.' : 'Ce build ne contient pas le module de stream.');
  }, [unavailable]);

  if (unavailable) {
    if (onFail) return null;
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

  return (
    // Not live yet: there, connecting, but invisible and untouchable over the screen underneath.
    <View collapsable={false} style={[styles.root, !everLive && styles.hidden]} pointerEvents={everLive ? 'auto' : 'none'}>
      {launch ? <StreamView launch={launch} settings={q} remote muted={muted} paused={menuOpen} smooth={smooth} hostMac={platformOf(device) === 'mac'} textInput={textInput} onStateChange={setState} onStats={setStats} /> : null}
      {everLive ? (
        <StreamHud
          title={title}
          state={state}
          stats={stats}
          settings={q}
          relayed={relayed}
          choices={choices}
          onChoices={changeChoices}
          muted={muted}
          onMuted={setMuted}
          fullscreen={fullscreen}
          onFullscreen={setFullscreen ? toggleFullscreen : undefined}
          onKeyboard={toggleKeyboard}
          onLeave={leave}
          onMenu={setMenuOpen}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  hidden: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, opacity: 0, backgroundColor: 'transparent' },
  root: { flex: 1, backgroundColor: '#000' },
});
