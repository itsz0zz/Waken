import { useMemo, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { colors, Display, FadeIn, GameRow, GameRowSkeleton, PillButton, stagger, type } from '@waken/ui';
import type { Game } from '@waken/core';
import { useGameArt, useLibrary } from '../hooks';
import { useFrame, useNav } from '../nav';
import { useWaken } from '../store';
import { PhoneHeader, useMachineOf } from './parts';
import { Screen } from './Screen';

/** "TES JEUX": every game of every machine, filtered by machine or by a search from the home screen. */
export function GamesScreen({ query }: { query?: string }) {
  const { wide } = useFrame();
  const { games, loading, unreachable, refresh } = useLibrary();
  const devices = useWaken((s) => s.devices);
  const [machine, setMachine] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const shown = useMemo(() => {
    const q = query?.toLocaleLowerCase('fr');
    return games.filter((g) => (!machine || g.deviceId === machine) && (!q || g.title.toLocaleLowerCase('fr').includes(q)));
  }, [games, machine, query]);
  const machines = devices.filter((d) => games.some((g) => g.deviceId === d.id));

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await refresh();
    } catch {
      // The machines that failed are listed under the title.
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <Screen ground="sky" refreshing={refreshing} onRefresh={onRefresh} maxWidth={wide ? 1100 : 600}>
      <PhoneHeader />
      <Display size={wide ? 110 : 86} align={wide ? 'left' : 'center'} style={{ marginTop: 14 }}>
        Tes jeux
      </Display>
      {machines.length > 1 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 4, flexGrow: 1, justifyContent: 'center' }} style={{ marginTop: 12 }}>
          <PillButton label="Tous" size="sm" variant={machine == null ? 'ink' : 'outline'} onPress={() => setMachine(null)} />
          {machines.map((d) => (
            <PillButton key={d.id} label={d.name} size="sm" variant={machine === d.id ? 'ink' : 'outline'} onPress={() => setMachine(d.id)} />
          ))}
        </ScrollView>
      ) : null}
      {query ? <Text style={[type.caption, { color: colors.ink, textAlign: 'center', marginTop: 10 }]}>Recherche : « {query} »</Text> : null}
      {unreachable.length > 0 ? (
        <Text style={[type.caption, { color: colors.ink, textAlign: 'center', marginTop: 10 }]}>
          {unreachable.join(', ')} ne répond pas : ses jeux reviennent dès qu'il est allumé.
        </Text>
      ) : null}
      <View style={{ marginTop: 20, gap: 12, ...(wide ? { flexDirection: 'row', flexWrap: 'wrap' } : null) }}>
        {loading && shown.length === 0
          ? [0, 1, 2, 3].map((i) => (
              <View key={i} style={wide ? { width: '48.5%' } : undefined}>
                <GameRowSkeleton />
              </View>
            ))
          : shown.map((g, i) => (
              <FadeIn key={g.id} delay={stagger(i)} style={wide ? { width: '48.5%' } : undefined}>
                <Row game={g} rank={i + 1} />
              </FadeIn>
            ))}
      </View>
      {!loading && shown.length === 0 ? (
        <Text style={[type.body, { color: colors.ink2, textAlign: 'center', marginTop: 24 }]}>
          {query ? 'Aucun jeu ne correspond.' : 'Les jeux installés sur tes machines (Steam, Epic, GOG, Mac) arrivent ici tout seuls.'}
        </Text>
      ) : null}
    </Screen>
  );
}

function Row({ game, rank }: { game: Game; rank: number }) {
  const nav = useNav();
  const art = useGameArt(game, 'hero');
  const machine = useMachineOf(game);
  return (
    <GameRow
      rank={rank}
      title={game.title}
      art={art}
      machine={machine.name}
      machineIcon={machine.icon}
      onPress={() => nav.game(game.id)}
      onPlay={() => nav.play(game.deviceId, game.id, game.sunshineApp)}
    />
  );
}
