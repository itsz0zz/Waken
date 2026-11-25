import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Linking, Text, View } from 'react-native';
import Svg, { Circle, G } from 'react-native-svg';
import { Check, Cable, Clock, Gamepad2, Loader, Plug, Power, Rocket, Wifi, type LucideIcon } from 'lucide-react-native';
import { wakeAndWait, withRelaySettings, type WakeProgress, type WakeStepId } from '@waken/core';
import { AppMark, colors, Display, IconBubble, MachineChip, nativeDriver, PillButton, RoundButton, shadows, type, Wordmark } from '@waken/ui';
import { useDevice, useGame } from '../hooks';
import { useNav } from '../nav';
import { connectionLog, pointStreamAt } from '../network';
import { sendWakeOnLan } from '../wakeOnLan';
import { wakeConsole } from '../playstation';
import { PlayStationStreamScreen } from './PlayStationStream';
import { platform } from '../platform';
import { useWaken } from '../store';
import { useMachineOf } from './parts';
import { Screen } from './Screen';
import { StreamScreen } from './Stream';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

const steps: { id: WakeStepId; label: string; icon: LucideIcon }[] = [
  { id: 'signal', label: 'Réveil', icon: Power },
  { id: 'ping', label: 'Allumé', icon: Plug },
  { id: 'service', label: 'Le jeu arrive', icon: Gamepad2 },
  { id: 'stream', label: "C'est parti", icon: Rocket },
];

/**
 * "RÉVEIL": waits for the machine (waking it when it can), then starts the stream underneath, invisible, and
 * stays until its first picture: the player never sees a half-connected stream. A PlayStation opens PS Remote
 * Play; the Moonlight engine hands over to Moonlight. onLiveChange: the stream shows (the iPhone turns landscape).
 */
