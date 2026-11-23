import { useEffect, useRef, useState } from 'react';
import { Linking, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { Check, Cable, Clock, Gamepad2, Loader, Plug, Power, Rocket, Wifi, type LucideIcon } from 'lucide-react-native';
import { wakeAndWait, withRelaySettings, type WakeProgress, type WakeStepId } from '@waken/core';
import { AppMark, colors, Display, IconBubble, MachineChip, PillButton, RoundButton, shadows, type, Wordmark } from '@waken/ui';
import { useDevice, useGame } from '../hooks';
import { useNav } from '../nav';
import { pointStreamAt } from '../network';
import { platform } from '../platform';
import { useWaken } from '../store';
import { useMachineOf } from './parts';
import { Screen } from './Screen';

const steps: { id: WakeStepId; label: string; icon: LucideIcon }[] = [
  { id: 'signal', label: 'Réveil', icon: Power },
  { id: 'ping', label: 'Allumé', icon: Plug },
  { id: 'service', label: 'Le jeu arrive', icon: Gamepad2 },
  { id: 'stream', label: "C'est parti", icon: Rocket },
];

/**
 * "RÉVEIL": waits for the machine (waking it when it can), then hands over to the stream.
 * A PlayStation opens PS Remote Play; the Moonlight engine hands over to Moonlight.
 */
export function WakeScreen({ deviceId, gameId, app, only }: { deviceId: string; gameId?: string; app?: string; only?: boolean }) {
  const nav = useNav();
  const device = useDevice(deviceId);
  const game = useGame(gameId);
  const machine = useMachineOf(game ?? (device ? { id: '', title: '', deviceId } : undefined));
  const settings = useWaken((s) => s.settings);
  const markPlayed = useWaken((s) => s.markPlayed);
  const [progress, setProgress] = useState<WakeProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const abort = useRef(new AbortController());

  useEffect(() => {
    if (!device) return;
    // One controller per run: a ref would stay aborted when effects replay in development.
    const ctrl = new AbortController();
    abort.current = ctrl;
    setError(null);
    setProgress(null);
    const useMoonlight = !only && settings.engine === 'moonlight-app' && platform().canUseMoonlightApp;

    const run = async () => {
      if (device.kind === 'playstation') {
        if (!settings.psRemotePlayUrl) throw new Error('Renseigne le lien de PS Remote Play dans Réglages, Avancé.');
        await Linking.openURL(settings.psRemotePlayUrl);
        return nav.back();
      }
      if (useMoonlight && !settings.moonlightUrl) throw new Error("Renseigne le lien d'ouverture de Moonlight dans Réglages, Avancé.");
      await pointStreamAt(device);
      await wakeAndWait(withRelaySettings(device, settings), { signal: ctrl.signal, onProgress: setProgress });
      if (ctrl.signal.aborted) return;
      if (only) return nav.back();
      if (gameId) markPlayed(gameId);
      if (useMoonlight) {
        await Linking.openURL(settings.moonlightUrl);
        nav.back();
      } else {
        nav.stream(device.id, gameId, app);
      }
    };

    run().catch((e: unknown) => {
      if (!ctrl.signal.aborted) setError(e instanceof Error ? e.message : String(e));
    });
    return () => ctrl.abort();
  }, [deviceId, attempt]);

  if (!device) return null;
  if (error) return <WakeError name={device.name} message={error} found={!!device.stream?.tunnelHost} onRetry={() => setAttempt((a) => a + 1)} />;

  const elapsed = Math.floor((progress?.elapsedMs ?? 0) / 1000);
  const doneCount = steps.filter((s) => progress?.states[s.id] === 'done').length;
  const circ = 2 * Math.PI * 104;

  return (
    <Screen ground="lime" maxWidth={720}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Wordmark height={26} />
        <PillButton label="Annuler" size="sm" variant="white" onPress={() => { abort.current.abort(); nav.back(); }} />
      </View>
      <Display size={104} style={{ marginTop: 14 }}>
        Réveil
      </Display>
      <View style={{ width: 232, height: 232, alignSelf: 'center', marginTop: -26, alignItems: 'center', justifyContent: 'center' }}>
        <Svg width={232} height={232} viewBox="0 0 232 232" style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
          <Circle cx={116} cy={116} r={104} stroke={colors.white} strokeWidth={14} fill="none" />
          <Circle cx={116} cy={116} r={104} stroke={colors.ink} strokeWidth={14} fill="none" strokeLinecap="round" strokeDasharray={`${circ}`} strokeDashoffset={circ * (1 - Math.max(0.05, doneCount / steps.length))} />
        </Svg>
        <View style={{ transform: [{ rotate: '-8deg' }], ...shadows.lift }}>
          <AppMark size={66} />
        </View>
        <Text style={[type.display, { fontSize: 46, lineHeight: 58, marginTop: 2, color: colors.ink }]}>{`${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`}</Text>
      </View>
      <Text style={[type.title, { color: colors.ink, textAlign: 'center', marginTop: 14 }]}>
        {progress?.states.signal === 'done' || !progress ? `${device.name} se prépare` : `${device.name} se réveille`}
      </Text>
      <View style={{ alignItems: 'center', marginTop: 10 }}>
        <MachineChip name={game?.title ?? app ?? 'Bureau'} icon={machine.icon} />
      </View>
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 40 }}>
        {steps.map((s, i) => {
          const st = progress?.states[s.id] ?? (i === 0 ? 'running' : 'pending');
          const active = st === 'running';
          const color = st === 'done' ? colors.online : active ? colors.blue : colors.muted;
          return (
            <View
              key={s.id}
              style={[
                { flex: 1, minWidth: 0, padding: 12, paddingVertical: 14, borderRadius: 22, backgroundColor: colors.white, gap: 10 },
                active ? { ...shadows.lift, transform: [{ rotate: '-6deg' }, { translateY: -24 }], zIndex: 2 } : shadows.card,
              ]}
            >
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <IconBubble icon={st === 'done' ? Check : active ? Loader : s.icon} color={color} />
              </View>
              <Text style={[type.label, { color: colors.ink }]}>{s.label}</Text>
              <Text style={[type.caption, { color: st === 'pending' ? colors.ink2 : color }]}>{st === 'done' ? 'Fait' : active ? 'En cours' : 'À venir'}</Text>
            </View>
          );
        })}
      </View>
    </Screen>
  );
}

