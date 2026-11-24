import { useEffect, useState, type ComponentType } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  Activity,
  Check,
  ChevronDown,
  ChevronRight,
  Cpu,
  EyeOff,
  Gamepad2,
  Gauge,
  Keyboard,
  LogOut,
  Maximize2,
  Minimize2,
  Monitor,
  Volume2,
  VolumeX,
  Waves,
  type LucideIcon,
} from 'lucide-react-native';
import { AppMark, colors, fonts, PressScale, shadows, type } from '@waken/ui';
import type { StreamSettings } from '@waken/core';
import { defaultGamepadOptions, useGamepadOptions, useGamepads } from '../gamepads';
import { platform, type StreamState, type StreamStats } from '../platform';
import { useWaken } from '../store';

/** What the player can change while playing. Anything but sound restarts the stream with it, as Parsec does. */
export interface StreamChoices {
  /** 'auto': the window's shape on a PC, the chosen quality otherwise. A height: that height in 16:9. */
  resolution: 'auto' | 720 | 1080 | 1440 | 2160;
  /** Mb/s, or 'auto' for the chosen quality's. */
  bitrate: 'auto' | 10 | 20 | 40 | 80;
  codec: 'auto' | 'h264' | 'hevc';
}

export const defaultChoices: StreamChoices = { resolution: 'auto', bitrate: 'auto', codec: 'auto' };

/** The settings to ask for, from the quality the stream would use and the player's choices. */
export function applyChoices(settings: StreamSettings, choices: StreamChoices): StreamSettings {
  let s = settings;
  if (choices.resolution !== 'auto') s = { ...s, height: choices.resolution, width: Math.round((choices.resolution * 16) / 9 / 8) * 8 };
  if (choices.bitrate !== 'auto') s = { ...s, bitrate: choices.bitrate * 1000 };
  if (choices.codec !== 'auto') s = { ...s, codec: choices.codec };
  return s;
}

type Section = 'resolution' | 'bitrate' | 'codec' | 'gamepads' | null;

/** The vibration strengths of the Manettes page, the same four steps. */
const rumbleSteps = [
  { id: 0, label: 'Vibrations : aucune' },
  { id: 0.35, label: 'Vibrations : faibles' },
  { id: 0.7, label: 'Vibrations : normales' },
  { id: 1, label: 'Vibrations : fortes' },
];

/**
 * The HUD, as in Parsec but in Waken's colours: one button (the W) at the top left, in the stream view's dead zone
 * where the pointer stays the app's, which opens the menu; and an optional bar of figures along the top.
 */
