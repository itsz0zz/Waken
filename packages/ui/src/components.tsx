import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  type PressableProps,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { Gamepad2, Laptop, Monitor, Play, Server, type LucideIcon } from 'lucide-react-native';
import { Art, Gradient, type ArtSource } from './primitives';
import { colors, fonts, grounds, radius, shadows, type, type DeviceTint, type Ground } from './tokens';

/* ---------- Ground and titles ---------- */

/** The screen's gradient ground, behind everything. */
export function ScreenGround({ ground }: { ground: Ground }) {
  const g = grounds[ground];
  return <Gradient colors={g.colors} locations={g.locations} angle={g.angle} style={StyleSheet.absoluteFill} />;
}

/** Giant uppercase title in Anton: "ON JOUE ?", "TES JEUX", "RÉVEIL". */
export function Display({ children, size = 84, align = 'center', color = colors.ink, style, numberOfLines }: {
  children: React.ReactNode;
  size?: number;
  align?: 'center' | 'left';
  color?: string;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
}) {
  return (
    <Text
      accessibilityRole="header"
      numberOfLines={numberOfLines}
      adjustsFontSizeToFit={numberOfLines != null}
      style={[type.display, { fontSize: size, lineHeight: Math.round(size * 1.34), marginVertical: -Math.round(size * 0.16), textAlign: align, color }, style]}
    >
      {children}
    </Text>
  );
}

/* ---------- Buttons ---------- */

type RoundVariant = 'frost' | 'white' | 'ink' | 'outline' | 'outlineOn';

/** Round icon button: back, options, notifications, nav dock. */
export function RoundButton({
  icon: Icon,
  label,
  variant = 'frost',
  size = 56,
  badge,
  filled,
  style,
  ...rest
}: PressableProps & { icon: LucideIcon; label: string; variant?: RoundVariant; size?: number; badge?: number; filled?: boolean; style?: StyleProp<ViewStyle> }) {
  const v = roundVariants[variant];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        { width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center' },
        v.box,
        pressed && { transform: [{ scale: 0.94 }] },
        style,
      ]}
      {...rest}
    >
      <Icon size={Math.round(size * 0.39)} color={v.fg} strokeWidth={2} fill={filled ? v.fg : 'none'} />
      {badge ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{badge}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const roundVariants: Record<RoundVariant, { box: ViewStyle; fg: string }> = {
  frost: { box: { backgroundColor: colors.frost }, fg: colors.ink },
  white: { box: { backgroundColor: colors.white, ...shadows.card }, fg: colors.ink },
  ink: { box: { backgroundColor: colors.ink, ...shadows.lift }, fg: colors.white },
  outline: { box: { backgroundColor: colors.white, borderWidth: 3.5, borderColor: colors.ink }, fg: colors.ink },
  /** The active button of the dock. */
  outlineOn: { box: { backgroundColor: colors.ink, borderWidth: 3.5, borderColor: colors.ink }, fg: colors.white },
};

type PillVariant = 'ink' | 'outline' | 'white' | 'ghost';

/** Pill button: "Réveiller et jouer", filters "Tous / PC / PS5", "Réessayer". */
export function PillButton({
  label,
  icon: Icon,
  variant = 'ink',
  size = 'md',
  loading,
  style,
  ...rest
}: PressableProps & { label: string; icon?: LucideIcon; variant?: PillVariant; size?: 'sm' | 'md' | 'lg'; loading?: boolean; style?: StyleProp<ViewStyle> }) {
  const v = pillVariants[variant];
  const height = size === 'lg' ? 64 : size === 'md' ? 52 : 42;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        { height, paddingHorizontal: size === 'sm' ? 18 : 24, borderRadius: radius.pill, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
        v.box,
        pressed && { transform: [{ scale: 0.97 }] },
        rest.disabled && { opacity: 0.5 },
        style,
      ]}
      {...rest}
    >
      {loading ? <ActivityIndicator color={v.fg} /> : Icon ? <Icon size={size === 'lg' ? 22 : 18} color={v.fg} strokeWidth={2.4} /> : null}
      <Text style={[type.button, { color: v.fg, fontSize: size === 'lg' ? 18 : size === 'md' ? 16 : 14 }]}>{label}</Text>
    </Pressable>
  );
}

