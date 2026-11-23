import { useEffect, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ChevronDown, ChevronUp, Keyboard, X } from 'lucide-react-native';
import { StreamView, WakenStream, isNativeStreamAvailable, type LaunchInfo, type StreamState, type StreamStats } from 'waken-stream';
import { AgentClient, HttpError } from '@waken/core';
import { Button, colors, DeviceIcon, fonts, IconButton, StatusDot, type } from '@waken/ui';
import { useWaken } from '../../src/store';
import { pathTo, pointStreamAt, RELAYED_QUALITY } from '../../src/network';

const CONFLICT = 409;

/** V2: the stream runs inside Waken through the waken-stream native module (moonlight-common-c). */
export default function StreamScreen() {
  // The app name comes with the route: the library may still be loading when the launch starts.
  const { id, app: appParam } = useLocalSearchParams<{ id: string; game?: string; app?: string }>();
  const router = useRouter();
  const device = useWaken((s) => s.devices.find((d) => d.id === id))!;
  const chosen = useWaken((s) => s.settings.stream);
  // Lowered when the tunnel only has a relayed path: 40 Mb/s through a relay loses most of the video.
  const [q, setQ] = useState(chosen);
  const [relayed, setRelayed] = useState(false);
  const [hud, setHud] = useState(true);
  const [state, setState] = useState<StreamState>({ state: 'connecting' });
  const [stats, setStats] = useState<StreamStats | null>(null);
  const [launch, setLaunch] = useState<LaunchInfo | null>(null);

  const requested = useRef(false);

  // 1. Ask the agent on the PC to launch the Sunshine app (it pairs automatically the first time).
  useEffect(() => {
    // Only once: Sunshine ignores a second launch while the first waits for its stream, whose key would then be lost.
    if (!isNativeStreamAvailable || requested.current) return;
    requested.current = true;

    const agent = new AgentClient(device);
    const app = appParam || 'Desktop';
    const start = async (replace: boolean) => {
      await pointStreamAt(device);
      const path = await pathTo(device);
      const quality =
        path === 'relayed'
          ? { ...chosen, ...RELAYED_QUALITY, bitrate: Math.min(chosen.bitrate, RELAYED_QUALITY.bitrate), fps: Math.min(chosen.fps, RELAYED_QUALITY.fps) }
          : chosen;
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
        { text: 'Annuler', style: 'cancel', onPress: () => router.back() },
        { text: `Fermer et lancer ${appParam || 'le Bureau'}`, style: 'destructive', onPress: () => start(true).catch(fail) },
      ]);
    });
  }, []);

  const closeGame = async () => {
    try {
      await new AgentClient(device).quit();
      router.back();
    } catch (e) {
      Alert.alert('Le jeu tourne encore', e instanceof Error ? e.message : String(e));
    }
  };

  // Leaving only disconnects: closing the game loses what was not saved, so it is always an explicit choice.
  const leave = () => {
    if (!launch) return router.back();
    Alert.alert('Quitter le stream ?', 'Le jeu continue sur le PC, tu pourras le reprendre.', [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Quitter le stream', onPress: () => router.back() },
      { text: 'Fermer le jeu', style: 'destructive', onPress: () => void closeGame() },
    ]);
  };

  if (!isNativeStreamAvailable) {
    return (
      <View style={[styles.root, { alignItems: 'center', justifyContent: 'center', padding: 32, gap: 16 }]}>
        <Text style={[type.title, { color: colors.ink, textAlign: 'center' }]}>Module de stream absent</Text>
        <Text style={[type.body, { color: colors.ink2, textAlign: 'center', maxWidth: 480 }]}>
          Ce build ne contient pas waken-stream (Expo Go ou web). Lance un build de dev : pnpm exec expo run:ios. Ou passe en mode « App Moonlight » dans Réglages.
        </Text>
        <Button label="Retour" variant="glass" onPress={() => router.back()} />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      {launch ? (
        <StreamView
          style={StyleSheet.absoluteFill}
          launch={launch}
          videoWidth={q.width}
          videoHeight={q.height}
          fps={q.fps}
          bitrateKbps={q.bitrate}
          hevc={q.codec !== 'h264'}
          remote
          onStateChange={(e) => setState(e.nativeEvent)}
          onStats={(e) => setStats(e.nativeEvent)}
        />
      ) : null}
      {hud ? (
        <>
          <View pointerEvents="none" style={[styles.pill, { top: 18, left: 54 }]}>
            <View style={styles.devChip}>
              <DeviceIcon kind={device.kind} size={20} />
              <Text style={{ fontFamily: fonts.semibold, fontSize: 12, color: colors.ink }}>{device.name}</Text>
            </View>
            <StatusDot status={state.state === 'streaming' ? 'online' : state.state === 'error' ? 'unreachable' : 'waking'} />
            <Text style={styles.metric}>{stats ? `${stats.rttMs} ms` : '·'}</Text>
            <Text style={styles.sep}>/</Text>
            <Text style={styles.metric}>{stats ? `${Math.round(stats.fps)} fps` : '·'}</Text>
            <Text style={styles.sep}>/</Text>
            <Text style={styles.metric}>{stats ? `${(stats.bitrateKbps / 1000).toFixed(0)} Mb/s` : '·'}</Text>
            {relayed ? (
              <>
                <Text style={styles.sep}>/</Text>
                <Text style={styles.metric}>relais · 720p</Text>
              </>
            ) : null}
          </View>
          <View style={{ position: 'absolute', top: 18, right: 54, flexDirection: 'row', gap: 8 }}>
            <IconButton icon={Keyboard} label="Clavier" size={40} onPress={() => WakenStream.toggleKeyboard()} />
            <IconButton icon={ChevronUp} label="Masquer les contrôles" size={40} onPress={() => setHud(false)} />
            <Pressable onPress={leave} style={styles.quit} accessibilityRole="button">
              <X size={14} color={colors.neonInk} strokeWidth={3} />
              <Text style={{ fontFamily: fonts.bold, fontSize: 13, color: colors.neonInk }}>Quitter</Text>
            </Pressable>
          </View>
          {state.state !== 'streaming' ? (
            <View pointerEvents="none" style={[styles.pill, { bottom: 18, alignSelf: 'center' }]}>
              <Text style={[type.caption, { color: colors.onArt }]}>{state.state === 'error' ? state.message : state.state === 'connecting' ? 'Connexion à Sunshine…' : 'Stream arrêté'}</Text>
            </View>
          ) : null}
        </>
      ) : (
        // A button, not a full-screen overlay: every other touch belongs to the PC.
        <View style={styles.showControls}>
          <IconButton icon={ChevronDown} label="Afficher les contrôles" size={32} onPress={() => setHud(true)} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  pill: { position: 'absolute', flexDirection: 'row', alignItems: 'center', gap: 10, height: 40, paddingLeft: 6, paddingRight: 16, borderRadius: 999, backgroundColor: colors.glass, borderWidth: 1, borderColor: colors.glassLine },
  devChip: { flexDirection: 'row', alignItems: 'center', gap: 7, height: 28, paddingLeft: 4, paddingRight: 10, borderRadius: 999, backgroundColor: colors.bg3 },
  metric: { fontFamily: fonts.mono, fontSize: 12, color: colors.ink },
  sep: { fontFamily: fonts.mono, fontSize: 12, color: colors.ink3 },
  showControls: { position: 'absolute', top: 8, alignSelf: 'center', opacity: 0.5 },
  quit: { height: 40, paddingHorizontal: 16, borderRadius: 999, backgroundColor: colors.danger, flexDirection: 'row', alignItems: 'center', gap: 7 },
});
