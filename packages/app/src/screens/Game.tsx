import { useEffect, useState } from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Copy, Flame, Gauge, Play, Power, Wifi, WifiOff } from 'lucide-react-native';
import { canWake } from '@waken/core';
import { AppMark, Art, Card, colors, Display, IconBubble, PillButton, PlatformIcon, shadows, StatusTag, TiltedArt, type } from '@waken/ui';
import { formatPlayTime, useDeviceStatus, useGame, useGameArt, useHostStats } from '../hooks';
import { useFrame, useNav } from '../nav';
import { platform } from '../platform';
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
  const hero = useGameArt(game, 'hero');
  const machine = useMachineOf(game);
  const status = useDeviceStatus(machine.device);
  const node = useHostNode(machine.device);
  const totals = useHostStats(machine.device);
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
      {totals?.streakDays ? <Stat icon={Flame} color={colors.hot} value={`${totals.streakDays} ${totals.streakDays > 1 ? 'jours' : 'jour'}`} caption="de suite" /> : null}
      {last ? <Stat icon={Play} color={colors.ink} value={last.charAt(0).toUpperCase() + last.slice(1)} caption="dernière partie" /> : null}
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
      {/* Real figures once the game has been played, like the mockups; the store and "Neuf" before that. */}
      {game.playSeconds
        ? figure(formatPlayTime(game.playSeconds), 'de jeu', 'left')
        : figure(game.store ?? 'Perso', game.store ? 'boutique' : 'ajouté à la main', 'left')}
      {game.sessions
        ? figure(String(game.sessions), game.sessions > 1 ? 'parties' : 'partie', 'right')
        : figure(last ? last.replace("aujourd'hui", 'auj.') : 'Neuf', last ? 'dernière partie' : 'jamais lancé', 'right')}
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
      {machine.device?.local ? null : <WifiAdvice />}
    </View>
  );

  // The game's own banner behind the whole page, blurred and light: its colours without any edge to hide.
  // A white veil rather than the image's own opacity: the Mac draws a blurred image at full strength whatever its
  // opacity, and a dark banner then left the black text unreadable.
  const backdrop = hero ? (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Art source={hero} blur={wide ? 30 : 20} style={StyleSheet.absoluteFill} />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(255,255,255,0.68)' }]} />
    </View>
  ) : null;

  return (
    <Screen ground="sky" maxWidth={wide ? 1100 : 600} backdrop={backdrop}>
      <BackHeader title={wide ? undefined : machine.name} />
      {wide ? (
        <View style={{ flexDirection: 'row', gap: 48, marginTop: 20 }}>
          <View style={{ flex: 1, gap: 20 }}>
            <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
              <PlatformIcon platform={machine.platform} size={26} />
              <Text numberOfLines={1} style={[type.headline, { fontSize: 20, color: colors.ink, flexShrink: 1 }]}>
                {machine.name}
              </Text>
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
          <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center', marginTop: 12 }}>
            <PlatformIcon platform={machine.platform} size={26} />
            <Text numberOfLines={1} style={[type.headline, { fontSize: 20, color: colors.ink, flexShrink: 1 }]}>
              {machine.name}
            </Text>
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

const AWDL_OFF = 'sudo ifconfig awdl0 down';

/**
 * The Mac on Wi-Fi with AWDL up: its scans for AirDrop and Handoff take the radio away several times a second, and
 * the stream stutters. Turning it off needs an administrator command, so the app says how, as Parsec does.
 */
function WifiAdvice() {
  const { wifiInfo, copyText } = platform();
  const [shown, setShown] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!wifiInfo) return;
    let alive = true;
    const check = () =>
      void wifiInfo()
        .then((info) => alive && setShown(info.wifi && info.awdl))
        .catch(() => {});
    check();
    const timer = setInterval(check, 5000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [wifiInfo]);
  if (!shown) return null;
  return (
    <Card style={{ gap: 8, padding: 16 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <IconBubble icon={Wifi} color={colors.hot} size={34} />
        <Text style={[type.label, { flex: 1, color: colors.ink }]}>En Wi-Fi, AirDrop peut faire saccader l'image</Text>
      </View>
      <Text style={[type.caption, { color: colors.ink2 }]}>
        Pour une partie fluide, lance cette commande dans le Terminal avant de jouer. AirDrop et Handoff reviennent au
        prochain redémarrage. Un câble évite tout ça.
      </Text>
      <Text selectable style={{ fontFamily: 'Menlo', fontSize: 13, color: colors.ink }}>
        {AWDL_OFF}
      </Text>
      {copyText ? (
        <PillButton
          label={copied ? 'Copiée' : 'Copier la commande'}
          icon={Copy}
          variant="white"
          size="sm"
          onPress={() => void copyText(AWDL_OFF).then(() => setCopied(true))}
        />
      ) : null}
    </Card>
  );
}

