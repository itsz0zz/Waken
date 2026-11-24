import { useEffect, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { useDevice } from '../hooks';
import { useNav } from '../nav';
import { platform, type StreamState, type StreamStats } from '../platform';
import { useWaken } from '../store';
import { applyChoices, defaultChoices, StreamHud, type StreamChoices } from './StreamHud';

/** Connected without a single picture for this long: the console is not streaming. */
const NO_PICTURE_MS = 20_000;

/**
 * A linked PS5 or PS4 streamed in Waken (chiaki), with the same HUD as a computer. Like the computers' stream screen,
 * it sits invisible over Réveil until the first picture; onFail says why none came.
 */
export function PlayStationStreamScreen({ deviceId, onLive, onFail }: { deviceId: string; onLive?: (live: boolean) => void; onFail?: (message: string) => void }) {
  const nav = useNav();
  const device = useDevice(deviceId);
  const chosen = useWaken((s) => s.settings.stream);
  const account = useWaken((s) => s.settings.psn);
  const { PlayStationView, setFullscreen } = platform();
  const [choices, setChoices] = useState<StreamChoices>(defaultChoices);
  // A new view for each change of quality: the console sets its stream once, when it starts.
  const [attempt, setAttempt] = useState(0);
  const [muted, setMuted] = useState(false);
  const [fullscreen, setFullscreenState] = useState(false);
  const [state, setState] = useState<StreamState>({ state: 'connecting' });
  const [stats, setStats] = useState<StreamStats | null>(null);
  const [everLive, setEverLive] = useState(false);
  const settings = applyChoices(chosen, choices);
  const live = state.state === 'streaming' && (stats?.fps ?? 0) > 0;

  useEffect(() => () => setFullscreen?.(false), []);
  useEffect(() => {
    if (live) setEverLive(true);
    onLive?.(live || everLive);
  }, [live]);
  useEffect(() => {
    if (everLive || state.state !== 'streaming') return;
    const timer = setTimeout(() => onFail?.('La console est connectée mais n’envoie aucune image. Réessaie, ou redémarre-la.'), NO_PICTURE_MS);
    return () => clearTimeout(timer);
  }, [state.state, everLive]);
  useEffect(() => {
    if (everLive) return;
    if (state.state === 'error') onFail?.(state.message);
    else if (state.state === 'stopped') onFail?.('La console a arrêté le stream avant la première image.');
  }, [state, everLive]);

  const unavailable = !PlayStationView || !device?.playstation;
  useEffect(() => {
    if (unavailable) onFail?.(!device ? 'Console introuvable.' : 'Ce build ne sait pas encore streamer une PlayStation.');
  }, [unavailable]);
  if (unavailable) return null;

  const leave = () =>
    Alert.alert('Quitter le stream ?', 'Le jeu continue sur la console.', [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Quitter le stream', onPress: nav.back },
    ]);

  return (
    <View collapsable={false} style={[styles.root, !everLive && styles.hidden]} pointerEvents={everLive ? 'auto' : 'none'}>
      <PlayStationView
        key={attempt}
        link={{ ...device.playstation!, accountId: account?.accountId }}
        settings={settings}
        muted={muted}
        onStateChange={setState}
        onStats={setStats}
      />
      {everLive ? (
        <StreamHud
          title={device.name}
          state={state}
          stats={stats}
          settings={settings}
          relayed={false}
          choices={choices}
          onChoices={(next) => {
            setChoices(next);
            setStats(null);
            setState({ state: 'connecting' });
            setAttempt((a) => a + 1);
          }}
          muted={muted}
          onMuted={setMuted}
          fullscreen={fullscreen}
          onFullscreen={
            setFullscreen
              ? () => {
                  setFullscreen(!fullscreen);
                  setFullscreenState(!fullscreen);
                }
              : undefined
          }
          onLeave={leave}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  hidden: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, opacity: 0, backgroundColor: 'transparent' },
  root: { flex: 1, backgroundColor: '#000' },
});