export function WakeScreen({
  deviceId,
  gameId,
  app,
  only,
  onLiveChange,
}: {
  deviceId: string;
  gameId?: string;
  app?: string;
  only?: boolean;
  onLiveChange?: (live: boolean) => void;
}) {
  const nav = useNav();
  const device = useDevice(deviceId);
  const game = useGame(gameId);
  const machine = useMachineOf(game ?? (device ? { id: '', title: '', deviceId } : undefined));
  const settings = useWaken((s) => s.settings);
  const markPlayed = useWaken((s) => s.markPlayed);
  const [progress, setProgress] = useState<WakeProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  // The machine answered: the stream connects underneath. live: its first picture is there, it covers this screen.
  const [streaming, setStreaming] = useState(false);
  const [live, setLive] = useState(false);
  useEffect(() => onLiveChange?.(live), [live]);
  const abort = useRef(new AbortController());
  // The ring follows the steps smoothly instead of jumping from one to the next (an SVG prop: no native driver).
  const ring = useRef(new Animated.Value(0.05)).current;
  const done = steps.filter((st) => progress?.states[st.id] === 'done').length;
  // Something always moves while it waits: an arc running round the ring, the W breathing, the clock ticking.
  const spin = useRef(new Animated.Value(0)).current;
  const breath = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loops = [
      // An SVG stroke offset: only the JavaScript driver animates it.
      Animated.loop(Animated.timing(spin, { toValue: 1, duration: 1300, easing: Easing.linear, useNativeDriver: false })),
      Animated.loop(
        Animated.sequence([
          Animated.timing(breath, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: nativeDriver }),
          Animated.timing(breath, { toValue: 0, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: nativeDriver }),
        ])
      ),
    ];
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [spin, breath]);
  const [startedAt, setStartedAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    Animated.timing(ring, { toValue: Math.max(0.05, done / steps.length), duration: 600, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
  }, [done, ring]);

  useEffect(() => {
    if (!device) return;
    // One controller per run: a ref would stay aborted when effects replay in development.
    const ctrl = new AbortController();
    abort.current = ctrl;
    setError(null);
    setProgress(null);
    setStreaming(false);
    setLive(false);
    setStartedAt(Date.now());
    const useMoonlight = !only && settings.engine === 'moonlight-app' && platform().canUseMoonlightApp;

    const run = async () => {
      if (device.kind === 'playstation') {
        // Linked in Waken (chiaki): woken here on this network, then streamed in Waken.
        if (device.playstation && platform().playstation) {
          await wakeConsole(device, (state) => console.log(`[playstation] ${device.name} : ${state}`), ctrl.signal);
          if (only) return nav.back();
          if (platform().PlayStationView) return setStreaming(true);
          throw new Error('Cette app ne sait pas encore diffuser une PlayStation : la console est allumée.');
        }
        throw new Error('Lie d’abord la console dans Waken : Machines, Ajouter une PS5.');
      }
      if (useMoonlight && !settings.moonlightUrl) throw new Error("Renseigne le lien d'ouverture de Moonlight dans Réglages, Avancé.");
      const began = Date.now();
      await pointStreamAt(device);
      connectionLog(began, 'tunnel pointé');
      await wakeAndWait(withRelaySettings(device, settings), {
        signal: ctrl.signal,
        wakeOnLan: (method) => sendWakeOnLan(device, method),
        onProgress: (p) => {
          connectionLog(began, `réveil : ${p.step}${p.message ? ` (${p.message})` : ''}`);
          setProgress(p);
        },
      });
      if (ctrl.signal.aborted) return;
      if (only) return nav.back();
      if (gameId) markPlayed(gameId);
      if (useMoonlight) {
        await Linking.openURL(settings.moonlightUrl);
        nav.back();
      } else {
        setStreaming(true);
      }
    };

    run().catch((e: unknown) => {
      if (!ctrl.signal.aborted) setError(e instanceof Error ? e.message : String(e));
    });
    return () => ctrl.abort();
  }, [deviceId, attempt]);

  if (!device) return null;
  if (error && !live) return <WakeError name={device.name} message={error} found={!!device.stream?.tunnelHost} onRetry={() => setAttempt((a) => a + 1)} />;

  // Its own clock: the steps stop reporting while the stream connects, the time keeps going.
  const elapsed = Math.max(0, Math.floor((now - startedAt) / 1000));
  const doneCount = steps.filter((s) => progress?.states[s.id] === 'done').length;
  const circ = 2 * Math.PI * 104;

  const stream = streaming && device.kind === 'playstation' ? (
    <PlayStationStreamScreen
      deviceId={device.id}
      onLive={setLive}
      onFail={(message) => {
        setStreaming(false);
        setError(message);
      }}
    />
  ) : streaming ? (
    <StreamScreen
      deviceId={device.id}
      startedAt={startedAt}
      gameId={gameId}
      app={app}
      onLive={setLive}
      onFail={(message) => {
        setStreaming(false);
        setError(message);
      }}
    />
  ) : null;
  // Same native views before and after the first picture. The stream stops as soon as its view leaves its
  // parent: this container must neither remount nor be flattened away by React Native (a container whose
  // style only places things has no native view, and gets one, moving its children, when a colour appears).
  return (
    <View collapsable={false} style={{ flex: 1, backgroundColor: '#000' }}>
    {live ? null : (
    <Screen ground="lime" maxWidth={720}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Wordmark height={26} />
        <PillButton label="Annuler" size="sm" variant="white" onPress={() => { abort.current.abort(); nav.back(); }} />
      </View>
      <Display size={104} style={{ marginTop: 14 }}>
        Réveil
      </Display>
      <View style={{ width: 232, height: 232, alignSelf: 'center', marginTop: 22, alignItems: 'center', justifyContent: 'center' }}>
        {/* Turned inside the drawing, round its own centre: Windows turns a view round its top left corner. The
            blue arc runs round the ring by its stroke offset, not by turning a view, for the same reason. */}
        <Svg width={232} height={232} viewBox="0 0 232 232" style={{ position: 'absolute' }} pointerEvents="none">
          <G rotation={-90} originX={116} originY={116}>
            <Circle cx={116} cy={116} r={104} stroke={colors.white} strokeWidth={14} fill="none" />
            <AnimatedCircle cx={116} cy={116} r={104} stroke={colors.ink} strokeWidth={14} fill="none" strokeLinecap="round" strokeDasharray={`${circ}`} strokeDashoffset={ring.interpolate({ inputRange: [0, 1], outputRange: [circ, 0] })} />
            <AnimatedCircle cx={116} cy={116} r={104} stroke={colors.blue} strokeWidth={14} fill="none" strokeLinecap="round" strokeDasharray={`${circ * 0.1} ${circ}`} strokeDashoffset={spin.interpolate({ inputRange: [0, 1], outputRange: [0, -circ] })} />
          </G>
        </Svg>
        <Animated.View
          style={{
            transform: [{ rotate: '-8deg' }, { scale: breath.interpolate({ inputRange: [0, 1], outputRange: [1, 1.08] }) }],
            ...shadows.lift,
          }}
        >
          <AppMark size={66} />
        </Animated.View>
        <Text style={[type.display, { fontSize: 46, lineHeight: 58, marginTop: 2, color: colors.ink }]}>{`${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`}</Text>
      </View>
      <Text style={[type.title, { color: colors.ink, textAlign: 'center', marginTop: 14 }]}>
        {streaming ? `${game?.title ?? (app && app !== 'Desktop' ? app : 'Le bureau')} arrive` : progress?.states.signal === 'done' || !progress ? `${device.name} se prépare` : `${device.name} se réveille`}
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
    )}
    {stream}
    </View>
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
