import { AppRegistry } from 'react-native';
import { catchFatalErrors, CrashBoundary, CrashScreen } from './src/Crash';

catchFatalErrors();

// Loaded here, not imported: an error while the app's modules load shows on screen instead of closing Waken.
let App;
try {
  App = require('./src/App').default;
} catch (error) {
  App = () => <CrashScreen error={error} />;
}

AppRegistry.registerComponent('Waken', () => () => (
  <CrashBoundary>
    <App />
  </CrashBoundary>
));
