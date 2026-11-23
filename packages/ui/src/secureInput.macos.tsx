import { useRef } from 'react';
import { TextInput, type TextInputProps } from 'react-native';
import { applyMaskedEdit, MASK } from '@waken/core';

/**
 * macOS: React Native macOS's secure field (NSSecureTextField) crashes the app as soon as it takes the focus on
 * macOS 27. A plain field showing dots instead: the real text stays in the caller's state, each edit made on the
 * dots is replayed on it (applyMaskedEdit).
 */
export function SecureTextInput({ secureTextEntry, value, onChangeText, onSelectionChange, ...rest }: TextInputProps) {
  const selection = useRef({ start: (value ?? '').length, end: (value ?? '').length });
  if (!secureTextEntry) return <TextInput value={value} onChangeText={onChangeText} onSelectionChange={onSelectionChange} {...rest} />;
  const real = value ?? '';
  return (
    <TextInput
      {...rest}
      value={MASK.repeat(real.length)}
      onChangeText={(shown) => {
        const edit = applyMaskedEdit(real, shown, selection.current);
        selection.current = edit.selection;
        onChangeText?.(edit.text);
      }}
      onSelectionChange={(e) => {
        selection.current = e.nativeEvent.selection;
        onSelectionChange?.(e);
      }}
      autoCorrect={false}
      autoCapitalize="none"
      spellCheck={false}
      contextMenuHidden
    />
  );
}
