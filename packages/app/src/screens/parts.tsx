import { Linking, Text, View } from 'react-native';
import { ChevronLeft, Monitor, type LucideIcon } from 'lucide-react-native';
import { AppMark, Card, colors, machineIcon, PillButton, RoundButton, type, Wordmark, type Platform } from '@waken/ui';
import type { Device, Game } from '@waken/core';
import { useNav } from '../nav';
import { platform } from '../platform';
import { useNetwork } from '../network';
import { useWaken } from '../store';

/** Phone header: the wordmark and a round button to the machines, badged with how many are ready. Desktop has its own bar. */
export function PhoneHeader() {
  const nav = useNav();
  const online = useNetwork((s) => s.status?.hosts.filter((h) => h.online).length ?? 0);
  if (platform().form === 'desktop') return null;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
      <Wordmark height={26} />
      <RoundButton icon={Monitor} label={`Machines, ${online} prêtes`} badge={online || undefined} onPress={nav.machines} />
    </View>
  );
}

/** Back button, a centered label, and an optional right button. */
export function BackHeader({ title, right }: { title?: string; right?: { icon: LucideIcon; label: string; onPress: () => void } }) {
  const nav = useNav();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
      <RoundButton icon={ChevronLeft} label="Retour" variant="white" onPress={nav.back} />
      {title ? <Text style={[type.title, { fontSize: 24, color: colors.ink }]}>{title}</Text> : null}
      {right ? <RoundButton icon={right.icon} label={right.label} variant="white" onPress={right.onPress} /> : <View style={{ width: 56 }} />}
    </View>
  );
}

/** First launch: one sign-in, then the computers running Waken appear by themselves. */
export function SignInCard() {
  const status = useNetwork((s) => s.status);
  if (status?.state !== 'needs-login') return null;
  const url = status.loginUrl;
  return (
    <Card lifted style={{ gap: 12, padding: 20, alignItems: 'center' }}>
      <AppMark size={56} />
      <Text style={[type.title, { color: colors.ink, textAlign: 'center' }]}>Connecte cet appareil</Text>
      <Text style={[type.body, { color: colors.ink2, textAlign: 'center' }]}>
        Avec le même compte que sur ton Mac ou ton PC. Ils apparaîtront ici tout seuls, chez toi comme ailleurs.
      </Text>
      <PillButton label={url ? 'Se connecter' : 'Préparation…'} loading={!url} disabled={!url} onPress={() => url && Linking.openURL(url)} style={{ alignSelf: 'stretch' }} />
    </Card>
  );
}

/** The machine a game runs on, and the platform logo shown next to its name. */
export function useMachineOf(game?: Game): { device?: Device; name: string; icon: LucideIcon; platform: Platform } {
  const device = useWaken((s) => s.devices.find((d) => d.id === game?.deviceId));
  return { device, name: device?.name ?? 'Machine', icon: device ? machineIcon(device.kind, device.detail) : Monitor, platform: platformOf(device, game) };
}

/** Where a game runs: the PS5, a Mac, or Windows. Xbox and Game Pass games show their own logo. */
export function platformOf(device?: Device, game?: Game): Platform {
  if (device?.kind === 'playstation') return 'playstation';
  if (game?.store === 'Xbox') return 'xbox';
  if (device?.detail === 'Mac') return 'mac';
  return 'windows';
}

/** "hier", "il y a 3 jours", for the last played line. */
export function sinceLabel(iso?: string): string | undefined {
  if (!iso) return undefined;
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "aujourd'hui";
  if (days === 1) return 'hier';
  return `il y a ${days} jours`;
}
