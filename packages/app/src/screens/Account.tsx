import { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform as RNPlatform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { AppMark, Card, colors, Display, FadeIn, Field, fonts, PillButton, PlatformIcon, PressScale, ScreenGround, Segmented, type } from '@waken/ui';
import { setNetworkMode, signInAccount, signInWithAppleAccount, useNeedsAccount } from '../account';
import { platform } from '../platform';
import { useFrame } from '../nav';

type Mode = 'signin' | 'create';

/**
 * Laid over the whole app while this device has no Waken account. Over, not instead: the navigation
 * underneath stays mounted (expo-router wants its stack there from the first render).
 */
export function AccountOverlay() {
  if (!useNeedsAccount()) return null;
  return (
    <View style={[StyleSheet.absoluteFill, { zIndex: 50 }]}>
      <AccountScreen />
    </View>
  );
}

/**
 * One account for every device: sign in here and the computers signed in with it appear on their own.
 * Nobody else's computer can: the network only connects the devices of the same account.
 */
export function AccountScreen() {
  const { wide } = useFrame();
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [appleBusy, setAppleBusy] = useState(false);
  const creating = mode === 'create';
  const ready = /.+@.+\..+/.test(email.trim()) && password.length >= (creating ? 10 : 1);

  const submit = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      await signInAccount(email, password, creating);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <ScreenGround ground="sun" />
      <KeyboardAvoidingView behavior={RNPlatform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 24 }} keyboardShouldPersistTaps="handled">
          <FadeIn style={{ width: '100%', maxWidth: 440, alignSelf: 'center', gap: 18 }}>
            <View style={{ alignItems: 'center', gap: 8 }}>
              <AppMark size={wide ? 96 : 80} />
              <Display size={wide ? 96 : 72}>{creating ? 'Bienvenue' : 'Salut !'}</Display>
              <Text style={[type.body, { color: colors.ink2, textAlign: 'center' }]}>
                {creating
                  ? 'Un compte pour toutes tes machines. Connecte ensuite ton Mac ou ton PC avec le même : tes jeux arrivent ici.'
                  : 'Connecte-toi : tes machines arrivent toutes seules, et personne d’autre ne peut les joindre.'}
              </Text>
            </View>
            {platform().appleSignIn ? (
              <>
                <AppleButton
                  busy={appleBusy}
                  onPress={async () => {
                    setAppleBusy(true);
                    setError(null);
                    try {
                      await signInWithAppleAccount();
                    } catch (e) {
                      setError(e instanceof Error ? e.message : String(e));
                    } finally {
                      setAppleBusy(false);
                    }
                  }}
                />
                <Text style={[type.caption, { color: colors.ink2, textAlign: 'center' }]}>ou avec ton e-mail</Text>
              </>
            ) : null}
            <Card lifted style={{ gap: 12 }}>
              <Segmented<Mode>
                label="Compte"
                value={mode}
                options={[
                  { id: 'signin', label: 'Se connecter' },
                  { id: 'create', label: 'Créer un compte' },
                ]}
                onChange={(m) => {
                  setMode(m);
                  setError(null);
                }}
              />
              <Field
                label="E-mail"
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                textContentType="emailAddress"
                autoComplete="email"
                placeholder="toi@exemple.fr"
                returnKeyType="next"
              />
              <Field
                label="Mot de passe"
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                textContentType={creating ? 'newPassword' : 'password'}
                autoComplete={creating ? 'new-password' : 'current-password'}
                hint={creating ? 'Au moins 10 caractères. Une phrase marche très bien.' : undefined}
                returnKeyType="go"
                onSubmitEditing={() => void submit()}
              />
              {error ? <Text style={[type.caption, { color: colors.danger }]}>{error}</Text> : null}
              <PillButton label={creating ? 'Créer mon compte' : 'Se connecter'} size="lg" loading={busy} disabled={!ready || busy} onPress={() => void submit()} />
            </Card>
            <PillButton label="Utiliser Tailscale à la place" variant="ghost" size="sm" onPress={() => setNetworkMode('tailscale')} />
          </FadeIn>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

/**
 * Apple's button as its guidelines draw it: black, Apple's logo, "Continuer avec Apple", as tall as the other
 * actions. Drawn here (one look on iPhone and Mac) rather than the native one.
 */
function AppleButton({ onPress, busy }: { onPress: () => void; busy: boolean }) {
  return (
    <PressScale
      onPress={busy ? undefined : onPress}
      accessibilityRole="button"
      accessibilityLabel="Continuer avec Apple"
      style={{ height: 56, borderRadius: 999, backgroundColor: colors.ink, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 }}
    >
      {busy ? <ActivityIndicator color={colors.white} /> : <PlatformIcon platform="mac" size={20} color={colors.white} />}
      <Text style={{ fontFamily: fonts.bold, fontSize: 17, color: colors.white }}>Continuer avec Apple</Text>
    </PressScale>
  );
}
