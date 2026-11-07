import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const desktop=path.join(root,'desktop'),app=path.join(desktop,'apps/stage-tamagotchi');
const core=process.env.LIVE2D_CORE_PATH || path.join(root,'resources/local/live2dcubismcore.min.js');
if(!fs.existsSync(core)) throw new Error('请按 docs/setup.md 导入本人已接受条款的 Cubism Core，并设置 LIVE2D_CORE_PATH。');
const bridge=path.join(app,'src/renderer/bridges');fs.mkdirSync(bridge,{recursive:true});
for(const [source,target] of Object.entries({'renderer-bridge.mjs':'lingbo-integration.mjs','renderer-voice.mjs':'lingbo-voice.mjs','commands.mjs':'lingbo-commands.mjs','speech-targets.mjs':'lingbo-speech-targets.mjs','work-schema.mjs':'lingbo-work-schema.mjs'}))fs.copyFileSync(path.join(desktop,'bridges',source),path.join(bridge,target));
fs.copyFileSync(path.join(desktop,'bridges/computer-use-runtime-patch.mjs'),path.join(app,'computer-use-runtime-patch.mjs'));
fs.copyFileSync(path.join(desktop,'bridges/desktop-config.ts.template'),path.join(app,'electron-integration.config.ts'));
for(const name of ['package-bootstrap.mjs','package-settings.mjs','static-renderer.mjs','profile-migration.mjs'])fs.copyFileSync(path.join(desktop,'launcher',name),path.join(app,name));
for(const directory of ['.cache','public','src/renderer/.cache','src/renderer/public']){
 const target=path.join(app,directory,'assets/js/CubismSdkForWeb-5-r.3/Core');fs.mkdirSync(target,{recursive:true});fs.copyFileSync(core,path.join(target,'live2dcubismcore.min.js'));
}
const assets=process.env.LINGBO_MODEL_ASSETS;
if(assets)for(const kind of ['live2d','vrm']){const source=path.join(assets,kind);if(fs.existsSync(source))fs.cpSync(source,path.join(desktop,'packages/stage-ui/src/assets',kind,'models'),{recursive:true});}
console.log('Desktop bridges and local licensed assets prepared.');