export function StreamHud({
  title,
  state,
  stats,
  settings,
  relayed,
  choices,
  onChoices,
  muted,
  onMuted,
  fullscreen,
  onFullscreen,
  onKeyboard,
  onLeave,
  onMenu,
}: {
  title: string;
  state: StreamState;
  stats: StreamStats | null;
  /** What the stream runs with now. */
  settings: StreamSettings;
  relayed: boolean;
  choices: StreamChoices;
  onChoices: (choices: StreamChoices) => void;
  muted: boolean;
  onMuted: (muted: boolean) => void;
  fullscreen: boolean;
  /** Absent where the window cannot go full screen (phones). */
  onFullscreen?: () => void;
  onKeyboard?: () => void;
  onLeave: () => void;
  /** The menu opens or closes: the stream view lets the pointer go meanwhile. */
  onMenu?: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => onMenu?.(open), [open]);
  const [section, setSection] = useState<Section>(null);
  const [figures, setFigures] = useState(false);
  // A reserve of frames that adapts to the network: smooth on 5G, nothing added on a steady network. Kept.
  const smooth = useWaken((s) => s.settings.smoothing ?? true);
  const updateSettings = useWaken((s) => s.updateSettings);
  // The bar of figures has one row, or two with the timings (more on a narrow screen): the button goes below it.
  const [barHeight, setBarHeight] = useState(32);
  const [hidden, setHidden] = useState(false);

  const status = state.state === 'error' ? 'Erreur' : state.state !== 'streaming' ? 'Connexion…' : relayed ? 'Relais' : 'Connexion top';
  const dot = state.state === 'error' ? colors.danger : state.state !== 'streaming' ? colors.waking : relayed ? colors.hot : colors.online;
  const top = figures ? barHeight + 6 : 14;
  const close = () => {
    setOpen(false);
    setSection(null);
  };
  const choose = (next: StreamChoices) => {
    close();
    onChoices(next);
  };

  const resolutionLabel = choices.resolution === 'auto' ? 'Auto' : choices.resolution === 2160 ? '4K' : `${choices.resolution}p`;
  const bitrateLabel = choices.bitrate === 'auto' ? 'Auto' : `${choices.bitrate} Mb/s`;
  const codecLabel = choices.codec === 'auto' ? 'Auto' : choices.codec === 'h264' ? 'H.264' : 'HEVC';

  return (
    <>
      {figures ? <FiguresBar stats={stats} settings={settings} onHeight={setBarHeight} /> : null}

      {hidden ? (
        // A thin tab brings the button back: every other click belongs to the game.
        <Pressable accessibilityRole="button" accessibilityLabel="Afficher le bouton" onPress={() => setHidden(false)} style={[styles.tab, { top: figures ? barHeight : 0 }]} />
      ) : (
        <PressScale
          onPress={() => (open ? close() : setOpen(true))}
          accessibilityRole="button"
          accessibilityLabel="Menu du stream"
          hoverTo={1.08}
          style={[styles.button, { top }]}
        >
          <AppMark size={40} />
          <View style={[styles.buttonDot, { backgroundColor: dot }]} />
        </PressScale>
      )}

      {open ? (
        <>
          <Pressable accessibilityLabel="Fermer le menu" onPress={close} style={StyleSheet.absoluteFill} />
          <View style={[styles.menu, { top: top + 56 }]}>
            <ScrollView contentContainerStyle={{ padding: 8 }} style={{ maxHeight: 560 }}>
              <View style={styles.header}>
                <Text numberOfLines={1} style={[type.display, { fontSize: 22, lineHeight: 28, color: colors.white }]}>
                  {title}
                </Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: dot }} />
                  <Text style={[type.chip, { color: colors.sky }]}>
                    {stats ? `${status} · ${stats.rttMs} ms · ${Math.round(stats.fps)} i/s` : status}
                  </Text>
                </View>
              </View>

              {onFullscreen ? (
                <Item icon={fullscreen ? Minimize2 : Maximize2} label={fullscreen ? 'Fenêtré' : 'Plein écran'} onPress={() => { close(); onFullscreen(); }} />
              ) : null}
              <Item icon={muted ? VolumeX : Volume2} label={muted ? 'Son coupé' : 'Son activé'} onPress={() => onMuted(!muted)} />

              <Item icon={Monitor} label="Résolution" value={resolutionLabel} expanded={section === 'resolution'} onPress={() => setSection(section === 'resolution' ? null : 'resolution')} />
              {section === 'resolution' ? (
                <Options
                  current={choices.resolution}
                  options={[
                    { id: 'auto', label: 'Auto (taille de la fenêtre)' },
                    { id: 720, label: '720p' },
                    { id: 1080, label: '1080p' },
                    { id: 1440, label: '1440p' },
                    { id: 2160, label: '4K' },
                  ]}
                  onChoose={(resolution) => choose({ ...choices, resolution })}
                />
              ) : null}

              <Item icon={Gauge} label="Débit" value={bitrateLabel} expanded={section === 'bitrate'} onPress={() => setSection(section === 'bitrate' ? null : 'bitrate')} />
              {section === 'bitrate' ? (
                <Options
                  current={choices.bitrate}
                  options={[
                    { id: 'auto', label: 'Auto (qualité choisie)' },
                    { id: 10, label: '10 Mb/s' },
                    { id: 20, label: '20 Mb/s' },
                    { id: 40, label: '40 Mb/s' },
                    { id: 80, label: '80 Mb/s' },
                  ]}
                  onChoose={(bitrate) => choose({ ...choices, bitrate })}
                />
              ) : null}

              <Item icon={Cpu} label="Codec" value={codecLabel} expanded={section === 'codec'} onPress={() => setSection(section === 'codec' ? null : 'codec')} />
              {section === 'codec' ? (
                <Options
                  current={choices.codec}
                  options={[
                    { id: 'auto', label: 'Auto' },
                    { id: 'h264', label: 'H.264 (partout)' },
                    { id: 'hevc', label: 'HEVC (plus léger)' },
                  ]}
                  onChoose={(codec) => choose({ ...choices, codec })}
                />
              ) : null}

              {platform().gamepads ? (
                <Item icon={Gamepad2} label="Manettes" expanded={section === 'gamepads'} onPress={() => setSection(section === 'gamepads' ? null : 'gamepads')} />
              ) : null}
              {section === 'gamepads' ? <GamepadsSection /> : null}

              <Item icon={Waves} label="Fluidité" checked={smooth} onPress={() => updateSettings({ smoothing: !smooth })} />
              <Item icon={Activity} label="Statistiques" checked={figures} onPress={() => setFigures(!figures)} />
              {onKeyboard ? <Item icon={Keyboard} label="Clavier" onPress={() => { close(); onKeyboard(); }} /> : null}
              <Item icon={EyeOff} label="Masquer le bouton" onPress={() => { close(); setHidden(true); }} />
              <View style={styles.separator} />
              <Item icon={LogOut} label="Quitter" danger onPress={() => { close(); onLeave(); }} />
            </ScrollView>
          </View>
        </>
      ) : null}

      {state.state === 'error' || state.state === 'stopped' ? (
        <View pointerEvents="none" style={styles.notice}>
          <Text style={[type.caption, { color: colors.white }]}>{state.state === 'error' ? state.message : 'Stream terminé'}</Text>
        </View>
      ) : null}
    </>
  );
}

