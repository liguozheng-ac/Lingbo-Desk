const path = require('node:path');
const required = key => { if (!process.env[key]) throw new Error('Missing packaging input: ' + key); return path.resolve(process.env[key]); };
const payload = required('LINGBO_PACKAGE_PAYLOAD');
module.exports = {
  appId: 'local.lingbo.desk', productName: 'Lingbo Desk',
  electronVersion: '43.8.4', electronDist: required('LINGBO_ELECTRON_DIST'),
  directories: { output: required('LINGBO_PACKAGE_OUTPUT') },
  files: ['out/**', 'resources/**', 'package-bootstrap.mjs', 'package-settings.mjs', 'static-renderer.mjs', 'profile-migration.mjs', 'package.json', '!**/node_modules/electron{,/**}'],
  extraMetadata: { name: 'lingbo-desk', version: '0.3.4-test', main: 'package-bootstrap.mjs' },
  extraResources: ['service', 'node-runtime', 'python', 'THIRD-PARTY-NOTICES.md', 'package-manifest.json'].map(name => ({ from: path.join(payload, name), to: name })),
  asar: true, asarUnpack: ['**/*.node', '**/node_modules/@auv-js/cli-*/bin/**'],
  npmRebuild: false, nodeGypRebuild: false, publish: null,
  win: { target: ['dir'], executableName: 'LingboDesk', icon: 'resources/icon.ico', signAndEditExecutable: true, signExecutable: false },
};
