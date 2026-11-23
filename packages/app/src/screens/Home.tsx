import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { Search } from 'lucide-react-native';
import { AppMark, colors, Display, MachineChip, PillButton, RankNumber, SectionTitle, shadows, StatusTag, TiltedArt, type, GameRow } from '@waken/ui';
import type { Game } from '@waken/core';
import { useDeviceStatus, useGameArt, useLibrary } from '../hooks';
import { useFrame, useNav } from '../nav';
import { useNetwork } from '../network';
import { useWaken } from '../store';
import { PhoneHeader, SignInCard, useMachineOf } from './parts';
import { Screen } from './Screen';

/** Accueil: "ON JOUE ?", the two last games, a search. Desktop: the same, in two columns. */
export function HomeScreen() {
  const nav = useNav();
  const { wide } = useFrame();
  const { games } = useLibrary();
  const devices = useWaken((s) => s.devices);
  const online = useNetwork((s) => s.status?.hosts.some((h) => h.online));
  const [query, setQuery] = useState('');
  const [first, second] = games;

  const search = (
    <View style={{ height: 56, borderRadius: 999, backgroundColor: colors.white, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, ...shadows.card }}>
      <Search size={20} color={colors.ink2} />
      <TextInput
        value={query}
        onChangeText={setQuery}
        onSubmitEditing={() => nav.games(query.trim() || undefined)}
        placeholder="Rechercher un jeu"
        placeholderTextColor={colors.muted}
        returnKeyType="search"
        accessibilityLabel="Rechercher un jeu"
        style={[type.body, { flex: 1, color: colors.ink }]}
      />
    </View>
  );

  if (wide) {
    return (
      <Screen ground="sun">
        <SignInCard />
        <View style={{ flexDirection: 'row', gap: 48, marginTop: 12 }}>
          <View style={{ flex: 1.1, gap: 18 }}>
            {first ? <NextUp game={first} /> : null}
            <Display size={120} align="left">
              On joue&nbsp;?
            </Display>
            <Text style={[type.body, { fontSize: 18, lineHeight: 26, color: colors.ink2, maxWidth: 520 }]}>
              {devices.length === 0
                ? 'Installe Waken sur ton PC ou ton Mac et connecte-toi avec le même compte : tes jeux arrivent ici tout seuls.'
                : first
                  ? `Un clic et ${first.title} se lance sur ta machine.`
                  : 'Tes jeux arrivent dès que ta machine répond.'}
            </Text>
            {first ? (
              <View style={{ flexDirection: 'row', gap: 12 }}>
                <PillButton label={online ? 'Jouer' : 'Allumer et jouer'} size="lg" onPress={() => nav.play(first.deviceId, first.id, first.sunshineApp)} />
              </View>
            ) : null}
            {search}
          </View>
          <View style={{ flex: 1, gap: 14 }}>
            <SectionTitle title="Tes jeux" action="Tout voir" onAction={() => nav.games()} />
            {games.slice(0, 4).map((g, i) => (
              <RankedRow key={g.id} game={g} rank={i + 1} />
            ))}
          </View>
        </View>
      </Screen>
    );
  }

  return (
    <Screen ground="sun">
      <PhoneHeader />
      <SignInCard />
      <Display size={84} style={{ marginTop: 14 }}>
        On joue&nbsp;?
      </Display>
      <Collage left={first} right={second} />
      <Text style={[type.title, { color: colors.ink, textAlign: 'center', marginTop: 10 }]}>{online ? 'Choisis ton jeu' : 'Réveille ta machine'}</Text>
      <View style={{ marginTop: 16 }}>{search}</View>
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 26 }}>
        {[first, second].map((g, i) => (g ? <TopCard key={g.id} game={g} rank={i + 1} /> : <View key={i} style={{ flex: 1 }} />))}
      </View>
    </Screen>
  );
}

/** Two tilted covers and the Waken sticker, under the title. */
function Collage({ left, right }: { left?: Game; right?: Game }) {
  const leftArt = useGameArt(left, 'hero');
  const rightArt = useGameArt(right, 'hero');
  return (
    <View style={{ height: 176, marginTop: -26 }}>
      <View style={{ position: 'absolute', left: 14, top: 28 }}>
        <TiltedArt source={leftArt} title={left?.title ?? 'Waken'} width={170} height={118} rotate={-8} rounded={24} />
      </View>
      <View style={{ position: 'absolute', right: 10, top: 40 }}>
        <TiltedArt source={rightArt} title={right?.title ?? 'Waken'} width={170} height={118} rotate={7} rounded={24} />
      </View>
      <View style={{ position: 'absolute', left: '50%', marginLeft: -39, top: 0, transform: [{ rotate: '-8deg' }], ...shadows.lift }}>
        <AppMark size={78} />
      </View>
    </View>
  );
}

function TopCard({ game, rank }: { game: Game; rank: number }) {
  const nav = useNav();
  const art = useGameArt(game, 'cover');
  const machine = useMachineOf(game);
  return (
    <Pressable onPress={() => nav.game(game.id)} accessibilityRole="button" accessibilityLabel={game.title} style={{ flex: 1, alignItems: 'center', gap: 6 }}>
      <View style={{ width: 156, height: 132 }}>
        <View style={{ position: 'absolute', right: 2, top: 0 }}>
          <TiltedArt source={art} title={game.title} width={132} height={120} rotate={rank % 2 ? -5 : 5} />
        </View>
        <View style={{ position: 'absolute', left: 0, bottom: -10 }}>
          <RankNumber n={rank} size={86} />
        </View>
      </View>
      <Text numberOfLines={1} style={[type.headline, { fontSize: 19, color: colors.ink, marginTop: 10 }]}>
        {game.title}
      </Text>
      <MachineChip name={machine.name} icon={machine.icon} />
    </Pressable>
  );
}

function RankedRow({ game, rank }: { game: Game; rank: number }) {
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

/** Desktop: which machine the next game runs on, and whether it is ready. */
function NextUp({ game }: { game: Game }) {
  const machine = useMachineOf(game);
  const status = useDeviceStatus(machine.device);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <MachineChip name={machine.name} icon={machine.icon} big />
      <StatusTag status={status} />
    </View>
  );
}