function Item({
  icon: Icon,
  label,
  value,
  expanded,
  checked,
  danger,
  onPress,
}: {
  icon: LucideIcon;
  label: string;
  value?: string;
  expanded?: boolean;
  checked?: boolean;
  danger?: boolean;
  onPress: () => void;
}) {
  const color = danger ? colors.danger : colors.white;
  const Chevron: ComponentType<{ size: number; color: string }> = expanded ? ChevronDown : ChevronRight;
  return (
    <PressScale onPress={onPress} accessibilityRole="button" accessibilityLabel={label} hoverTo={1.02} style={styles.item}>
      <Icon size={18} color={color} strokeWidth={2.4} />
      <Text style={[styles.itemLabel, { color }]}>{label}</Text>
      {value !== undefined ? (
        <>
          <Text style={styles.itemValue}>{value}</Text>
          <Chevron size={16} color={colors.sky} />
        </>
      ) : checked ? (
        <Check size={18} color={colors.lime} strokeWidth={3} />
      ) : null}
    </PressScale>
  );
}

/** The controllers of this device (a tap makes one vibrate), and the vibrations' strength: the Manettes page, short. */
function GamepadsSection() {
  const { data: pads } = useGamepads();
  const options = useGamepadOptions();
  const update = useWaken((s) => s.updateSettings);
  const api = platform().gamepads!;
  const nearest = rumbleSteps.reduce((best, s) => (Math.abs(s.id - options.rumble) < Math.abs(best.id - options.rumble) ? s : best)).id;
  return (
    <View>
      {pads?.length ? (
        <Options
          current={''}
          options={pads.map((p) => ({ id: p.id, label: `${p.name}${p.battery != null ? ` · ${Math.round(p.battery * 100)} %` : ''}` }))}
          onChoose={(id) => void api.test(id)}
        />
      ) : (
        <Text style={[styles.optionLabel, { paddingHorizontal: 12, paddingVertical: 8, color: colors.sky }]}>Aucune manette branchée</Text>
      )}
      <Options current={nearest} options={rumbleSteps} onChoose={(rumble) => update({ gamepads: { ...defaultGamepadOptions, ...options, rumble } })} />
    </View>
  );
}

function Options<T extends string | number>({ current, options, onChoose }: { current: T; options: { id: T; label: string }[]; onChoose: (id: T) => void }) {
  return (
    <View style={styles.options}>
      {options.map((o) => (
        <PressScale key={String(o.id)} onPress={() => onChoose(o.id)} accessibilityRole="button" accessibilityLabel={o.label} style={styles.option}>
          <Text style={[styles.optionLabel, o.id === current && { color: colors.lime }]}>{o.label}</Text>
          {o.id === current ? <Check size={16} color={colors.lime} strokeWidth={3} /> : null}
        </PressScale>
      ))}
    </View>
  );
}

