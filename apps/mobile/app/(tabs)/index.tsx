import { Linking, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, colors, DeviceCard, fonts, GameTile, Logo, SectionHeader, StatusDot, type } from '@waken/ui';
import { canWake, type Device, type Game } from '@waken/core';
import { useWaken } from '../../src/store';
import { isTunnelAvailable, useNetwork } from '../../src/network';
import { useDeviceStatus, useGameImage, useGameLogo, useLibrary } from '../../src/hooks';

function greeting() {
  const h = new Date().getHours();
  return h < 6 ? 'Bonne nuit' : h < 18 ? 'Salut' : 'Bonsoir';
}

export default function Home() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const devices = useWaken((s) => s.devices);
  const { games } = useLibrary();
  const hero = games[0];
  const heroDevice = devices.find((d) => d.id === hero?.deviceId);
  const contentWidth = Math.min(width, 900) - 36;

  return (
    <ScrollView style={{ backgroundColor: colors.bg0 }} contentContainerStyle={[styles.content, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 110 }]}>
      <View style={styles.header}>
        <Logo size={30} />
      </View>

      <View style={{ gap: 4 }}>
        <Text style={[type.title, { fontFamily: fonts.display, fontSize: 28, lineHeight: 34, color: colors.ink }]}>{greeting()}</Text>
        {isTunnelAvailable ? <WakenNetworkLine /> : <NetworkStatus devices={devices} />}
      </View>

      <SignInCard />

      {hero && heroDevice ? <HeroTile game={hero} device={heroDevice} height={Math.round(contentWidth * 0.6)} onPress={() => router.push(`/device/${heroDevice.id}?game=${encodeURIComponent(hero.id)}`)} /> : null}

      <SectionHeader title="Appareils" action="Gérer" onAction={() => router.push('/devices')} />
      <View style={{ gap: 10 }}>
        {devices.map((d) => (
          <DeviceRow key={d.id} device={d} highlight={d.id === heroDevice?.id} />
        ))}
      </View>

      <SectionHeader title="Continuer" action="Tout voir" onAction={() => router.push('/games')} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12 }}>
        {games.slice(1, 12).map((g) => (
          <SmallTile key={g.id} game={g} device={devices.find((d) => d.id === g.deviceId)} />
        ))}
      </ScrollView>
    </ScrollView>
  );
}

function HeroTile({ game, device, height, onPress }: { game: Game; device: Device; height: number; onPress: () => void }) {
  const image = useGameImage(game);
  const logo = useGameLogo(game);
  return <GameTile title={game.title} device={device.name} image={image} logo={logo} height={height} resume onPress={onPress} />;
}

function SmallTile({ game, device }: { game: Game; device?: Device }) {
  const router = useRouter();
  const image = useGameImage(game);
  const logo = useGameLogo(game);
  return (
    <GameTile
      title={game.title}
      device={device?.name}
      image={image}
      logo={logo}
      width={220}
      height={124}
      onPress={() => device && router.push(`/device/${device.id}?game=${encodeURIComponent(game.id)}`)}
    />
  );
}

function DeviceRow({ device, highlight }: { device: Device; highlight?: boolean }) {
  const router = useRouter();
  const status = useDeviceStatus(device);
  const showPower = canWake(device) && status !== 'online';
  return (
    <DeviceCard
      kind={device.kind}
      name={device.name}
      status={status}
      detail={device.detail}
      highlight={highlight}
      onPress={() => device.kind !== 'homelab' && router.push(`/device/${device.id}`)}
      onPower={showPower ? () => router.push(`/wake/${device.id}`) : undefined}
    />
  );
}

/** Only claims a connection when a device answered. */
function WakenNetworkLine() {
  const status = useNetwork((s) => s.status);
  const online = status?.hosts.filter((h) => h.online).length ?? 0;
  const text =
    status?.state === 'running'
      ? online > 0
        ? `Réseau Waken · ${online} ${online > 1 ? 'ordinateurs en ligne' : 'ordinateur en ligne'}`
        : 'Réseau Waken · aucun ordinateur allumé'
      : status?.state === 'needs-login'
        ? 'Réseau Waken · connexion requise'
        : status?.state === 'error'
          ? `Réseau Waken · ${status.error ?? 'erreur'}`
          : 'Réseau Waken · démarrage…';
  const dot = status?.state === 'running' ? (online > 0 ? 'online' : 'offline') : status?.state === 'error' ? 'unreachable' : 'unknown';
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
      <StatusDot status={dot} />
      <Text style={[type.caption, { color: colors.ink2 }]}>{text}</Text>
    </View>
  );
}

/** First launch: one sign-in, then the computers running Waken appear by themselves. */
function SignInCard() {
  const status = useNetwork((s) => s.status);
  if (status?.state !== 'needs-login') return null;
  const url = status.loginUrl;
  return (
    <View style={{ gap: 12, padding: 16, borderRadius: 16, backgroundColor: colors.bg2, borderWidth: 1, borderColor: colors.line }}>
      <Text style={{ fontFamily: fonts.display, fontSize: 18, color: colors.ink }}>Connecte cet appareil</Text>
      <Text style={[type.body, { color: colors.ink2, fontSize: 14 }]}>
        Utilise le même compte que sur ton Mac ou ton PC. Ils apparaîtront ici tout seuls, chez toi comme ailleurs.
      </Text>
      <Button label={url ? 'Se connecter' : 'Préparation…'} variant="secondary" disabled={!url} loading={!url} onPress={() => url && Linking.openURL(url)} />
    </View>
  );
}

function NetworkStatus({ devices }: { devices: Device[] }) {
  const homelab = devices.find((d) => d.kind === 'homelab');
  const pc = devices.find((d) => d.kind === 'pc');
  if (!homelab || !pc) return null;
  return <NetworkStatusLine homelab={homelab} pc={pc} />;
}

function NetworkStatusLine({ homelab, pc }: { homelab: Device; pc: Device }) {
  const relay = useDeviceStatus(homelab);
  const computer = useDeviceStatus(pc);
  const connected = relay === 'online' || computer === 'online' || computer === 'waking';
  const checking = !connected && (relay === 'unknown' || computer === 'unknown');
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
      <StatusDot status={connected ? 'online' : checking ? 'unknown' : 'unreachable'} />
      <Text style={[type.caption, { color: colors.ink2 }]}>{connected ? 'Connecté via Tailscale' : checking ? 'Vérification…' : 'Rien ne répond · vérifie Tailscale'}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 18, gap: 20, width: '100%', maxWidth: 900, alignSelf: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
});
