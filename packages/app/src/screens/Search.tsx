import { useMemo, useState } from 'react';
import { Pressable, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import { colors, FadeIn, SearchField, shadows, TiltedArt, type } from '@waken/ui';
import type { Game } from '@waken/core';
import { useGameArt, useLibrary } from '../hooks';
import { useNav } from '../nav';
import { useMachineOf } from './parts';

const MAX = 5;

/**
 * The search field with its results under it, live while typing: the five closest games, and the full list
 * on Return. Shared by the phone home screen and the desktop top bar.
 */
export function GameSearch({ height = 56, floating, style }: { height?: number; floating?: boolean; style?: StyleProp<ViewStyle> }) {
  const nav = useNav();
  const { games } = useLibrary();
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);
  const q = query.trim().toLocaleLowerCase('fr');
  const matches = useMemo(
    () =>
      !q
        ? []
        : games
            .filter((g) => g.title.toLocaleLowerCase('fr').includes(q))
            // Titles starting with the search first: "Ha" finds Hades before Shadow of Hades.
            .sort((a, b) => Number(!a.title.toLocaleLowerCase('fr').startsWith(q)) - Number(!b.title.toLocaleLowerCase('fr').startsWith(q))),
    [games, q]
  );
  const open = (focused || !!q) && q.length > 0;
  const pick = (game: Game) => {
    setQuery('');
    nav.game(game.id);
  };

  return (
    <View style={[{ zIndex: 10 }, style]}>
      <SearchField value={query} onChangeText={setQuery} height={height} onFocusChange={setFocused} onSubmit={() => { if (q) nav.games(query.trim()); setQuery(''); }} />
      {open ? (
        <FadeIn
          distance={6}
          style={[
            { marginTop: 8, borderRadius: 24, backgroundColor: colors.white, paddingVertical: 6, ...shadows.lift },
            floating ? { position: 'absolute', top: height, left: 0, right: 0 } : null,
          ]}
        >
          {matches.length === 0 ? (
            <Text style={[type.body, { color: colors.ink2, paddingHorizontal: 18, paddingVertical: 12 }]}>Aucun jeu ne correspond.</Text>
          ) : (
            matches.slice(0, MAX).map((g) => <Result key={g.id} game={g} onPress={() => pick(g)} />)
          )}
          {matches.length > MAX ? (
            <Pressable onPress={() => { nav.games(query.trim()); setQuery(''); }} accessibilityRole="button" style={{ paddingHorizontal: 18, paddingVertical: 10 }}>
              <Text style={[type.button, { fontSize: 14, color: colors.ink }]}>Voir les {matches.length} résultats</Text>
            </Pressable>
          ) : null}
        </FadeIn>
      ) : null}
    </View>
  );
}

function Result({ game, onPress }: { game: Game; onPress: () => void }) {
  const art = useGameArt(game, 'cover');
  const machine = useMachineOf(game);
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={game.title} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: pressed ? colors.soft : 'transparent' })}>
      <TiltedArt source={art} title={game.title} width={40} height={52} rotate={0} border={2} rounded={10} lifted={false} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={[type.label, { color: colors.ink }]}>
          {game.title}
        </Text>
        <Text numberOfLines={1} style={[type.caption, { color: colors.ink2 }]}>
          {machine.name}
        </Text>
      </View>
      <ChevronRight size={18} color={colors.muted} />
    </Pressable>
  );
}
