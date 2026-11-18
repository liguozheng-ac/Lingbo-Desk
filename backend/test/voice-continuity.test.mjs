import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';

// Run the actual worker model adapter with a controlled tensor/model boundary; no microphone or cloud calls.
const modelSource = fs.readFileSync(new URL('../../desktop/packages/stage-ui/src/workers/vad/silero-vad-model.ts', import.meta.url), 'utf8');
const executable = stripTypeScriptTypes(modelSource.replace(/^import .*$/gm, '').replace('export class SileroVadModel', 'class SileroVadModel'), { mode: 'transform' });
function adapter() {
  const calls = [];
  let disposed = false;
  class Tensor {
    constructor(type, data, dims) { this.type = type; this.data = data; this.dims = dims; }
    dispose() { this.disposed = true; }
  }
  const inference = async ({ input, state }) => {
    calls.push({ input: [...input.data], dims: [...input.dims], state: [...state.data] });
    return { stateN: new Tensor('float32', new Float32Array(256).fill(calls.length), [2, 1, 128]), output: new Tensor('float32', [0.9], [1]) };
  };
  inference.dispose = async () => { disposed = true; };
  const context = vm.createContext({ Tensor, Float32Array, AutoModel: { from_pretrained: async () => inference }, PretrainedConfig: class { constructor(config) { Object.assign(this, config); } } });
  const Model = vm.runInContext(executable + '\nSileroVadModel', context);
  return { model: new Model(), calls, disposed: () => disposed };
}

test('VAD supplies the 64-sample context across consecutive windows and resets it on a gap', async () => {
  const { model, calls, disposed } = adapter();
  const first = Float32Array.from({ length: 512 }, (_, i) => i / 512);
  const second = new Float32Array(512).fill(0.25);
  await Promise.all([model.score(first, false), model.score(second, false)]);
  assert.deepEqual(calls[0].dims, [1, 576]);
  assert.deepEqual(calls[0].input.slice(0, 64), Array(64).fill(0));
  assert.deepEqual(calls[1].input.slice(0, 64), [...first.slice(-64)]);
  assert.equal(calls[1].state[0], 1);
  await model.score(first, true);
  assert.deepEqual(calls[2].input.slice(0, 64), Array(64).fill(0));
  assert.equal(calls[2].state[0], 0);
  await model.close();
  assert.equal(disposed(), true);
});

test('cancelled and invalid VAD windows do not contaminate the next input context', async () => {
  const { model, calls } = adapter();
  const first = new Float32Array(512).fill(0.5);
  await model.score(first, false);
  await assert.rejects(model.score(new Float32Array(512).fill(1), false, AbortSignal.abort()), { name: 'AbortError' });
  await assert.rejects(model.score(new Float32Array(256), false), /512 new samples/);
  await model.score(new Float32Array(512), false);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].input.slice(0, 64), Array(64).fill(0.5));
  await model.close();
});

test('buffered ASR does not wait for an end judge that has no interim transcript', () => {
  const voice = fs.readFileSync(new URL('../../desktop/packages/stage-ui/src/stores/voice.ts', import.meta.url), 'utf8');
  const expression = voice.match(/silenceMs: \(\) => ([\s\S]*?),\s*\/\/ Automatic barge-in/)[1];
  const limit = (enabled, text) => vm.runInNewContext(expression, { hearing: { endJudgeEnabled: enabled }, transcript: { value: text === undefined ? undefined : { raw: { text } } }, VOICE_END_SILENCE: { pauseMs: 1200, graceMs: 3000 } });
  assert.equal(limit(true, undefined), 1200);
  assert.equal(limit(true, ''), 1200);
  assert.equal(limit(true, '  '), 1200);
  assert.equal(limit(true, 'unfinished phrase'), 4200);
  assert.equal(limit(false, 'unfinished phrase'), 1200);
});
