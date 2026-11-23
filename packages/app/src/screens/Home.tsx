import { Pressable, Text, View } from 'react-native';
import { Play, Power } from 'lucide-react-native';
import { AppMark, colors, CoverSkeleton, Display, FadeIn, GameTitle, PillButton, PressScale, RankNumber, SectionTitle, shadows, Skeleton, stagger, TiltedArt, type } from '@waken/ui';
import { canWake, type Game } from '@waken/core';
import { useDeviceStatus, useGameArt, useLibrary } from '../hooks';
import { useFrame, useNav } from '../nav';
import { useNetwork } from '../network';
import { useWaken } from '../store';
import { PhoneHeader, SignInCard, useMachineOf } from './parts';
import { GameSearch } from './Search';
import { Screen } from './Screen';

/** Accueil: "ON JOUE ?", the two last games, a search. Desktop: the same, in two columns. */
export function HomeScreen() {
  const nav = useNav();
  const { wide } = useFrame();
  const { games, loading } = useLibrary();
  const devices = useWaken((s) => s.devices);
  const online = useNetwork((s) => s.status?.hosts.some((h) => h.online));
  const [first, second] = games;
  // Machines known but their library not there yet: shapes that load, not an empty screen.
  const waiting = loading && games.length === 0;

  if (wide) {
    return (
      <Screen ground="sun" maxWidth={1192}>
        <SignInCard />
        <View style={{ height: 420, flexDirection: 'row' }}>
          <View style={{ width: 600, justifyContent: 'center', gap: 20, zIndex: 2 }}>
            <Display size={150} align="left" style={{ letterSpacing: -2 }}>
              On joue&nbsp;?
            </Display>
            <Text style={[type.body, { fontSize: 18, lineHeight: 26, color: colors.ink2, maxWidth: 440 }]}>
              {devices.length === 0
                ? 'Installe Waken sur ton PC ou ton Mac et connecte-toi avec le même compte : tes jeux arrivent ici tout seuls.'
                : first
                  ? `Un clic et ${first.title} se lance tout seul sur ta machine.`
                  : 'Tes jeux arrivent dès que ta machine répond.'}
            </Text>
            {first ? <HeroActions game={first} /> : null}
          </View>
          <View style={{ flex: 1 }}>
            <WideCollage first={first} second={second} />
          </View>
        </View>
        <View style={{ marginTop: 18 }}>
          <SectionTitle title="Tes jeux" action="Tout voir" onAction={() => nav.games()} />
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 20, marginTop: 22 }}>
          {waiting
            ? [0, 1, 2, 3].map((i) => <GridTileSkeleton key={i} rank={i + 1} />)
            : games.slice(0, 4).map((g, i) => (
                <FadeIn key={g.id} delay={stagger(i)}>
                  <GridTile game={g} rank={i + 1} />
                </FadeIn>
              ))}
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
      <GameSearch style={{ marginTop: 16 }} />
      {/* One game alone sits in the middle, two share the row. */}
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 26, justifyContent: 'center' }}>
        {waiting
          ? [0, 1].map((i) => <TopCardSkeleton key={i} rank={i + 1} />)
          : [first, second].filter((g): g is Game => !!g).map((g, i) => (
              <FadeIn key={g.id} delay={stagger(i)} style={{ flex: 1, maxWidth: '50%' }}>
                <TopCard game={g} rank={i + 1} />
              </FadeIn>
            ))}
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
    <PressScale onPress={() => nav.game(game.id)} accessibilityRole="button" accessibilityLabel={game.title} style={{ alignItems: 'center', gap: 6 }}>
      <View style={{ width: 156, height: 132 }}>
        <View style={{ position: 'absolute', right: 2, top: 0 }}>
          <TiltedArt source={art} title={game.title} width={132} height={120} rotate={rank % 2 ? -5 : 5} />
        </View>
        <View style={{ position: 'absolute', left: 0, bottom: -10 }}>
          <RankNumber n={rank} size={86} />
        </View>
      </View>
      <View style={{ marginTop: 10, alignSelf: 'stretch', gap: 2 }}>
        <GameTitle title={game.title} platform={machine.platform} size={19} align="center" />
        <Text numberOfLines={1} style={[type.caption, { color: colors.ink2, textAlign: 'center' }]}>
          {machine.name}
        </Text>
      </View>
    </PressScale>
  );
}


