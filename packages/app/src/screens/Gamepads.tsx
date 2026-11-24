import { Text, View } from 'react-native';
import { BatteryCharging, BatteryMedium, Gamepad2, Move3d, Vibrate } from 'lucide-react-native';
import { Card, colors, IconBubble, PillButton, Segmented, SettingRow, type } from '@waken/ui';
import { defaultGamepadOptions, useGamepadOptions, useGamepads, type GamepadInfo, type GamepadOptions } from '../gamepads';
import { useFrame } from '../nav';
import { platform } from '../platform';
import { useWaken } from '../store';
import { BackHeader } from './parts';
import { Screen } from './Screen';

const kindLabels: Record<GamepadInfo['kind'], string> = { xbox: 'Xbox', playstation: 'PlayStation', nintendo: 'Nintendo', other: 'Manette' };

type Strength = 'off' | 'low' | 'normal' | 'strong';
const strengths: Record<Strength, { label: string; value: number }> = {
  off: { label: 'Aucune', value: 0 },
  low: { label: 'Faible', value: 0.35 },
  normal: { label: 'Normale', value: 0.7 },
  strong: { label: 'Forte', value: 1 },
};
const strengthOf = (rumble: number): Strength =>
  (Object.keys(strengths) as Strength[]).reduce((best, s) => (Math.abs(strengths[s].value - rumble) < Math.abs(strengths[best].value - rumble) ? s : best), 'strong');

/** The Manettes page: the controllers of this device, and how they behave in a stream. */
export function GamepadsScreen() {
  const { wide } = useFrame();
  return (
    <Screen ground="sun" maxWidth={wide ? 760 : 600}>
      <BackHeader title="Manettes" />
      <View style={{ marginTop: 20 }}>
        <GamepadsPanel />
      </View>
    </Screen>
  );
}

/** The page's content, also shown in the stream's menu. dark: on the stream's dark menu. */
export function GamepadsPanel({ dark = false }: { dark?: boolean }) {
  const api = platform().gamepads;
  const { data: pads } = useGamepads();
  const options = useGamepadOptions();
  const update = useWaken((s) => s.updateSettings);
  const set = (next: Partial<GamepadOptions>) => update({ gamepads: { ...defaultGamepadOptions, ...options, ...next } });

  if (!api) {
    return (
      <Card style={{ gap: 8 }}>
        <Text style={[type.label, { color: colors.ink }]}>Manettes</Text>
        <Text style={[type.caption, { color: colors.ink2 }]}>Cette version de l'app ne gère pas encore les manettes : mets-la à jour.</Text>
      </Card>
    );
  }

  return (
    <View style={{ gap: 16 }}>
      <Card style={{ gap: 12 }}>
        <Text style={[type.label, { color: colors.ink }]}>Connectées</Text>
        {pads?.length ? (
          pads.map((pad) => <PadRow key={pad.id} pad={pad} onTest={() => void api.test(pad.id)} />)
        ) : (
          <Text style={[type.caption, { color: colors.ink2 }]}>
            Aucune manette. Branche-la en USB, ou associe-la en Bluetooth dans les réglages de cet appareil : elle apparaît ici.
          </Text>
        )}
      </Card>

      <Card style={{ gap: 12 }}>
        <Text style={[type.label, { color: colors.ink }]}>Vibrations</Text>
        <Segmented<Strength>
          label="Force des vibrations"
          value={strengthOf(options.rumble)}
          options={(Object.keys(strengths) as Strength[]).map((id) => ({ id, label: strengths[id].label }))}
          onChange={(s) => set({ rumble: strengths[s].value })}
        />
        <SettingRow
          icon={Move3d}
          color={options.motion ? colors.online : colors.muted}
          label="Gyroscope"
          hint="Les mouvements de la manette (DualSense, DualShock, Switch) envoyés au jeu."
          value={options.motion}
          onValueChange={(motion) => set({ motion })}
        />
      </Card>

      <Card style={{ gap: 12 }}>
        <Text style={[type.label, { color: colors.ink }]}>Manette vue par la machine</Text>
        <Segmented<GamepadOptions['kind']>
          label="Manette vue par la machine"
          value={options.kind}
          options={[
            { id: 'auto', label: 'Comme branchée' },
            { id: 'xbox', label: 'Xbox' },
            { id: 'playstation', label: 'PlayStation' },
          ]}
          onChange={(kind) => set({ kind })}
        />
        <Text style={[type.caption, { color: colors.ink2 }]}>
          Sur un PC, la machine crée une manette Xbox ou PlayStation (pilote ViGEmBus). Un jeu qui ne reconnaît qu'un type : force-le ici. Un Mac qui
          sert de machine ne reçoit pas les manettes.
        </Text>
      </Card>
      {dark ? (
        <Text style={[type.caption, { color: colors.sky }]}>Le type de manette et le gyroscope valent pour la prochaine manette branchée ou le prochain stream.</Text>
      ) : null}
    </View>
  );
}

function PadRow({ pad, onTest }: { pad: GamepadInfo; onTest: () => void }) {
  const battery = pad.battery != null ? `${Math.round(pad.battery * 100)} %${pad.charging ? ', en charge' : ''}` : null;
  const features = [pad.rumble && 'vibrations', pad.motion && 'gyroscope', pad.touchpad && 'pavé tactile', pad.light && 'lumière'].filter(Boolean).join(', ');
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <IconBubble icon={Gamepad2} color={colors.online} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[type.label, { color: colors.ink }]} numberOfLines={1}>
          {pad.name}
        </Text>
        <Text style={[type.caption, { color: colors.ink2 }]} numberOfLines={2}>
          {kindLabels[pad.kind]}
          {features ? ` · ${features}` : ''}
        </Text>
        {battery ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 }}>
            {pad.charging ? <BatteryCharging size={14} color={colors.ink2} /> : <BatteryMedium size={14} color={colors.ink2} />}
            <Text style={[type.caption, { color: colors.ink2 }]}>{battery}</Text>
          </View>
        ) : null}
      </View>
      {pad.rumble ? <PillButton label="Tester" icon={Vibrate} size="sm" variant="white" onPress={onTest} /> : null}
    </View>
  );
}
