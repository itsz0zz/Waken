import { Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import { colors, type } from '@waken/ui';

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 10 }}>
      <Text style={[type.overline, { color: colors.ink2 }]}>{title.toUpperCase()}</Text>
      {children}
    </View>
  );
}

export function Field({ label, hint, ...rest }: TextInputProps & { label: string; hint?: string }) {
  return (
    <View style={styles.field}>
      <Text style={[type.caption, { color: colors.ink2 }]}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={colors.ink3}
        autoCapitalize="none"
        autoCorrect={false}
        style={[type.body, { color: colors.ink, paddingVertical: 4 }]}
        {...rest}
      />
      {hint ? <Text style={[type.caption, { color: colors.ink3 }]}>{hint}</Text> : null}
    </View>
  );
}

export function Choice({ label, hint, selected, onPress }: { label: string; hint: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="radio" accessibilityState={{ selected }} style={[styles.field, selected && { borderColor: colors.neon }]}>
      <Text style={[type.headline, { color: colors.ink, fontSize: 15 }]}>{label}</Text>
      <Text style={[type.caption, { color: colors.ink2 }]}>{hint}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  field: { padding: 14, borderRadius: 18, backgroundColor: colors.bg2, borderWidth: 1, borderColor: colors.line, gap: 4 },
});
