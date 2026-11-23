import { useEffect, useRef, useState } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Image } from 'expo-image';
import Svg, { Circle } from 'react-native-svg';
import { Check } from 'lucide-react-native';
import { wakeAndWait, withRelaySettings, type WakeProgress, type WakeStepId } from '@waken/core';
import { Button, colors, fonts, type } from '@waken/ui';
import { useWaken } from '../../src/store';
import { useGame, useGameImage } from '../../src/hooks';
import { launchQuery } from '../../src/navigation';
import { pointStreamAt } from '../../src/network';

const steps: { id: WakeStepId; label: string; detail: string }[] = [
  { id: 'signal', label: 'Signal envoyé', detail: 'relais → PC' },
  { id: 'ping', label: 'Le PC répond', detail: 'agent Waken' },
  { id: 'service', label: 'Sunshine prêt', detail: ':47989' },
  { id: 'stream', label: 'Lancement', detail: 'stream' },
];

export default function WakeScreen() {
  const { id, game: gameId, app, only } = useLocalSearchParams<{ id: string; game?: string; app?: string; only?: string }>();
  const router = useRouter();
  const device = useWaken((s) => s.devices.find((d) => d.id === id))!;
  const game = useGame(gameId);
  const settings = useWaken((s) => s.settings);
  const markPlayed = useWaken((s) => s.markPlayed);
  const image = useGameImage(game ?? { id: 'desktop', title: 'Bureau', deviceId: id });
  const [progress, setProgress] = useState<WakeProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef(new AbortController());

  useEffect(() => {
    // One controller per mount: a ref would stay aborted when effects replay in development.
    const ctrl = new AbortController();
    abort.current = ctrl;
    const useMoonlight = !only && settings.engine === 'moonlight-app';

    const run = async () => {
      if (useMoonlight && !settings.moonlightUrl) throw new Error("Renseigne le lien d'ouverture de Moonlight dans Réglages.");
      await pointStreamAt(device);
      await wakeAndWait(withRelaySettings(device, settings), { signal: ctrl.signal, onProgress: setProgress });
      if (ctrl.signal.aborted) return;
      if (only) return router.back();
      if (gameId) markPlayed(gameId);
      if (useMoonlight) {
        await Linking.openURL(settings.moonlightUrl);
        router.back();
      } else {
        router.replace(`/stream/${device.id}${launchQuery(gameId, app)}`);
      }
    };

    run().catch((e: unknown) => {
      if (!ctrl.signal.aborted) setError(e instanceof Error ? e.message : String(e));
    });
    return () => ctrl.abort();
  }, []);

  const elapsed = Math.floor((progress?.elapsedMs ?? 0) / 1000);
  const doneCount = steps.filter((s) => progress?.states[s.id] === 'done').length;
  const circ = 2 * Math.PI * 98;

  return (
    <View style={styles.root}>
      <Image source={image} style={StyleSheet.absoluteFill} contentFit="cover" blurRadius={30} />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(7,8,12,0.74)' }]} />

      <View style={styles.center}>
        <View style={{ width: 220, height: 220, alignItems: 'center', justifyContent: 'center' }}>
          <Svg width={220} height={220} viewBox="0 0 220 220" style={[StyleSheet.absoluteFill, { transform: [{ rotate: '-90deg' }] }]}>
            <Circle cx={110} cy={110} r={98} stroke="rgba(255,255,255,0.12)" strokeWidth={10} fill="none" />
            <Circle cx={110} cy={110} r={98} stroke={error ? colors.danger : colors.neon} strokeWidth={10} fill="none" strokeLinecap="round" strokeDasharray={`${circ}`} strokeDashoffset={circ * (1 - Math.max(0.04, doneCount / steps.length))} />
          </Svg>
          <Text style={{ fontFamily: fonts.display, fontSize: 48, color: colors.ink }}>{`${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`}</Text>
          <Text style={[type.metricS, { color: colors.ink2 }]}>{`${doneCount} / ${steps.length}`}</Text>
        </View>

        <View style={{ alignItems: 'center', gap: 10, paddingHorizontal: 24 }}>
          <Text style={[type.displayL, { fontSize: 32, lineHeight: 38, color: colors.ink, textAlign: 'center' }]}>{error ? 'Ça bloque' : `${device.name} se réveille`}</Text>
          <Text style={[type.body, { color: colors.onArt, textAlign: 'center', maxWidth: 460 }]}>
            {error ? progress?.message ?? error : "Le stream se lance tout seul dès que Sunshine répond. Tu taperas ton PIN sur l'écran de connexion."}
          </Text>
        </View>

        <View style={styles.steps}>
          {steps.map((s) => {
            const st = progress?.states[s.id] ?? 'pending';
            return (
              <View key={s.id} style={{ flex: 1, gap: 8 }}>
                <View style={[styles.dot, st === 'done' && { backgroundColor: colors.neon, borderColor: colors.neon }, st === 'running' && { borderColor: colors.neon, backgroundColor: 'rgba(255,61,127,0.16)' }, st === 'error' && { borderColor: colors.danger }]}>
                  {st === 'done' ? <Check size={16} color={colors.neonInk} strokeWidth={3} /> : null}
                </View>
                <Text style={[type.caption, { color: st === 'pending' ? colors.ink2 : colors.ink, fontFamily: fonts.semibold }]}>{s.label}</Text>
                <Text style={[type.metricS, { color: colors.ink2 }]}>{s.detail}</Text>
              </View>
            );
          })}
        </View>

        <Button
          label={error ? 'Fermer' : 'Annuler'}
          variant="glass"
          onPress={() => {
            abort.current.abort();
            router.back();
          }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg0 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 28, padding: 20 },
  steps: { flexDirection: 'row', gap: 12, width: '100%', maxWidth: 780, padding: 20, borderRadius: 24, backgroundColor: colors.glass, borderWidth: 1, borderColor: colors.glassLine },
  dot: { width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' },
});
