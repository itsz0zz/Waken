import { useEffect } from 'react';
import { Alert } from 'react-native';
import { platform, type UpdateStatus } from './platform';

/** Installs the newest version: the app quits, the update goes in, Waken starts again. Errors in an alert. */
export async function installUpdate(): Promise<void> {
  try {
    await platform().updates!.install();
  } catch (e) {
    Alert.alert('Mise à jour', e instanceof Error ? e.message : String(e));
  }
}

/** The text that says where this app stands. */
export function updateHint(s: UpdateStatus | undefined): string {
  if (!s) return 'Recherche d’une mise à jour…';
  if (s.available) return `La version ${s.available} est disponible.`;
  if (s.error) return `Pas de réponse de GitHub : ${s.error}`;
  return 'Waken est à jour.';
}

/**
 * Once per launch, a little after the start: a newer release on GitHub is offered (install now, or later from the
 * Réglages). Nothing on an app that cannot update (a build started from its folder, the MSIX).
 */
export function useUpdateOffer() {
  useEffect(() => {
    const updates = platform().updates;
    if (!updates) return;
    const timer = setTimeout(async () => {
      const s = await updates.status(true).catch(() => undefined);
      if (!s?.supported || !s.available) return;
      Alert.alert('Mise à jour', `Waken ${s.available} est disponible (tu as la ${s.version}).`, [
        { text: 'Plus tard', style: 'cancel' },
        { text: 'Installer et redémarrer', onPress: () => void installUpdate() },
      ]);
    }, 8_000);
    return () => clearTimeout(timer);
  }, []);
}
