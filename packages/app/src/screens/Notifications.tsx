import { useEffect } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Bell, Flame, Monitor, Smartphone, X } from 'lucide-react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { create } from 'zustand';
import type { CloudNotification } from '@waken/core';
import { colors, FadeIn, fonts, IconBubble, PressScale, RoundButton, shadows, type } from '@waken/ui';
import { cloud, useAccount } from '../account';
import { useNav } from '../nav';
import { platform } from '../platform';

/** The notifications panel, opened from the bell. */
export const useNotificationsPanel = create<{ open: boolean }>(() => ({ open: false }));

/** The account's notifications, asked again every minute while the app is open. */
export function useNotifications() {
  const signedIn = useAccount((s) => s.mode === 'account' && s.session !== null);
  const email = useAccount((s) => s.email);
  const query = useQuery({
    queryKey: ['notifications', email],
    queryFn: () => cloud().notifications(),
    enabled: signedIn,
    refetchInterval: 60_000,
  });
  const items = query.data ?? [];
  return { items, unread: items.filter((n) => !n.read).length, loading: query.isLoading, error: query.error as Error | null };
}

/** "EB" for enzo.barreiro@…, "W" when there is nothing to go on. */
export function initials(email?: string) {
  const name = (email ?? '').split('@')[0];
  const parts = name.split(/[._\-+]+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0][0] + parts[1][0] : name.slice(0, 2);
  return (letters || 'W').toUpperCase();
}

/**
 * Top right of every main screen, like the Arcade mockups: the bell with the unread count, and the account's
 * avatar (to the settings). Nothing when the device runs without an account (Tailscale).
 */
export function AccountButtons() {
  const nav = useNav();
  const signedIn = useAccount((s) => s.mode === 'account' && s.session !== null);
  const email = useAccount((s) => s.email);
  const { unread } = useNotifications();
  if (!signedIn) return null;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <RoundButton
        icon={Bell}
        label={unread ? `Notifications, ${unread} non lues` : 'Notifications'}
        badge={unread || undefined}
        onPress={() => useNotificationsPanel.setState({ open: true })}
      />
      <PressScale onPress={nav.settings} accessibilityRole="button" accessibilityLabel={`Compte ${email ?? ''}`} hoverTo={1.06} style={styles.avatar}>
        <Text style={styles.avatarText}>{initials(email)}</Text>
      </PressScale>
    </View>
  );
}

const icons = { device: Smartphone, machine: Monitor, session: Flame } as const;

function since(iso: string) {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return "à l'instant";
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `il y a ${hours} h`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'hier' : `il y a ${days} jours`;
}

/** Laid over the app when the bell is pressed: the latest notifications, marked read once seen. */
export function NotificationsOverlay() {
  const open = useNotificationsPanel((s) => s.open);
  const { items, loading, error, unread } = useNotifications();
  const queryClient = useQueryClient();
  const desktop = platform().form === 'desktop';
  const close = () => useNotificationsPanel.setState({ open: false });

  // Seen: read on the server, the badge goes.
  useEffect(() => {
    if (!open || unread === 0) return;
    void cloud()
      .markNotificationsRead()
      .then(() => queryClient.invalidateQueries({ queryKey: ['notifications'] }))
      .catch(() => {});
  }, [open, unread, queryClient]);

  if (!open) return null;
  return (
    <View style={[StyleSheet.absoluteFill, { zIndex: 40 }]}>
      <Pressable accessibilityLabel="Fermer les notifications" onPress={close} style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(11,11,15,0.28)' }]} />
      <FadeIn
        distance={-8}
        style={[styles.panel, desktop ? { position: 'absolute', top: 92, right: 32, width: 400 } : { position: 'absolute', top: 56, left: 14, right: 14 }]}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <Text style={[type.title, { fontSize: 22, color: colors.ink }]}>Notifications</Text>
          <RoundButton icon={X} label="Fermer" size={40} variant="white" onPress={close} />
        </View>
        <ScrollView style={{ maxHeight: desktop ? 480 : 520 }} contentContainerStyle={{ gap: 8 }}>
          {loading ? <Text style={[type.caption, { color: colors.ink2 }]}>Chargement…</Text> : null}
          {error ? <Text style={[type.caption, { color: colors.danger }]}>{error.message}</Text> : null}
          {!loading && !error && items.length === 0 ? (
            <View style={{ alignItems: 'center', gap: 8, paddingVertical: 24 }}>
              <IconBubble icon={Bell} color={colors.muted} size={44} />
              <Text style={[type.body, { color: colors.ink2, textAlign: 'center' }]}>Rien pour l'instant. Un nouvel appareil, une machine prête ou une partie finie s'affichera ici.</Text>
            </View>
          ) : null}
          {items.map((n) => (
            <NotificationRow key={n.id} item={n} />
          ))}
        </ScrollView>
      </FadeIn>
    </View>
  );
}

function NotificationRow({ item }: { item: CloudNotification }) {
  const Icon = icons[item.kind as keyof typeof icons] ?? Bell;
  return (
    <View style={[styles.row, !item.read && { backgroundColor: colors.soft }]}>
      <IconBubble icon={Icon} color={item.kind === 'device' ? colors.hot : item.kind === 'machine' ? colors.online : colors.blue} size={36} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[type.label, { color: colors.ink }]}>{item.title}</Text>
        <Text style={[type.caption, { color: colors.ink2 }]}>{item.body}</Text>
        <Text style={[type.caption, { color: colors.muted, fontSize: 12 }]}>{since(item.createdAt)}</Text>
      </View>
      {!item.read ? <View style={styles.dot} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  avatar: { width: 50, height: 50, borderRadius: 25, backgroundColor: colors.blue, borderWidth: 4, borderColor: colors.white, alignItems: 'center', justifyContent: 'center', ...shadows.card },
  avatarText: { fontFamily: fonts.heavy, fontSize: 15, color: colors.white },
  panel: { backgroundColor: colors.white, borderRadius: 28, padding: 16, ...shadows.lift },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: 12, borderRadius: 20 },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.blue, marginTop: 6 },
});