/** "OUPS !": what to check, worded for the way this machine is reached. */
function WakeError({ name, message, found, onRetry }: { name: string; message: string; found: boolean; onRetry: () => void }) {
  const nav = useNav();
  const tips: { icon: LucideIcon; title: string; detail: string }[] = found
    ? [
        { icon: Power, title: 'Waken est ouvert dessus ?', detail: "Il faut l'app Waken lancée sur la machine." },
        { icon: Wifi, title: 'Elle est connectée à Internet ?', detail: 'Wi-Fi ou câble, peu importe.' },
        { icon: Clock, title: 'Même compte sur les deux ?', detail: 'La machine doit être connectée au même compte que cet appareil.' },
      ]
    : [
        { icon: Plug, title: 'Il est bien branché ?', detail: "La prise et l'écran n'ont pas besoin d'être allumés." },
        { icon: Cable, title: 'Relié à la box par câble ?', detail: 'Le Wi-Fi ne permet pas de le réveiller.' },
        { icon: Wifi, title: 'Ta box est allumée ?', detail: 'Sans elle, ton PC est injoignable.' },
      ];
  return (
    <Screen ground="ember" maxWidth={600}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <MachineChip name={name} icon={Power} />
        <RoundButton icon={Check} label="Fermer" variant="white" onPress={nav.back} />
      </View>
      <Display size={110} style={{ marginTop: 14 }}>
        Oups&nbsp;!
      </Display>
      <Text style={[type.title, { color: colors.ink, textAlign: 'center' }]}>{name} ne répond pas</Text>
      <Text style={[type.body, { color: colors.ink2, textAlign: 'center', marginTop: 6 }]}>{message}</Text>
      <View style={{ gap: 10, marginTop: 22 }}>
        {tips.map((t) => (
          <View key={t.title} style={{ flexDirection: 'row', gap: 12, alignItems: 'center', padding: 14, borderRadius: 22, backgroundColor: colors.white, ...shadows.card }}>
            <IconBubble icon={t.icon} color={colors.ink} fg={colors.lime} />
            <View style={{ flex: 1 }}>
              <Text style={[type.label, { color: colors.ink }]}>{t.title}</Text>
              <Text style={[type.caption, { color: colors.ink2, fontWeight: '500' }]}>{t.detail}</Text>
            </View>
          </View>
        ))}
      </View>
      <View style={{ gap: 8, marginTop: 22 }}>
        <PillButton label="Réessayer" size="lg" onPress={onRetry} />
        <PillButton label="Plus tard" variant="ghost" onPress={nav.back} />
      </View>
    </Screen>
  );
}
