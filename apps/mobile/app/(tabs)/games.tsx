import { useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, CoverTile, fonts, type } from '@waken/ui';
import type { Game } from '@waken/core';
import { useWaken } from '../../src/store';
import { useGameImage, useLibrary } from '../../src/hooks';

const GAP = 12;
const PADDING = 18;

export default function Games() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { games, loading, unreachable, refresh } = useLibrary();
  const [refreshing, setRefreshing] = useState(false);
  const severalHosts = new Set(games.map((g) => g.deviceId)).size > 1;
  const contentWidth = Math.min(width, 1100) - PADDING * 2;
  const cols = Math.max(3, Math.floor((contentWidth + GAP) / (150 + GAP)));
  const tileW = Math.floor((contentWidth - (cols - 1) * GAP) / cols);

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await refresh();
    } catch {
      // The hosts that failed are listed under the title.
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <ScrollView
      style={{ backgroundColor: colors.bg0 }}
      contentContainerStyle={{ paddingTop: insets.top + 16, paddingHorizontal: PADDING, paddingBottom: insets.bottom + 110, gap: 16 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.ink2} />}
    >
      <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <Text style={{ fontFamily: fonts.display, fontSize: 28, color: colors.ink }}>Jeux</Text>
        {games.length > 0 ? <Text style={[type.caption, { color: colors.ink3 }]}>{games.length}</Text> : null}
      </View>
      {unreachable.length > 0 ? (
        <Text style={[type.caption, { color: colors.ink2 }]}>
          {unreachable.join(', ')} ne répond pas : ses jeux s'afficheront quand il sera allumé.
        </Text>
      ) : null}
      {loading && games.length <= 1 ? <ActivityIndicator color={colors.ink2} style={{ marginTop: 40 }} /> : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: GAP }}>
        {games.map((g) => (
          <Tile key={g.id} game={g} width={tileW} showHost={severalHosts} />
        ))}
      </View>
      {!loading && games.length <= 1 ? (
        <Text style={[type.caption, { color: colors.ink3, textAlign: 'center' }]}>
          Les jeux installés sur tes machines (Steam, Epic, GOG, Mac) apparaissent ici tout seuls.
        </Text>
      ) : null}
    </ScrollView>
  );
}

function Tile({ game, width, showHost }: { game: Game; width: number; showHost: boolean }) {
  const router = useRouter();
  const cover = useGameImage(game, 'cover');
  const device = useWaken((s) => s.devices.find((d) => d.id === game.deviceId));
  return (
    <CoverTile
      title={game.title}
      image={game.art ? cover : undefined}
      width={width}
      badge={showHost ? device?.name : undefined}
      onPress={() => router.push(`/device/${game.deviceId}?game=${encodeURIComponent(game.id)}`)}
    />
  );
}
