import { Component, useEffect, useState, type ReactNode } from 'react';
import { ScrollView, Text, View } from 'react-native';

/**
 * In a Release build, React Native closes the app on any uncaught JavaScript error, without a word. Here the
 * error shows instead, as text that can be selected and copied. Plain React Native only: this screen must not
 * depend on the code that may have failed.
 */

type Listener = (error: unknown) => void;
const listeners = new Set<Listener>();
let fatal: unknown;

declare const ErrorUtils: {
  getGlobalHandler(): (error: unknown, isFatal?: boolean) => void;
  setGlobalHandler(handler: (error: unknown, isFatal?: boolean) => void): void;
};

/** Errors thrown outside rendering (timers, callbacks): shown on the crash screen rather than closing the app. */
export function catchFatalErrors() {
  const previous = ErrorUtils.getGlobalHandler();
  ErrorUtils.setGlobalHandler((error, isFatal) => {
    if (!isFatal) return previous(error, isFatal);
    fatal = error;
    listeners.forEach((l) => l(error));
  });
}

function describe(error: unknown) {
  if (error instanceof Error) return `${error.name}: ${error.message}\n\n${error.stack ?? ''}`;
  return String(error);
}

export function CrashScreen({ error }: { error: unknown }) {
  return (
    <View style={{ flex: 1, backgroundColor: '#0B0B0F', padding: 32, gap: 16 }}>
      <Text style={{ color: '#FFFFFF', fontSize: 24, fontWeight: '700' }}>Waken a rencontré une erreur</Text>
      <Text style={{ color: '#B8B8C4', fontSize: 14 }}>Sélectionne le texte ci-dessous et colle-le à Claude.</Text>
      <ScrollView style={{ flex: 1 }}>
        <Text selectable style={{ color: '#FFFFFF', fontFamily: 'Consolas', fontSize: 13 }}>
          {describe(error)}
        </Text>
      </ScrollView>
    </View>
  );
}

/** Rendering errors, and the fatal ones caught above: the crash screen replaces the app. */
export class CrashBoundary extends Component<{ children: ReactNode }, { error: unknown }> {
  state = { error: fatal };
  static getDerivedStateFromError(error: unknown) {
    return { error };
  }
  render() {
    return this.state.error !== undefined ? <CrashScreen error={this.state.error} /> : <FatalListener>{this.props.children}</FatalListener>;
  }
}

function FatalListener({ children }: { children: ReactNode }) {
  const [error, setError] = useState<unknown>(fatal);
  useEffect(() => {
    const listener: Listener = (e) => setError(() => e);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return error !== undefined ? <CrashScreen error={error} /> : <>{children}</>;
}
