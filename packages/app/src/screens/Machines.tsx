import { Text, View } from 'react-native';
import { Check, Gamepad2, Monitor, Play, Plus, Power } from 'lucide-react-native';
import { canWake, hostDisplayName, type Device } from '@waken/core';
import { AppMark, Art, Card, colors, Gradient, Display, FadeIn, IconBubble, machineIcon, PillButton, PressScale, shadows, stagger, StatusTag, type } from '@waken/ui';
import { useDeviceStatus, useGameArt, useLibrary } from '../hooks';
import { useFrame, useNav } from '../nav';
import { useNetwork } from '../network';
import { platform } from '../platform';
import { useWaken } from '../store';
import { BackHeader, PhoneHeader, sinceLabel } from './parts';
import { Screen } from './Screen';

/** "MACHINES": every computer, its state and the one action that makes sense now. */
export function MachinesScreen() {
  const nav = useNav();
  const { wide } = useFrame();
  const devices = useWaken((s) => s.devices);
  return (
    <Screen ground="lime" maxWidth={wide ? 1100 : 600}>
      <PhoneHeader />
      <Display size={wide ? 110 : 86} align={wide ? 'left' : 'center'} style={{ marginTop: 14 }}>
        {wide ? 'Tes machines' : 'Machines'}
      </Display>
      <View style={{ marginTop: 20, gap: 14, ...(wide ? { flexDirection: 'row', flexWrap: 'wrap' } : null) }}>
        {devices.map((d, i) => (
          <FadeIn key={d.id} delay={stagger(i)} style={wide ? { width: '48.5%' } : undefined}>
            <MachineCard device={d} />
          </FadeIn>
        ))}
        <PressScale
          onPress={nav.addMachine}
          hoverTo={1.015}
          accessibilityRole="button"
          accessibilityLabel="Ajouter une machine"
          style={[{ flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, borderRadius: 24, borderWidth: 2.5, borderStyle: 'dashed', borderColor: colors.ink, backgroundColor: colors.frostLight }, wide && { width: '48.5%' }]}
        >
          <IconBubble icon={Plus} color={colors.ink} />
          <View style={{ flex: 1 }}>
            <Text style={[type.headline, { color: colors.ink }]}>Ajouter une machine</Text>
            <Text style={[type.caption, { color: colors.ink2 }]}>Mac ou PC avec Waken</Text>
          </View>
        </PressScale>
      </View>
    </Screen>
  );
}

function MachineCard({ device }: { device: Device }) {
  const nav = useNav();
  const status = useDeviceStatus(device);
  const { games } = useLibrary();
  const last = games.filter((g) => g.deviceId === device.id && g.lastPlayedAt)[0];
  const Icon = machineIcon(device.kind, device.detail);
  const ready = status === 'online';
  const wakeable = canWake(device);
  const banner = useGameArt(last ?? games.find((g) => g.deviceId === device.id && g.art), 'hero');
  return (
    <Card style={{ gap: 14, padding: 18, overflow: 'hidden' }}>
      {/* The machine's last game as its banner: a machine is what you play on it. */}
      {banner ? (
        <View style={{ height: 96, marginTop: -18, marginHorizontal: -18, marginBottom: -4 }}>
          <Art source={banner} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />
          <Gradient colors={['rgba(255,255,255,0)', 'rgba(255,255,255,1)']} locations={[0.35, 1]} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />
        </View>
      ) : null}
      <PressScale hoverTo={1.015} onPress={nav.machine ? () => nav.machine!(device.id) : undefined} accessibilityRole="button" accessibilityLabel={device.name} style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <IconBubble icon={Icon} color={device.kind === 'playstation' ? colors.blue : colors.violet} size={52} />
        <View style={{ flex: 1, minWidth: 0, gap: 6 }}>
          <Text numberOfLines={1} style={[type.headline, { fontSize: 20, color: colors.ink }]}>
            {device.name}
          </Text>
          <StatusTag status={status} style={{ alignSelf: 'flex-start' }} />
        </View>
      </PressScale>
      {last ? <Text style={[type.caption, { color: colors.ink2 }]}>Dernière partie : {last.title}, {sinceLabel(last.lastPlayedAt)}.</Text> : null}
      {device.kind === 'pc' && !device.local && device.stream ? (
        <Text style={[type.caption, { color: wakeable ? colors.ink2 : colors.danger }]}>{wakeSummary(device)}</Text>
      ) : null}
      {device.local ? (
        <Text style={[type.caption, { color: colors.ink2 }]}>
          {`Ce ${platform().deviceName ?? 'appareil'} : tes autres appareils peuvent y jouer. Ses jeux se lancent depuis l'onglet Jeux.`}
        </Text>
      ) : device.kind === 'playstation' ? (
        <PillButton label="Jouer" icon={Play} size="md" onPress={() => nav.play(device.id)} />
      ) : !device.stream ? null : ready || !wakeable ? (
        <PillButton label="Jouer au bureau" icon={Play} size="md" onPress={() => nav.play(device.id)} />
      ) : (
        <PillButton label="Allumer" icon={Power} size="md" onPress={() => nav.wakeOnly(device.id)} />
      )}
    </Card>
  );
}

