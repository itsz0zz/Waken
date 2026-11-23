import { ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, DeviceCard, fonts, type } from '@waken/ui';
import type { Device, WakeMethod } from '@waken/core';
import { useWaken } from '../../src/store';
import { useDeviceStatus } from '../../src/hooks';

const wakeLabel: Record<WakeMethod['type'], string> = {
  'homelab-relay': 'Réveil : relais homelab (Wake-on-LAN)',
  'shelly-cloud': 'Réveil : prise Shelly',
  playstation: 'Réveil : Remote Play',
  none: 'Toujours allumé',
};

export default function Devices() {
  const insets = useSafeAreaInsets();
  const devices = useWaken((s) => s.devices);
  return (
    <ScrollView style={{ backgroundColor: colors.bg0 }} contentContainerStyle={{ paddingTop: insets.top + 16, paddingHorizontal: 18, paddingBottom: insets.bottom + 110, gap: 20, maxWidth: 700, width: '100%', alignSelf: 'center' }}>
      <Text style={{ fontFamily: fonts.display, fontSize: 28, color: colors.ink }}>Appareils</Text>
      {devices.map((d) => (
        <Row key={d.id} device={d} />
      ))}
    </ScrollView>
  );
}

function Row({ device }: { device: Device }) {
  const router = useRouter();
  const status = useDeviceStatus(device);
  return (
    <View style={{ gap: 6 }}>
      <DeviceCard kind={device.kind} name={device.name} status={status} detail={device.detail} onPress={() => router.push(device.kind === 'homelab' ? '/settings' : `/edit/${device.id}`)} />
      <Text style={[type.caption, { color: colors.ink2, paddingHorizontal: 6 }]}>
        {wakeLabel[device.wake.type]}
        {device.stream ? ` · ${device.stream.host}` : ''}
      </Text>
    </View>
  );
}
