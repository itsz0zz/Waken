import { Text, View, useWindowDimensions } from 'react-native';
import { Gauge, Play, Power, Wifi, WifiOff } from 'lucide-react-native';
import { canWake } from '@waken/core';
import { AppMark, colors, Display, IconBubble, MachineChip, PillButton, shadows, StatusTag, TiltedArt, type } from '@waken/ui';
import { useDeviceStatus, useGame, useGameArt } from '../hooks';
import { useFrame, useNav } from '../nav';
import { useHostNode } from '../network';
import { qualities, qualityOf } from '../quality';
import { useWaken } from '../store';
import { BackHeader, sinceLabel, useMachineOf } from './parts';
import { Screen } from './Screen';

/** A game: its cover, where it runs, how good the connection is, and the big button. */
export function GameScreen({ gameId }: { gameId: string }) {
  const nav = useNav();
  const { wide } = useFrame();
  const game = useGame(gameId);
  const cover = useGameArt(game, 'cover');
  const machine = useMachineOf(game);
  const status = useDeviceStatus(machine.device);
  const node = useHostNode(machine.device);
  const stream = useWaken((s) => s.settings.stream);
  const { width } = useWindowDimensions();
  if (!game) {
    return (
      <Screen ground="sky">
        <BackHeader />
        <Text style={[type.title, { color: colors.ink, textAlign: 'center', marginTop: 60 }]}>Ce jeu n'est plus sur ta machine.</Text>
      </Screen>
    );
  }

  const ready = status === 'online';
  const wakeable = machine.device ? canWake(machine.device) : false;
  const last = sinceLabel(game.lastPlayedAt);
  const play = () => nav.play(game.deviceId, game.id, game.sunshineApp);

  const stats = (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14 }}>
      <Stat
        icon={node && !node.direct ? WifiOff : Wifi}
        color={!node ? colors.muted : node.direct ? colors.online : colors.hot}
        value={!node ? 'Connexion' : node.direct ? 'Excellente' : 'Relayée'}
        caption={!node ? 'à vérifier' : node.direct ? 'connexion' : 'image en 720p'}
      />
      <Stat icon={Gauge} color={colors.blue} value={qualities[qualityOf(stream)].label} caption={`${stream.height}p · ${stream.fps} i/s`} />
    </View>
  );

  // The two side figures share what the cover leaves of the row: long words shrink instead of running under it.
  const coverWidth = wide ? 240 : 170;
  const side = Math.max(70, ((wide ? 520 : Math.min(width, 600) - 40) - coverWidth) / 2 - 8);
  const figure = (value: string, caption: string, align: 'left' | 'right') => (
    <View style={{ position: 'absolute', top: 30, width: side, [align]: 0, alignItems: align === 'left' ? 'flex-start' : 'flex-end' }}>
      <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.5} style={[type.display, { fontSize: 50, lineHeight: 62, color: colors.ink, textAlign: align }]}>
        {value}
      </Text>
      <Text numberOfLines={2} style={[type.label, { fontSize: 14, color: colors.ink, textAlign: align }]}>
        {caption}
      </Text>
    </View>
  );

  const big = (
    <View style={{ height: wide ? 360 : 246 }}>
      {figure(game.store ?? 'Perso', game.store ? 'boutique' : 'ajouté à la main', 'left')}
      {figure(last ? last.replace("aujourd'hui", 'auj.') : 'Neuf', last ? 'dernière partie' : 'jamais lancé', 'right')}
      <View style={{ position: 'absolute', left: '50%', marginLeft: wide ? -120 : -85, top: 4 }}>
        <TiltedArt source={cover} title={game.title} width={wide ? 240 : 170} height={wide ? 320 : 226} rotate={-4} border={7} rounded={28} />
      </View>
      <View style={{ position: 'absolute', left: '50%', marginLeft: wide ? 90 : 38, top: wide ? 250 : 168, transform: [{ rotate: '10deg' }], ...shadows.lift }}>
        <AppMark size={62} />
      </View>
    </View>
  );

  const actions = (
    <View style={{ gap: 10 }}>
      <PillButton label={ready || !wakeable ? 'Jouer' : 'Réveiller et jouer'} icon={ready || !wakeable ? Play : Power} size="lg" onPress={play} />
      {wakeable && !ready ? <PillButton label="Réveiller seulement" variant="ghost" onPress={() => nav.wakeOnly(game.deviceId)} /> : null}
    </View>
  );

  return (
    <Screen ground="sky" maxWidth={wide ? 1100 : 600}>
      <BackHeader title={wide ? undefined : machine.name} />
      {wide ? (
        <View style={{ flexDirection: 'row', gap: 48, marginTop: 20 }}>
          <View style={{ flex: 1, gap: 20 }}>
            <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
              <MachineChip name={machine.name} icon={machine.icon} big />
              <StatusTag status={status} />
            </View>
            <Display size={game.title.length <= 10 ? 110 : 80} align="left" numberOfLines={2}>
              {game.title}
            </Display>
            {stats}
            {actions}
          </View>
          <View style={{ flex: 1 }}>{big}</View>
        </View>
      ) : (
        <>
          <Display size={game.title.length <= 8 ? 100 : game.title.length <= 14 ? 64 : 52} numberOfLines={2} style={{ marginTop: 16 }}>
            {game.title}
          </Display>
          <View style={{ marginTop: -6 }}>{big}</View>
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', marginTop: 12 }}>
            <MachineChip name={machine.name} icon={machine.icon} big />
            <StatusTag status={status} />
          </View>
          <View style={{ marginTop: 18 }}>{stats}</View>
          <View style={{ marginTop: 22 }}>{actions}</View>
        </>
      )}
    </Screen>
  );
}

function Stat({ icon, color, value, caption }: { icon: typeof Wifi; color: string; value: string; caption: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minWidth: 150 }}>
      <IconBubble icon={icon} color={color} />
      <View>
        <Text style={[type.headline, { color: colors.ink }]}>{value}</Text>
        <Text style={[type.caption, { color: colors.ink2, fontWeight: '500' }]}>{caption}</Text>
      </View>
    </View>
  );
}