/** How this computer is woken, in a line under its name; what is missing when it cannot be yet. */
function wakeSummary(device: Device): string {
  switch (device.wake.type) {
    case 'wake-on-lan':
      return device.wake.publicAddress ? 'Réveil par le réseau, chez toi et depuis Internet.' : 'Réveil par le réseau, chez toi.';
    case 'shelly-cloud':
      return 'Réveil par la prise connectée.';
    case 'homelab-relay':
      return 'Réveil par le relais du homelab.';
    default:
      return `Pas encore de réveil à distance : ouvre Waken une fois sur ${device.name}.`;
  }
}

/** "AJOUTER": machines come by themselves through the Waken network; this screen says how. */
export function AddMachineScreen() {
  const nav = useNav();
  const status = useNetwork((s) => s.status);
  const devices = useWaken((s) => s.devices);
  const self = status?.self?.name;
  const hosts = (status?.hosts ?? []).filter((h) => h.name !== self);
  return (
    <Screen ground="sky" maxWidth={600}>
      <BackHeader title="Ajouter" />
      <Display size={78} style={{ marginTop: 18 }}>
        Nouvelle machine
      </Display>
      <Card lifted style={{ marginTop: 22, gap: 12 }}>
        <Text style={[type.label, { color: colors.ink }]}>Machines trouvées</Text>
        {status?.state !== 'running' ? (
          <Text style={[type.body, { color: colors.ink2 }]}>{status?.state === 'needs-login' ? "Connecte d'abord cet appareil, depuis l'accueil." : 'Recherche…'}</Text>
        ) : hosts.length === 0 ? (
          <Text style={[type.body, { color: colors.ink2 }]}>Aucune pour l'instant.</Text>
        ) : (
          hosts.map((h) => {
            const added = devices.some((d) => d.stream?.tunnelHost === h.name);
            return (
              <View key={h.name} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <IconBubble icon={Monitor} color={h.online ? colors.violet : colors.muted} />
                <View style={{ flex: 1 }}>
                  <Text style={[type.headline, { color: colors.ink, textTransform: 'capitalize' }]}>{hostDisplayName(h.name)}</Text>
                  <Text style={[type.caption, { color: colors.ink2 }]}>{h.online ? 'Waken ouvert' : 'Hors ligne'}</Text>
                </View>
                {added ? <IconBubble icon={Check} color={colors.online} size={32} /> : <Text style={[type.caption, { color: colors.ink2 }]}>Arrive…</Text>}
              </View>
            );
          })
        )}
      </Card>
      {platform().playstation ? (
        <Card lifted style={{ marginTop: 16, gap: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <IconBubble icon={Gamepad2} color={colors.blue} />
            <View style={{ flex: 1 }}>
              <Text style={[type.headline, { color: colors.ink }]}>PS5 ou PS4</Text>
              <Text style={[type.caption, { color: colors.ink2 }]}>Liée une fois avec ton compte PlayStation et son code.</Text>
            </View>
            <PillButton label="Ajouter" size="sm" onPress={nav.addPlayStation} />
          </View>
        </Card>
      ) : null}
      <View style={{ flexDirection: 'row', gap: 14, alignItems: 'center', marginTop: 22, padding: 16, borderRadius: 24, backgroundColor: colors.white, ...shadows.card }}>
        <AppMark size={48} />
        <Text style={[type.body, { flex: 1, color: colors.ink }]}>
          Ton ordinateur n'apparaît pas&nbsp;? Installe Waken dessus et connecte-toi avec le même compte. Il arrivera ici tout seul.
        </Text>
      </View>
    </Screen>
  );
}
