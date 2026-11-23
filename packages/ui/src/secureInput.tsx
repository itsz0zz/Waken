import { TextInput, type TextInputProps } from 'react-native';

/** A text input; a password one when secureTextEntry is set (the platform's own secure field). */
export function SecureTextInput(props: TextInputProps) {
  return <TextInput {...props} />;
}
