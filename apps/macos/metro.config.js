// Metro for the macOS app, in the pnpm monorepo.
// The shared packages (@waken/app, ui, core) must use THIS app's React and React Native (0.83, macOS),
// never the iPhone app's (0.88): every singleton is resolved from here, and react-native is react-native-macos.
const fs = require('fs');
const path = require('path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

const appRoot = __dirname;
const repoRoot = path.resolve(appRoot, '../..');
// By folder, not require.resolve: some packages (lucide) do not export their package.json.
const fromApp = (name) => fs.realpathSync(path.join(appRoot, 'node_modules', name));
const singletons = {
  react: fromApp('react'),
  'react-native': fromApp('react-native-macos'),
  'react-native-svg': fromApp('react-native-svg'),
  'lucide-react-native': fromApp('lucide-react-native'),
  '@tanstack/react-query': fromApp('@tanstack/react-query'),
  zustand: fromApp('zustand'),
  // Injected by Babel into every file, the shared packages' too.
  '@babel/runtime': fromApp('@babel/runtime'),
};

module.exports = mergeConfig(getDefaultConfig(appRoot), {
  watchFolders: [repoRoot],
  // The default config starts React Native from the plain react-native package: start react-native-macos instead,
  // or the app runs on one copy initialised by another ("Cannot read property 'now' of undefined").
  serializer: {
    getModulesRunBeforeMainModule: () => [path.join(singletons['react-native'], 'Libraries/Core/InitializeCore.js')],
    getPolyfills: () => require(path.join(singletons['react-native'], 'rn-get-polyfills.js'))(),
  },
  resolver: {
    platforms: ['macos', 'ios', 'native'],
    nodeModulesPaths: [path.join(appRoot, 'node_modules'), path.join(repoRoot, 'node_modules')],
    unstable_enableSymlinks: true,
    resolveRequest: (context, moduleName, platform) => {
      const root = Object.keys(singletons).find((name) => moduleName === name || moduleName.startsWith(`${name}/`));
      if (root) {
        const target = singletons[root] + moduleName.slice(root.length);
        return context.resolveRequest({ ...context, originModulePath: path.join(appRoot, 'index.js') }, target, platform);
      }
      return context.resolveRequest(context, moduleName, platform);
    },
  },
});
