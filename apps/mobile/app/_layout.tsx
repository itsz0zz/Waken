import { useEffect } from 'react';
import { Alert, Platform } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts } from 'expo-font';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Unbounded_600SemiBold, Unbounded_700Bold } from '@expo-google-fonts/unbounded';
import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold } from '@expo-google-fonts/inter';
import { JetBrainsMono_600SemiBold } from '@expo-google-fonts/jetbrains-mono';
import { colors } from '@waken/ui';
import { useConfigLoad } from '../src/store';
import { useNetworkRunner } from '../src/network';

SplashScreen.preventAutoHideAsync();
// Without it an iPhone stays in landscape after leaving the stream. iPad and Mac keep every orientation.
const screenOrientation = Platform.OS === 'ios' && !Platform.isPad ? 'portrait_up' : 'default';
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

/** Mounted once the Keychain has answered: computers found on the network are saved into the loaded configuration. */
function NetworkRunner() {
  useNetworkRunner();
  return null;
}

export default function RootLayout() {
  const config = useConfigLoad((s) => s.state);
  const [fontsLoaded] = useFonts({
    Unbounded_600SemiBold,
    Unbounded_700Bold,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    JetBrainsMono_600SemiBold,
  });

  // Screens copy the configuration into their fields: never show them before the Keychain has answered.
  const ready = fontsLoaded && config !== 'loading';

  useEffect(() => {
    if (!ready) return;
    void SplashScreen.hideAsync();
    if (config === 'failed') Alert.alert('Configuration illisible', "Le Trousseau n'a pas répondu. Relance Waken avant de modifier un réglage, sinon ta configuration sera écrasée.");
  }, [ready, config]);
  if (!ready) return null;

  return (
    <QueryClientProvider client={queryClient}>
      <NetworkRunner />
      <SafeAreaProvider>
        <StatusBar style="light" />
        <Stack screenOptions={{ headerShown: false, orientation: screenOrientation, contentStyle: { backgroundColor: colors.bg0 } }}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="device/[id]" />
          <Stack.Screen name="edit/[id]" />
          <Stack.Screen name="wake/[id]" options={{ presentation: 'fullScreenModal', animation: 'fade' }} />
          <Stack.Screen name="stream/[id]" options={{ presentation: 'fullScreenModal', animation: 'fade', orientation: 'landscape' }} />
        </Stack>
      </SafeAreaProvider>
    </QueryClientProvider>
  );
}
