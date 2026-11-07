// Local lifecycle fixture. No model, network, or user data.
import fs from 'node:fs';
import path from 'node:path';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
if (process.argv.includes('--grandchild')) {
  setTimeout(() => fs.writeFileSync(process.argv.at(-1), 'unexpected late write'), 2500);
} else {
  let ignoreShutdown = false, pending;
  process.send?.({ type: 'ready', data: { cloudKeyPresent: Object.keys(process.env).some(k => /(?:API_KEY|SECRET|FIXTURE_PRIVATE)/i.test(k)), preloadPresent: !!process.env.NODE_OPTIONS, metadataOnly: process.env.LINGBO_DIAGNOSTICS_METADATA_ONLY === '1' } });
  process.on('message', message => {
    if (message.command === 'run') {
      if (message.prompt.includes('mode=hang')) ignoreShutdown = true;
      if (message.prompt.includes('mode=crash')) process.exit(7);
      if (message.prompt.includes('mode=settled')) process.send?.({ type: 'settled', data: { content: 'no receipt' } });
      if (message.prompt.includes('mode=delayed')) pending = setTimeout(() => fs.writeFileSync(path.join(process.env.VALIDATION_DATA, 'late.txt'), 'unexpected'), 2500);
    }
    if (message.command === 'spawn-descendant') {
      ignoreShutdown = true;
      const descendant = fork(fileURLToPath(import.meta.url), ['--grandchild', message.file], { stdio: 'ignore', windowsHide: true });
      process.send?.({ type: 'descendant', data: { pid: descendant.pid } });
    }
    if (message.command === 'crash') process.exit(7);
    if (message.command === 'noise') { process.stdout.write('private-fixture-body sk-fixturefakecredential123456\n'); process.stderr.write('Bearer synthetic-'); process.stderr.write('credential-value\n'); process.send?.({ type: 'noise.sent' }); }
    if (message.command === 'shutdown' && !ignoreShutdown) { clearTimeout(pending); process.exit(0); }
  });
  process.on('disconnect', () => { if (!ignoreShutdown) process.exit(0); });
}