/** Desktop hero buttons: the black one with its lime round icon, and waking only when that makes sense. */
function HeroActions({ game }: { game: Game }) {
  const nav = useNav();
  const machine = useMachineOf(game);
  const status = useDeviceStatus(machine.device);
  const ready = status === 'online';
  const wakeable = machine.device ? canWake(machine.device) : false;
  const Icon = ready || !wakeable ? Play : Power;
  return (
    <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
      <Pressable
        onPress={() => nav.play(game.deviceId, game.id, game.sunshineApp)}
        accessibilityRole="button"
        style={({ pressed }) => [{ height: 60, paddingLeft: 10, paddingRight: 26, borderRadius: 999, backgroundColor: colors.ink, flexDirection: 'row', alignItems: 'center', gap: 12, ...shadows.lift }, pressed && { transform: [{ scale: 0.97 }] }]}
      >
        <View style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: colors.lime, alignItems: 'center', justifyContent: 'center' }}>
          <Icon size={20} color={colors.ink} strokeWidth={2.4} fill={Icon === Play ? colors.ink : 'none'} />
        </View>
        <Text style={[type.button, { fontSize: 16, color: colors.white }]}>{ready || !wakeable ? 'Jouer' : 'Allumer et jouer'}</Text>
      </Pressable>
      {wakeable && !ready ? <PillButton label="Allumer seulement" variant="outline" size="lg" style={{ height: 60, borderWidth: 3 }} onPress={() => nav.wakeOnly(game.deviceId)} /> : null}
    </View>
  );
}

/** The big tilted covers of the desktop hero, with the Waken sticker. */
function WideCollage({ first, second }: { first?: Game; second?: Game }) {
  const firstArt = useGameArt(first, 'hero');
  const secondArt = useGameArt(second, 'hero');
  return (
    <View style={{ flex: 1 }}>
      <View style={{ position: 'absolute', left: 40, top: 30 }}>
        <TiltedArt source={firstArt} title={first?.title ?? 'Waken'} width={470} height={300} rotate={-5} border={8} rounded={32} />
      </View>
      <View style={{ position: 'absolute', right: 0, top: 226 }}>
        <TiltedArt source={secondArt} title={second?.title ?? 'Waken'} width={250} height={170} rotate={8} border={7} rounded={26} />
      </View>
      <View style={{ position: 'absolute', left: 4, top: 262, transform: [{ rotate: '-10deg' }], ...shadows.lift }}>
        <AppMark size={112} />
      </View>
    </View>
  );
}

/** A game of the desktop grid: tilted cover, rank, name and machine, no card around. */
function GridTile({ game, rank }: { game: Game; rank: number }) {
  const nav = useNav();
  const art = useGameArt(game, 'hero');
  const machine = useMachineOf(game);
  return (
    <PressScale onPress={() => nav.game(game.id)} accessibilityRole="button" accessibilityLabel={game.title} style={{ width: 280, flexDirection: 'row', alignItems: 'center', gap: 16 }}>
      <View style={{ width: 132, height: 112 }}>
        <View style={{ position: 'absolute', right: 0, top: 0 }}>
          <TiltedArt source={art} title={game.title} width={118} height={104} rotate={rank % 2 ? -6 : 5} border={5} rounded={20} />
        </View>
        <View style={{ position: 'absolute', left: 0, bottom: -12 }}>
          <RankNumber n={rank} size={74} />
        </View>
      </View>
      <View style={{ flex: 1, gap: 6 }}>
        <GameTitle title={game.title} platform={machine.platform} />
        <Text numberOfLines={1} style={[type.caption, { color: colors.ink2 }]}>
          {machine.name}
        </Text>
      </View>
    </PressScale>
  );
}

/** Stands for a home card while the library loads: same tilted cover, rank and lines. */
function TopCardSkeleton({ rank }: { rank: number }) {
  return (
    <View style={{ flex: 1, alignItems: 'center', gap: 8 }}>
      <View style={{ width: 156, height: 132 }}>
        <View style={{ position: 'absolute', right: 2, top: 0 }}>
          <CoverSkeleton width={132} height={120} rotate={rank % 2 ? -5 : 5} />
        </View>
      </View>
      <Skeleton width={110} height={18} radius={6} style={{ marginTop: 10 }} />
      <Skeleton width={90} height={26} radius={9} />
    </View>
  );
}

function GridTileSkeleton({ rank }: { rank: number }) {
  return (
    <View style={{ width: 280, flexDirection: 'row', alignItems: 'center', gap: 16 }}>
      <View style={{ width: 132, height: 112, alignItems: 'flex-end' }}>
        <CoverSkeleton width={118} height={104} rotate={rank % 2 ? -6 : 5} />
      </View>
      <View style={{ flex: 1, gap: 8 }}>
        <Skeleton width="80%" height={18} radius={6} />
        <Skeleton width={96} height={26} radius={9} />
      </View>
    </View>
  );
}

