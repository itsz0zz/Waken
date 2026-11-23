import { useLocalSearchParams } from 'expo-router';
import { GameScreen } from '@waken/app';

export default function Game() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <GameScreen gameId={id} />;
}
