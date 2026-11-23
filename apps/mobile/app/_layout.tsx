import { useEffect, useState } from 'react';
import { Alert, Platform, useWindowDimensions } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts } from 'expo-font';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Anton_400Regular } from '@expo-google-fonts/anton';
import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold, Inter_800ExtraBold } from '@expo-google-fonts/inter';
import { AccountOverlay, BootScreen, FrameContext, usePushRegistration, NavContext, setPlatform, useConfigLoad, useLibrarySync, useNetwork, useNetworkRunner } from '@waken/app';
import { colors } from '@waken/ui';
import { mobilePlatform } from '../src/platform';
import { useRouterNav } from '../src/nav';

setPlatform(mobilePlatform);
SplashScreen.preventAutoHideAsync();
// Without it an iPhone stays in landscape after leaving the stream. iPad keeps every orientation.
const screenOrientation = Platform.OS === 'ios' && !Platform.isPad ? 'portrait_up' : 'default';
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

/** Mounted once the Keychain has answered: computers found on the network are saved into the loaded configuration. */
function NetworkRunner() {
  useNetworkRunner();
  usePushRegistration();
  useLibrarySync();
  return null;
}

function Providers({ children }: { children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const nav = useRouterNav();
  return (
    <NavContext.Provider value={nav}>
      <FrameContext.Provider value={{ top: insets.top, bottom: insets.bottom, wide: width >= 900 }}>{children}</FrameContext.Provider>
    </NavContext.Provider>
  );
}

export default function RootLayout() {
  const config = useConfigLoad((s) => s.state);
  const [fontsLoaded] = useFonts({ Anton_400Regular, Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold, Inter_800ExtraBold });

  // Screens copy the configuration into their fields: never show them before the Keychain has answered.
  const ready = fontsLoaded && config !== 'loading';

  // The native splash (same yellow, same W) gives way at once to the animated boot screen.
  useEffect(() => {
    void SplashScreen.hideAsync();
  }, []);
  useEffect(() => {
    if (ready && config === 'failed') Alert.alert('Configuration illisible', "Le Trousseau n'a pas répondu. Relance Waken avant de modifier un réglage, sinon ta configuration sera écrasée.");
  }, [ready, config]);
  // The boot screen stays until the network has answered once, 3 seconds at most: the home screen then opens full.
  const networkKnown = useNetwork((s) => s.status != null);
  const [waited, setWaited] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setWaited(true), 3000);
    return () => clearTimeout(timer);
  }, []);

  if (!ready) return <BootScreen ready={false} />;

  return (
    <>
    <QueryClientProvider client={queryClient}>
      <NetworkRunner />
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <Providers>
          <Stack screenOptions={{ headerShown: false, orientation: screenOrientation, contentStyle: { backgroundColor: colors.white } }}>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="game/[id]" />
            <Stack.Screen name="add" />
            <Stack.Screen name="edit/[id]" />
            <Stack.Screen name="wake/[id]" options={{ presentation: 'fullScreenModal', animation: 'fade' }} />
            <Stack.Screen name="stream/[id]" options={{ presentation: 'fullScreenModal', animation: 'fade', orientation: 'landscape' }} />
          </Stack>
          <AccountOverlay />
        </Providers>
      </SafeAreaProvider>
    </QueryClientProvider>
    <BootScreen ready={networkKnown || waited} />
    </>
  );
}