const pillVariants: Record<PillVariant, { box: ViewStyle; fg: string }> = {
  ink: { box: { backgroundColor: colors.ink, ...shadows.lift }, fg: colors.white },
  outline: { box: { backgroundColor: colors.white, borderWidth: 2.5, borderColor: colors.ink }, fg: colors.ink },
  white: { box: { backgroundColor: colors.white, ...shadows.card }, fg: colors.ink },
  ghost: { box: { backgroundColor: 'transparent' }, fg: colors.ink2 },
};

/* ---------- Navigation ---------- */

export interface DockItem {
  key: string;
  label: string;
  icon: LucideIcon;
}

/**
 * The arcade dock: two pairs of overlapping outlined buttons around a big black power button.
 * The active screen is the black one.
 */
export function NavDock({ left, right, active, onSelect, center }: {
  left: [DockItem, DockItem];
  right: [DockItem, DockItem];
  active: string;
  onSelect: (key: string) => void;
  center: { icon: LucideIcon; label: string; onPress: () => void };
}) {
  const pair = (items: DockItem[]) => (
    <View style={{ flexDirection: 'row' }}>
      {items.map((item, i) => {
        const on = item.key === active;
        return (
          <RoundButton
            key={item.key}
            icon={item.icon}
            label={item.label}
            size={60}
            variant={on ? 'outlineOn' : 'outline'}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            onPress={() => onSelect(item.key)}
            style={{ marginLeft: i === 0 ? 0 : -10 }}
          />
        );
      })}
    </View>
  );
  return (
    <View accessibilityRole="tablist" style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 22 }}>
      {pair(left)}
      <RoundButton icon={center.icon} label={center.label} variant="ink" size={76} onPress={center.onPress} />
      {pair(right)}
    </View>
  );
}

/* ---------- Surfaces ---------- */

export function Card({ children, style, lifted }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; lifted?: boolean }) {
  return <View style={[styles.card, lifted ? shadows.lift : shadows.card, style]}>{children}</View>;
}

/** Colored round icon: the leading icon of a row, a wake step, a stat. */
export function IconBubble({ icon: Icon, color, size = 40, fg = colors.white }: { icon: LucideIcon; color: string; size?: number; fg?: string }) {
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color, alignItems: 'center', justifyContent: 'center' }}>
      <Icon size={Math.round(size * 0.45)} color={fg} strokeWidth={2.2} />
    </View>
  );
}

/* ---------- Game art ---------- */

/**
 * A cover tilted on its white border, as on a pinboard. Without a picture (or when it fails),
 * the title is written on a colored card instead, so a game never shows as a grey hole.
 */
