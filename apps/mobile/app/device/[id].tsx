import { useEffect, useState } from 'react';
import { Alert, Linking, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronLeft, Gamepad2, Pencil, Play, Power } from 'lucide-react-native';
import { canWake } from '@waken/core';
import { Button, colors, fonts, IconButton, MetricRow, StatusPill, type, DeviceIcon } from '@waken/ui';
import { useWaken } from '../../src/store';
import { pointStreamAt } from '../../src/network';
import { useDeviceStatus, useGameImage, useGameLogo, useLibrary, useSunshineInfo } from '../../src/hooks';
import { launchQuery } from '../../src/navigation';

export default function DeviceScreen() {
  const { id, game: gameId } = useLocalSearchParams<{ id: string; game?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const device = useWaken((s) => s.devices.find((d) => d.id === id));
  const { games } = useLibrary();
  const settings = useWaken((s) => s.settings);
  const game = games.find((g) => g.id === gameId) ?? games.find((g) => g.deviceId === id);
  // Sunshine's details below come through 127.0.0.1: make it this computer.
  useEffect(() => {
    pointStreamAt(device).catch(() => {});
  }, [device?.stream?.tunnelHost]);
  const status = useDeviceStatus(device!);
  const sunshine = useSunshineInfo(device);
  const image = useGameImage(game ?? { id: 'desktop', title: 'Bureau', deviceId: id });
  const logo = useGameLogo(game);
  if (!device) return null;

  const isPS = device.kind === 'playstation';
  const heroH = Math.min(480, width * 1.2);
  const q = settings.stream;

  const play = () => {
    if (isPS) {
      if (!settings.psRemotePlayUrl) {
        Alert.alert('PS Remote Play', "En V1, Waken ouvre l'app officielle PS Remote Play. Renseigne son lien dans Réglages. L'intégration directe arrive en V3 avec libchiaki.");
        return;
      }
      Linking.openURL(settings.psRemotePlayUrl).catch(() => Alert.alert('PS Remote Play', "Impossible d'ouvrir ce lien. Vérifie-le dans Réglages."));
      return;
    }
    router.push(`/wake/${device.id}${launchQuery(game?.id, game?.sunshineApp)}`);
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg0 }}>
      <Image source={image} style={{ position: 'absolute', top: 0, left: 0, right: 0, height: heroH }} contentFit="cover" />
      <LinearGradient colors={['rgba(7,8,12,0.35)', 'rgba(7,8,12,0)', 'rgba(7,8,12,0.6)', colors.bg0]} locations={[0, 0.25, 0.65, 1]} style={{ position: 'absolute', top: 0, left: 0, right: 0, height: heroH + 2 }} />

      <View style={[styles.topBar, { top: insets.top + 8 }]}>
        <IconButton icon={ChevronLeft} label="Retour" onPress={() => router.back()} />
        <IconButton icon={Pencil} label="Modifier l'appareil" onPress={() => router.push(`/edit/${id}`)} />
      </View>

      <ScrollView contentContainerStyle={{ paddingTop: heroH - 150, paddingHorizontal: 18, paddingBottom: insets.bottom + 24, gap: 16, maxWidth: 700, width: '100%', alignSelf: 'center' }}>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <View style={styles.chip}>
            <DeviceIcon kind={device.kind} size={20} />
            <Text style={styles.chipText}>{device.name}</Text>
          </View>
          <StatusPill status={status} onArt />
        </View>

        <View style={{ gap: 6 }}>
          <Title text={game?.title ?? device.name} logo={logo} />
          <Text style={[type.body, { color: colors.onArt, fontSize: 14 }]}>
            {isPS ? 'Remote Play' : sunshine.data ? `Sunshine ${sunshine.data.appVersion ?? ''} · prêt` : 'Sunshine · en attente du PC'}
          </Text>
        </View>

        <MetricRow
          items={[
            { label: 'Qualité', value: isPS ? '1080p' : `${q.height}p` },
            { label: 'Images/s', value: isPS ? '60' : String(q.fps) },
            { label: 'Codec', value: isPS ? 'H.264' : q.codec.toUpperCase() },
          ]}
        />

        <View style={styles.row}>
          <View style={styles.rowIcon}>
            <Gamepad2 size={20} color={colors.ink} />
          </View>
          <Text style={[type.headline, { color: colors.ink, fontSize: 15, flex: 1 }]}>Manette</Text>
          <Text style={[type.caption, { color: colors.ink2 }]}>Détectée au lancement</Text>
        </View>

        <View style={{ height: 12 }} />
        <Button label={status === 'online' ? 'Jouer' : isPS ? 'Ouvrir PS Remote Play' : canWake(device) ? 'Allumer et jouer' : 'Jouer'} icon={Play} onPress={play} />
        {canWake(device) && status !== 'online' ? <Button label="Allumer seulement" icon={Power} variant="ghost" onPress={() => router.push(`/wake/${device.id}?only=1`)} /> : null}
      </ScrollView>
    </View>
  );
}

/** The official logo over the banner when it loads, the title otherwise. */
function Title({ text, logo }: { text: string; logo?: ReturnType<typeof useGameLogo> }) {
  const [failed, setFailed] = useState(false);
  if (!logo || failed) return <Text style={[type.displayL, { color: colors.ink }]}>{text}</Text>;
  return (
    <Image
      source={logo}
      onError={() => setFailed(true)}
      style={{ width: '80%', height: 96 }}
      contentFit="contain"
      contentPosition="left bottom"
      accessibilityLabel={text}
    />
  );
}

const styles = StyleSheet.create({
  topBar: { position: 'absolute', left: 18, right: 18, zIndex: 2, flexDirection: 'row', justifyContent: 'space-between' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 7, height: 30, paddingLeft: 5, paddingRight: 11, borderRadius: 999, backgroundColor: colors.glass, borderWidth: 1, borderColor: colors.glassLine },
  chipText: { fontFamily: fonts.semibold, fontSize: 12, color: colors.ink },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 22, backgroundColor: colors.bg2, borderWidth: 1, borderColor: colors.line },
  rowIcon: { width: 36, height: 36, borderRadius: 10, backgroundColor: colors.bg3, alignItems: 'center', justifyContent: 'center' },
});
