import { useLocalSearchParams } from 'expo-router';
import { GamesScreen } from '@waken/app';

export default function Games() {
  const { q } = useLocalSearchParams<{ q?: string }>();
  return <GamesScreen query={q} />;
}
