import { workerData } from 'node:worker_threads';
import { pathToFileURL } from 'node:url';

// Run the installed gateway unchanged, with all model HTTP traffic confined
// to a loopback fault fixture. This hook exists only inside this test worker.
const realFetch = globalThis.fetch;
globalThis.fetch = (input, options) => {
  const url = new URL(typeof input === 'string' ? input : input.url);
  if (url.origin === 'https://api.deepseek.com') return realFetch(workerData.upstream + '/cloud', options);
  if (url.origin === 'http://127.0.0.1:11434') return realFetch(workerData.upstream + '/local', options);
  throw new Error('Fault fixture blocked unexpected outbound fetch: ' + url.origin);
};
await import(pathToFileURL(workerData.entry).href);
