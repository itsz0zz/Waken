import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type PressableProps, type ViewStyle } from 'react-native';
import { BlurView } from 'expo-blur';
import { Image, type ImageSource } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle, Path } from 'react-native-svg';
import { Gamepad2, Monitor, Play, Power, Server, type LucideIcon } from 'lucide-react-native';
import { colors, deviceTint, fonts, radius, shadows, type, type DeviceTint } from './tokens';

/* ---------- Logo ---------- */

/** The Waken moon mark (crescent + dot) on its dark tile. */
export function LogoMark({ size = 32 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 128 128" accessibilityLabel="Waken">
      <Path d="M30 0h68a30 30 0 0 1 30 30v68a30 30 0 0 1-30 30H30A30 30 0 0 1 0 98V30A30 30 0 0 1 30 0z" fill={colors.bg1} />
      <Path d="M78 26a40 40 0 1 0 24 62A32 32 0 0 1 78 26z" fill={colors.neon} />
      <Circle cx={96} cy={38} r={9} fill={colors.ink} />
    </Svg>
  );
}

/** Lockup: mark + WAKEN set in Unbounded (font loaded by the app). */
export function Logo({ size = 30 }: { size?: number }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: size * 0.3 }}>
      <LogoMark size={size} />
      <Text style={{ fontFamily: fonts.display, fontSize: size * 0.5, letterSpacing: size * 0.06, color: colors.ink }}>WAKEN</Text>
    </View>
  );
}

/* ---------- Glass surface ---------- */

export function Glass({ style, children, intensity = 30 }: { style?: ViewStyle | ViewStyle[]; children?: React.ReactNode; intensity?: number }) {
  return (
    <BlurView intensity={intensity} tint="dark" style={[styles.glass, style as ViewStyle]}>
      {children}
    </BlurView>
  );
}

/* ---------- Button ---------- */

type ButtonVariant = 'primary' | 'secondary' | 'glass' | 'ghost';

export function Button({
  label,
  icon: Icon,
  variant = 'primary',
  loading,
  style,
  ...rest
}: PressableProps & { label: string; icon?: LucideIcon; variant?: ButtonVariant; loading?: boolean; style?: ViewStyle }) {
  const v = buttonVariants[variant];
  return (
    <Pressable
      accessibilityRole="button"
      style={({ pressed }) => [styles.button, v.container, pressed && { opacity: 0.85, transform: [{ scale: 0.98 }] }, style]}
      {...rest}
    >
      {loading ? <ActivityIndicator color={v.fg} /> : Icon ? <Icon size={18} color={v.fg} strokeWidth={2.2} /> : null}
      <Text style={[styles.buttonLabel, { color: v.fg }]}>{label}</Text>
    </Pressable>
  );
}

const buttonVariants: Record<ButtonVariant, { container: ViewStyle; fg: string }> = {
  primary: { container: { backgroundColor: colors.neon, ...shadows.glowNeon }, fg: colors.neonInk },
  secondary: { container: { backgroundColor: colors.bg3, borderWidth: 1, borderColor: colors.line }, fg: colors.ink },
  glass: { container: { backgroundColor: colors.glass, borderWidth: 1, borderColor: colors.glassLine }, fg: colors.ink },
  ghost: { container: { backgroundColor: 'transparent' }, fg: colors.ink2 },
};

export function IconButton({ icon: Icon, label, variant = 'glass', size = 44, ...rest }: PressableProps & { icon: LucideIcon; label: string; variant?: ButtonVariant; size?: number }) {
  const v = buttonVariants[variant];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
      style={({ pressed }) => [{ width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center' }, v.container, pressed && { opacity: 0.8 }]}
      {...rest}
    >
      <Icon size={size * 0.42} color={v.fg} strokeWidth={2.2} />
    </Pressable>
  );
}

/* ---------- Status ---------- */

export type DeviceStatus = 'online' | 'waking' | 'sleeping' | 'offline' | 'unreachable' | 'unknown';

export const statusMeta: Record<DeviceStatus, { label: string; color: string }> = {
  online: { label: 'Prêt', color: colors.online },
  waking: { label: 'Réveil…', color: colors.waking },
  sleeping: { label: 'En repos', color: colors.waking },
  offline: { label: 'Éteint', color: colors.offline },
  unreachable: { label: 'Injoignable', color: colors.danger },
  unknown: { label: '…', color: colors.ink3 },
};

export function StatusDot({ status, size = 7 }: { status: DeviceStatus; size?: number }) {
  return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: statusMeta[status].color }} />;
}

