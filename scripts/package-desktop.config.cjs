const path = require('node:path');
const required = key => { if (!process.env[key]) throw new Error('Missing packaging input: ' + key); return path.resolve(process.env[key]); };
const payload = required('LINGBO_PACKAGE_PAYLOAD');
const version = require('../package.json').version;
const target = process.env.LINGBO_PACKAGE_TARGET || 'dir';
if (!['dir', 'nsis'].includes(target)) throw new Error('Unsupported packaging target');
module.exports = {
  appId: 'local.lingbo.desk', productName: 'Lingbo Desk',
  electronVersion: '43.8.4', electronDist: required('LINGBO_ELECTRON_DIST'),
  directories: { output: required('LINGBO_PACKAGE_OUTPUT') },
  files: ['out/**', 'resources/**', 'package-bootstrap.mjs', 'package-settings.mjs', 'static-renderer.mjs', 'profile-migration.mjs', 'workspace-window.mjs', 'package.json', '!**/node_modules/electron{,/**}'],
  extraMetadata: { name: 'lingbo-desk', version, main: 'package-bootstrap.mjs' },
  extraResources: ['service', 'node-runtime', 'python', 'THIRD-PARTY-NOTICES.md', 'package-manifest.json'].map(name => ({ from: path.join(payload, name), to: name })),
  asar: true, asarUnpack: ['**/*.node', '**/node_modules/@auv-js/cli-*/bin/**'],
  npmRebuild: false, nodeGypRebuild: false, publish: null,
  win: { target: [target], executableName: 'LingboDesk', icon: 'resources/icon.ico', signAndEditExecutable: true, signExecutable: false },
  // Retain the installed application's identity, shortcuts and user data on upgrade.
  nsis: { guid: '6370a693-3c55-52e9-b49b-093e3d2ec67c', oneClick: false, perMachine: false, allowElevation: false, allowToChangeInstallationDirectory: true, createDesktopShortcut: true, createStartMenuShortcut: true, shortcutName: '聆泊', uninstallDisplayName: '聆泊 Lingbo Desk', deleteAppDataOnUninstall: false, runAfterFinish: false, artifactName: 'Lingbo-Desk-${version}-Setup.exe' },
};