/** Milliseconds as the HUD writes them: one decimal, French comma. */
const ms = (value: number) => `${value.toFixed(1).replace('.', ',')} ms`;

/**
 * Parsec's bar of figures, along the top. The second row says where a frame's time goes, from the computer to
 * this screen, to see which step costs when the picture is not smooth (not sent for a PlayStation).
 */
function FiguresBar({ stats, settings, onHeight }: { stats: StreamStats | null; settings: StreamSettings; onHeight: (height: number) => void }) {
  const figure = (label: string, value: string) => (
    <Text key={label} style={styles.figure}>
      {label} <Text style={styles.figureValue}>{value}</Text>
    </Text>
  );
  const timed = stats?.displayMs !== undefined;
  return (
    <View pointerEvents="none" style={styles.figures} onLayout={(e) => onHeight(Math.round(e.nativeEvent.layout.height))}>
      <View style={styles.figuresRow}>
        {figure('Réseau', stats ? `${stats.rttMs} ms` : '…')}
        {figure('Images', stats ? `${Math.round(stats.fps)} i/s` : '…')}
        {figure('Débit', stats ? `${(stats.bitrateKbps / 1000).toFixed(1).replace('.', ',')} Mb/s` : '…')}
        {figure('Perdues', stats ? String(stats.droppedFrames) : '…')}
        {figure(settings.codec === 'h264' ? 'H.264' : 'HEVC', `${settings.width}×${settings.height} · ${settings.fps} i/s`)}
      </View>
      {timed && stats ? (
        <View style={styles.figuresRow}>
          {figure('Encodage PC', ms(stats.hostMs ?? 0))}
          {figure('Réception', ms(stats.receiveMs ?? 0))}
          {figure('Attente', ms(stats.queueMs ?? 0))}
          {figure('Jusqu’à l’écran', ms(stats.displayMs ?? 0))}
          {figure('Régularité', `±${ms(stats.jitterMs ?? 0)}`)}
          {stats.reserveFrames !== undefined ? figure('Réserve', `${stats.reserveFrames} ${stats.reserveFrames > 1 ? 'images' : 'image'}`) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  button: { position: 'absolute', left: 16, ...shadows.lift },
  buttonDot: { position: 'absolute', right: -2, bottom: -2, width: 12, height: 12, borderRadius: 6, borderWidth: 2, borderColor: colors.ink },
  tab: { position: 'absolute', alignSelf: 'center', width: 64, height: 10, borderBottomLeftRadius: 8, borderBottomRightRadius: 8, backgroundColor: colors.glass, opacity: 0.7 },
  menu: { position: 'absolute', left: 16, width: 300, borderRadius: 24, backgroundColor: 'rgba(11,11,15,0.94)', borderWidth: 1, borderColor: colors.glassLine, ...shadows.lift },
  header: { paddingHorizontal: 10, paddingTop: 6, paddingBottom: 12, gap: 6 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, height: 44, paddingHorizontal: 12, borderRadius: 14 },
  itemLabel: { flex: 1, fontFamily: fonts.semibold, fontSize: 15 },
  itemValue: { fontFamily: fonts.semibold, fontSize: 13, color: colors.sky },
  options: { marginLeft: 42, marginBottom: 6, gap: 2 },
  option: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', height: 36, paddingHorizontal: 12, borderRadius: 12 },
  optionLabel: { fontFamily: fonts.medium, fontSize: 14, color: colors.white },
  separator: { height: 1, backgroundColor: colors.glassLine, marginVertical: 6, marginHorizontal: 10 },
  figures: { position: 'absolute', top: 0, left: 0, right: 0, paddingVertical: 7, paddingHorizontal: 12, gap: 4, backgroundColor: 'rgba(11,11,15,0.86)' },
  figuresRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', columnGap: 28, rowGap: 4 },
  figure: { fontFamily: fonts.medium, fontSize: 13, color: colors.sky },
  figureValue: { fontFamily: fonts.bold, color: colors.white },
  notice: { position: 'absolute', bottom: 18, alignSelf: 'center', paddingHorizontal: 16, height: 40, justifyContent: 'center', borderRadius: 999, backgroundColor: colors.glass, borderWidth: 1, borderColor: colors.glassLine },
});
