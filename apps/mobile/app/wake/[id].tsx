import { useLocalSearchParams } from 'expo-router';
import { WakeScreen } from '@waken/app';

export default function Wake() {
  const { id, game, app, only } = useLocalSearchParams<{ id: string; game?: string; app?: string; only?: string }>();
  return <WakeScreen deviceId={id} gameId={game} app={app} only={only === '1'} />;
}
