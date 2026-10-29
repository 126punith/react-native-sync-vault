const fs = require('fs');
const path = require('path');
const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config');

// The library is installed as a symlink (file:../..). Metro must watch its real location, read
// its TypeScript source, and resolve react / react-native from this app only: a second copy
// from the library's own node_modules would break the Turbo Module registry.
const libraryRoot = fs.realpathSync(path.join(__dirname, 'node_modules/react-native-sync-vault'));
const escape = value => value.replace(/[/\\^$*+?.()|[\]{}]/g, '\\$&');

const config = {
  watchFolders: [libraryRoot],
  resolver: {
    nodeModulesPaths: [path.join(__dirname, 'node_modules')],
    blockList: [new RegExp(`^${escape(path.join(libraryRoot, 'node_modules'))}[/\\\\].*`)],
    extraNodeModules: {
      react: path.join(__dirname, 'node_modules/react'),
      'react-native': path.join(__dirname, 'node_modules/react-native'),
    },
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
