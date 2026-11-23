import { useLocalSearchParams } from 'expo-router';
import { StreamScreen } from '@waken/app';

export default function Stream() {
  const { id, game, app } = useLocalSearchParams<{ id: string; game?: string; app?: string }>();
  return <StreamScreen deviceId={id} gameId={game} app={app} />;
}
