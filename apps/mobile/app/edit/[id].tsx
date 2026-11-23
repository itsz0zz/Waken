import { useLocalSearchParams } from 'expo-router';
import { MachineEditScreen } from '@waken/app';

export default function Edit() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <MachineEditScreen deviceId={id} />;
}
