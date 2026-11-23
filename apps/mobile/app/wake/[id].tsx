import { useState } from 'react';
import { Platform } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { WakeScreen } from '@waken/app';

/** iPhone: portrait while Réveil waits, landscape once the stream's first picture is there. iPad: any. */
const turns = Platform.OS === 'ios' && !Platform.isPad;

export default function Wake() {
  const { id, game, app, only } = useLocalSearchParams<{ id: string; game?: string; app?: string; only?: string }>();
  const [live, setLive] = useState(false);
  return (
    <>
      {turns ? <Stack.Screen options={{ orientation: live ? 'landscape' : 'portrait_up', statusBarHidden: live }} /> : null}
      <WakeScreen deviceId={id} gameId={game} app={app} only={only === '1'} onLiveChange={setLive} />
    </>
  );
}