export function TiltedArt({
  source,
  title,
  width,
  height,
  rotate = -4,
  border = 6,
  rounded = radius.art,
  lifted = true,
  style,
}: {
  source?: ArtSource;
  title: string;
  width: number;
  height: number;
  rotate?: number;
  border?: number;
  rounded?: number;
  lifted?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const [failed, setFailed] = React.useState(!source);
  React.useEffect(() => setFailed(!source), [source]);
  return (
    <View
      style={[
        { width, height, borderRadius: rounded, borderWidth: border, borderColor: colors.white, backgroundColor: colors.white, transform: [{ rotate: `${rotate}deg` }] },
        lifted && shadows.lift,
        style,
      ]}
    >
      <View style={{ flex: 1, borderRadius: Math.max(0, rounded - border), overflow: 'hidden', backgroundColor: colors.sky }}>
        {source && !failed ? (
          <Art source={source} style={StyleSheet.absoluteFill} onError={() => setFailed(true)} accessibilityLabel={title} />
        ) : (
          <View style={{ flex: 1, padding: 8, justifyContent: 'flex-end', backgroundColor: colors.blue }}>
            <Text numberOfLines={3} style={[type.display, { fontSize: Math.max(14, Math.min(28, width / 6)), lineHeight: Math.max(16, Math.min(30, width / 5.5)), color: colors.white }]}>
              {title}
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}

/**
 * Rank number of the arcade lists: blue Anton digit, thick white outline, black drop.
 * React Native has a single text shadow, so the outline is made of offset copies.
 */
export function RankNumber({ n, size = 86, color = colors.blue }: { n: number; size?: number; color?: string }) {
  const o = Math.max(2, Math.round(size * 0.058));
  // Anton needs room above its digits in React Native: a tight line height cuts their top.
  const style: TextStyle = { ...type.display, fontSize: size, lineHeight: Math.round(size * 1.22), letterSpacing: 0, includeFontPadding: false };
  const outline: [number, number][] = [
    [o, 0], [-o, 0], [0, o], [0, -o], [o * 0.8, o * 0.8], [-o * 0.8, o * 0.8], [o * 0.8, -o * 0.8], [-o * 0.8, -o * 0.8],
  ];
  return (
    <View accessible={false} importantForAccessibility="no-hide-descendants" style={{ transform: [{ rotate: '-6deg' }] }}>
      <Text style={[style, styles.layer, { color: colors.ink, left: o * 1.4, top: o * 1.6 }]}>{n}</Text>
      {outline.map(([x, y], i) => (
        <Text key={i} style={[style, styles.layer, { color: colors.white, left: x, top: y }]}>
          {n}
        </Text>
      ))}
      <Text style={[style, { color }]}>{n}</Text>
    </View>
  );
}

/* ---------- Machines and states ---------- */

export type DeviceStatus = 'online' | 'waking' | 'sleeping' | 'offline' | 'unreachable' | 'unknown';

export const statusMeta: Record<DeviceStatus, { label: string; color: string }> = {
  online: { label: 'Prête', color: colors.online },
  waking: { label: 'Se réveille', color: colors.blue },
  sleeping: { label: 'En repos', color: colors.waking },
  offline: { label: 'Éteinte', color: colors.muted },
  unreachable: { label: 'Injoignable', color: colors.danger },
  unknown: { label: 'Vérification', color: colors.muted },
};

export function machineIcon(kind: DeviceTint, detail?: string): LucideIcon {
  if (kind === 'playstation') return Gamepad2;
  if (kind === 'homelab') return Server;
  return detail === 'Mac' ? Laptop : Monitor;
}

/** Black chip with a lime icon tile: which machine a game runs on. `big` is the tilted one of a game page. */
export function MachineChip({ name, icon: Icon, big, style }: { name: string; icon: LucideIcon; big?: boolean; style?: StyleProp<ViewStyle> }) {
  if (big) {
    return (
      <View style={[styles.chipBig, shadows.lift, style]}>
        <View style={[styles.chipTile, { width: 22, height: 22, borderRadius: 9 }]}>
          <Icon size={13} color={colors.ink} strokeWidth={2.6} />
        </View>
        <Text style={[type.display, { fontSize: 17, lineHeight: 22, letterSpacing: 0.5, color: colors.white }]}>{name}</Text>
      </View>
    );
  }
  return (
    <View style={[styles.chip, style]}>
      <View style={styles.chipTile}>
        <Icon size={11} color={colors.ink} strokeWidth={2.6} />
      </View>
      <Text numberOfLines={1} style={[type.chip, { color: colors.white }]}>
        {name}
      </Text>
    </View>
  );
}

/** White pill with a colored dot: "En repos", "Prête". */
export function StatusTag({ status, label, style }: { status: DeviceStatus; label?: string; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[styles.statusTag, shadows.card, style]}>
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: statusMeta[status].color }} />
      <Text style={[type.chip, { fontSize: 13, color: colors.ink }]}>{label ?? statusMeta[status].label}</Text>
    </View>
  );
}

/* ---------- Lists and forms ---------- */

/** One game in a list: tilted cover with its rank, name, machine, play button. */
export function GameRow({ rank, title, art, machine, machineIcon: Icon, onPress, onPlay }: {
  rank?: number;
  title: string;
  art?: ArtSource;
  machine: string;
  machineIcon: LucideIcon;
  onPress?: () => void;
  onPlay?: () => void;
}) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={title} style={({ pressed }) => [styles.gameRow, shadows.card, pressed && { opacity: 0.9 }]}>
      <View style={{ width: 96, height: 68 }}>
        <TiltedArt source={art} title={title} width={90} height={66} border={4} rounded={radius.md} />
        {rank != null ? (
          <View style={{ position: 'absolute', left: -14, bottom: -16 }}>
            <RankNumber n={rank} size={50} />
          </View>
        ) : null}
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 6 }}>
        <Text numberOfLines={1} style={[type.headline, { color: colors.ink }]}>
          {title}
        </Text>
        <MachineChip name={machine} icon={Icon} style={{ alignSelf: 'flex-start' }} />
      </View>
      {onPlay ? <RoundButton icon={Play} filled label={`Jouer à ${title}`} variant="ink" size={46} onPress={onPlay} /> : null}
    </Pressable>
  );
}