export function StatusPill({ status, label, onArt }: { status: DeviceStatus; label?: string; onArt?: boolean }) {
  return (
    <View style={[styles.pill, onArt ? styles.pillGlass : styles.pillSolid]}>
      <StatusDot status={status} />
      <Text style={styles.pillText}>{label ?? statusMeta[status].label}</Text>
    </View>
  );
}

/* ---------- Device ---------- */

const deviceIcons: Record<DeviceTint, LucideIcon> = { pc: Monitor, playstation: Gamepad2, homelab: Server };

export function DeviceIcon({ kind, size = 44 }: { kind: DeviceTint; size?: number }) {
  const Icon = deviceIcons[kind];
  const t = deviceTint[kind];
  return (
    <View style={{ width: size, height: size, borderRadius: radius.sm + (size - 34) / 6, backgroundColor: t.bg, alignItems: 'center', justifyContent: 'center' }}>
      <Icon size={size * 0.5} color={t.fg} strokeWidth={2} />
    </View>
  );
}

export function DeviceCard({
  kind,
  name,
  status,
  detail,
  onPress,
  onPower,
  highlight,
}: {
  kind: DeviceTint;
  name: string;
  status: DeviceStatus;
  detail?: string;
  onPress?: () => void;
  onPower?: () => void;
  highlight?: boolean;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.deviceCard, pressed && { backgroundColor: colors.bg3 }]} accessibilityRole="button">
      <DeviceIcon kind={kind} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[type.headline, { color: colors.ink, fontSize: 16 }]}>{name}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <StatusDot status={status} size={6} />
          <Text style={[type.caption, { color: colors.ink2 }]}>
            {statusMeta[status].label}
            {detail ? ` · ${detail}` : ''}
          </Text>
        </View>
      </View>
      {onPower ? <IconButton icon={Power} label={`Allumer ${name}`} variant={highlight ? 'primary' : 'secondary'} onPress={onPower} /> : null}
    </Pressable>
  );
}

/* ---------- Game tile ---------- */

