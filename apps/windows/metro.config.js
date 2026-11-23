// Metro for the Windows app, in the pnpm monorepo.
// The shared packages (@waken/app, ui, core) must use THIS app's React and React Native (0.83, Windows),
// never the iPhone app's (0.88): every singleton is resolved from here, and react-native is react-native-windows.
const fs = require('fs');
const path = require('path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

const appRoot = __dirname;
const repoRoot = path.resolve(appRoot, '../..');
// By folder, not require.resolve: some packages (lucide) do not export their package.json.
const fromApp = (name) => fs.realpathSync(path.join(appRoot, 'node_modules', name));
const rnwPath = fromApp('react-native-windows');
const singletons = {
  react: fromApp('react'),
  'react-native': rnwPath,
  'react-native-svg': fromApp('react-native-svg'),
  'lucide-react-native': fromApp('lucide-react-native'),
  '@tanstack/react-query': fromApp('@tanstack/react-query'),
  zustand: fromApp('zustand'),
  // Injected by Babel into every file, the shared packages' too.
  '@babel/runtime': fromApp('@babel/runtime'),
};
const escape = (p) => p.replace(/[/\\]/g, '/').replace(/[.*+?^${}()|[\]]/g, '\\$&');

module.exports = mergeConfig(getDefaultConfig(appRoot), {
  watchFolders: [repoRoot],
  // Start React Native from react-native-windows, not the plain react-native package (see the Mac app's config).
  serializer: {
    getModulesRunBeforeMainModule: () => [path.join(rnwPath, 'Libraries/Core/InitializeCore.js')],
    getPolyfills: () => require(path.join(rnwPath, 'rn-get-polyfills.js'))(),
  },
  resolver: {
    platforms: ['windows', 'native'],
    nodeModulesPaths: [path.join(appRoot, 'node_modules'), path.join(repoRoot, 'node_modules')],
    unstable_enableSymlinks: true,
    // What msbuild writes while Metro runs (from the react-native-windows template).
    blockList: [
      new RegExp(`${escape(path.join(appRoot, 'windows'))}.*`),
      new RegExp(`${escape(rnwPath)}/build/.*`),
      new RegExp(`${escape(rnwPath)}/target/.*`),
      /.*\.ProjectImports\.zip/,
    ],
    resolveRequest: (context, moduleName, platform) => {
      const root = Object.keys(singletons).find((name) => moduleName === name || moduleName.startsWith(`${name}/`));
      if (root) {
        const target = singletons[root] + moduleName.slice(root.length);
        return context.resolveRequest({ ...context, originModulePath: path.join(appRoot, 'index.js') }, target, platform);
      }
      return context.resolveRequest(context, moduleName, platform);
    },
  },
  transformer: {
    getTransformOptions: async () => ({ transform: { experimentalImportSupport: false, inlineRequires: true } }),
  },
});