/** A settings row on a white card: icon bubble, label, a switch or a value. */
export function SettingRow({ icon, color, label, hint, value, onValueChange, right }: {
  icon: LucideIcon;
  color: string;
  label: string;
  hint?: string;
  value?: boolean;
  onValueChange?: (v: boolean) => void;
  right?: React.ReactNode;
}) {
  return (
    <View style={styles.settingRow}>
      <IconBubble icon={icon} color={color} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[type.label, { color: colors.ink }]}>{label}</Text>
        {hint ? <Text style={[type.caption, { color: colors.ink2 }]}>{hint}</Text> : null}
      </View>
      {onValueChange ? (
        <Switch value={!!value} onValueChange={onValueChange} accessibilityLabel={label} trackColor={{ true: colors.ink, false: colors.soft }} thumbColor={value ? colors.lime : colors.white} />
      ) : (
        right
      )}
    </View>
  );
}

/** Segmented choice on a soft track: image quality "Éco / Équilibrée / Max". */
export function Segmented<T extends string>({ options, value, onChange, label }: { options: { id: T; label: string }[]; value: T; onChange: (v: T) => void; label: string }) {
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={styles.segmented}>
      {options.map((o) => {
        const on = o.id === value;
        return (
          <Pressable
            key={o.id}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(o.id)}
            style={[styles.segment, on && { backgroundColor: colors.ink }]}
          >
            <Text style={[type.button, { fontSize: 14, color: on ? colors.white : colors.ink }]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Text field on a white card (machine editing). */
export function Field({ label, hint, ...rest }: TextInputProps & { label: string; hint?: string }) {
  return (
    <View style={[styles.field, shadows.card]}>
      <Text style={[type.caption, { color: colors.ink2 }]}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={colors.muted}
        autoCapitalize="none"
        autoCorrect={false}
        style={[type.body, { color: colors.ink, paddingVertical: 4 }]}
        {...rest}
      />
      {hint ? <Text style={[type.caption, { color: colors.ink2 }]}>{hint}</Text> : null}
    </View>
  );
}

export function SectionTitle({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
      <Text style={[type.title, { color: colors.ink, fontSize: 22 }]}>{title}</Text>
      {action ? (
        <Pressable onPress={onAction} accessibilityRole="button" hitSlop={10}>
          <Text style={[type.button, { fontSize: 14, color: colors.ink, textDecorationLine: 'underline' }]}>{action}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { position: 'absolute', left: -10, top: 14, width: 26, height: 26, borderRadius: 13, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' },
  badgeText: { fontFamily: fonts.bold, fontSize: 13, color: colors.white },
  card: { backgroundColor: colors.white, borderRadius: radius.card, padding: 16 },
  layer: { position: 'absolute' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 26, paddingLeft: 4, paddingRight: 10, borderRadius: radius.chip, backgroundColor: colors.ink, maxWidth: '100%' },
  chipTile: { width: 18, height: 18, borderRadius: 6, backgroundColor: colors.lime, alignItems: 'center', justifyContent: 'center' },
  chipBig: { flexDirection: 'row', alignItems: 'center', gap: 10, height: 36, paddingLeft: 7, paddingRight: 16, borderRadius: 14, backgroundColor: colors.ink, transform: [{ rotate: '-3deg' }] },
  statusTag: { flexDirection: 'row', alignItems: 'center', gap: 7, height: 26, paddingHorizontal: 13, borderRadius: radius.pill, backgroundColor: colors.white },
  gameRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 9, paddingLeft: 10, paddingRight: 12, borderRadius: radius.card, backgroundColor: colors.white },
  settingRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  segmented: { flexDirection: 'row', padding: 4, borderRadius: radius.pill, backgroundColor: colors.soft, gap: 4 },
  segment: { flex: 1, height: 40, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  field: { padding: 14, borderRadius: 18, backgroundColor: colors.white, gap: 4 },
});