export function GameTile({
  title,
  meta,
  device,
  image,
  width,
  height,
  resume,
  logo,
  onPress,
}: {
  title: string;
  meta?: string;
  device?: string;
  image: ImageSource | string | number;
  /** Official logo (transparent), shown instead of the title when it loads. */
  logo?: ImageSource;
  width?: number;
  height: number;
  resume?: boolean;
  onPress?: () => void;
}) {
  const [logoFailed, setLogoFailed] = React.useState(false);
  const showLogo = !!logo && !logoFailed;
  return (
    <Pressable onPress={onPress} style={{ width, height, borderRadius: radius.md, overflow: 'hidden' }} accessibilityRole="button" accessibilityLabel={title}>
      <Image source={image} style={StyleSheet.absoluteFill} contentFit="cover" transition={200} />
      <LinearGradient colors={['rgba(7,8,12,0)', 'rgba(7,8,12,0.9)']} locations={[0.3, 1]} style={StyleSheet.absoluteFill} />
      {device ? (
        <View style={[styles.pill, styles.pillGlass, { position: 'absolute', top: 10, left: 10, height: 24 }]}>
          <Text style={styles.pillText}>{device}</Text>
        </View>
      ) : null}
      <View style={{ position: 'absolute', left: 14, right: 14, bottom: 12, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <View style={{ flex: 1 }}>
          {resume ? <Text style={[type.overline, { color: colors.neon, marginBottom: 2 }]}>REPRENDRE</Text> : null}
          {showLogo ? (
            <Image
              source={logo}
              onError={() => setLogoFailed(true)}
              style={{ width: '70%', height: resume ? 64 : 34, marginBottom: 2 }}
              contentFit="contain"
              contentPosition="left bottom"
              accessibilityIgnoresInvertColors
            />
          ) : (
            <Text numberOfLines={1} style={{ fontFamily: fonts.display, fontSize: resume ? 26 : 15, color: colors.ink }}>
              {title}
            </Text>
          )}
          {meta ? <Text style={[type.caption, { color: colors.onArt, fontSize: 12 }]}>{meta}</Text> : null}
        </View>
        {resume ? (
          <View style={[{ width: 52, height: 52, borderRadius: 26, backgroundColor: colors.neon, alignItems: 'center', justifyContent: 'center' }, shadows.glowNeon]}>
            <Play size={20} color={colors.neonInk} fill={colors.neonInk} />
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

/* ---------- Cover (vertical box art) ---------- */

/**
 * A game's vertical cover, as on a shelf. The title is part of the art, so it is only drawn
 * when the cover fails to load (or for entries without one).
 */
export function CoverTile({
  title,
  image,
  width,
  badge,
  onPress,
}: {
  title: string;
  image?: ImageSource | string | number;
  width: number;
  /** Short label in the corner, e.g. the host name when there are several. */
  badge?: string;
  onPress?: () => void;
}) {
  const [failed, setFailed] = React.useState(!image);
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({ width, height: Math.round(width * 1.5), borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.bg2, opacity: pressed ? 0.85 : 1 })}
      accessibilityRole="button"
      accessibilityLabel={title}
    >
      {image && !failed ? (
        <Image source={image} onError={() => setFailed(true)} style={StyleSheet.absoluteFill} contentFit="cover" transition={200} recyclingKey={title} />
      ) : (
        <View style={{ flex: 1, padding: 12, justifyContent: 'flex-end' }}>
          <Gamepad2 size={22} color={colors.ink3} />
          <Text numberOfLines={3} style={{ fontFamily: fonts.display, fontSize: 14, color: colors.ink, marginTop: 8 }}>
            {title}
          </Text>
        </View>
      )}
      {badge ? (
        <View style={[styles.pill, styles.pillGlass, { position: 'absolute', top: 8, left: 8, height: 22 }]}>
          <Text style={styles.pillText}>{badge}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

/* ---------- Metrics ---------- */

export function MetricRow({ items }: { items: { label: string; value: string }[] }) {
  return (
    <View style={styles.metricRow}>
      {items.map((m, i) => (
        <View key={m.label} style={[{ flex: 1, alignItems: 'center', gap: 4 }, i > 0 && { borderLeftWidth: 1, borderLeftColor: colors.line }]}>
          <Text style={[type.metric, { color: colors.ink }]}>{m.value}</Text>
          <Text style={[type.caption, { color: colors.ink2, fontSize: 12 }]}>{m.label}</Text>
        </View>
      ))}
    </View>
  );
}

export function SectionHeader({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
      <Text style={[type.headline, { color: colors.ink }]}>{title}</Text>
      {action ? (
        <Pressable onPress={onAction} hitSlop={8}>
          <Text style={[type.caption, { color: colors.ink2, fontFamily: fonts.semibold, fontSize: 14 }]}>{action}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  glass: { overflow: 'hidden', backgroundColor: colors.glass, borderWidth: 1, borderColor: colors.glassLine },
  button: { height: 52, paddingHorizontal: 24, borderRadius: radius.pill, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  buttonLabel: { fontFamily: fonts.bold, fontSize: 16 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 7, height: 28, paddingHorizontal: 11, borderRadius: radius.pill, alignSelf: 'flex-start' },
  pillSolid: { backgroundColor: colors.bg2, borderWidth: 1, borderColor: colors.line },
  pillGlass: { backgroundColor: colors.glass, borderWidth: 1, borderColor: colors.glassLine },
  pillText: { fontFamily: fonts.semibold, fontSize: 12, color: colors.ink },
  deviceCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 22, backgroundColor: colors.bg2, borderWidth: 1, borderColor: colors.line },
  metricRow: { flexDirection: 'row', paddingVertical: 16, borderRadius: 22, backgroundColor: colors.bg2, borderWidth: 1, borderColor: colors.line },
});
