import test from 'node:test';
import assert from 'node:assert/strict';
import { aliyunLanguageParameters } from '../../speech/asr-language.mjs';
import { recognizeFile } from '../asr-file.mjs';

test('auto detection omits language_hints; manual recognition still constrains the language', () => {
  const parameters = { sample_rate: 16000, format: 'pcm', ...aliyunLanguageParameters('auto') };
  assert.ok(!Object.hasOwn(parameters, 'language_hints'));
  for (const language of ['zh', 'ja', 'en']) {
    assert.deepEqual(aliyunLanguageParameters(language), { language_hints: [language] });
  }
});

test('completed-file upload passes auto mode to the provider and retains all final segments', async () => {
  let upstream;
  const text = await recognizeFile(Buffer.alloc(12000), 'auto', {
    signal: new AbortController().signal,
    createSession(config, transcript, _error, _close, event) {
      upstream = config.lang;
      queueMicrotask(() => event('task-started'));
      return {
        sendAudio() {},
        flush() {
          transcript('こんにちは。', true, 'a0');
          transcript('Hello.', true, 'a1');
          event('task-finished');
        },
        close() {},
      };
    },
  });
  assert.equal(upstream, 'auto');
  assert.equal(text, 'こんにちは。 Hello.');
});
