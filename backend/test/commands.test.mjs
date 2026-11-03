import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCommand, plainText, personalInput } from '../commands.mjs';

test('only explicit commands create or control a task', () => {
  assert.equal(parseCommand('生成测试报告。').action, 'create');
  assert.equal(parseCommand('Pause the report task!').action, 'pause');
  assert.equal(parseCommand('レポートを再開して。').action, 'resume');
  for (const text of ['我不想取消报告任务', '讨论一下生成测试报告的方法', '请删除所有资料', '暂停音乐']) assert.equal(parseCommand(text), null);
});
test('speech interruption remains a separate command', () => {
  assert.deepEqual(parseCommand('别念了！'), { action: 'stop_speech' });
  assert.deepEqual(parseCommand('取消报告任务'), { action: 'cancel' });
});
test('multimodal text extraction excludes image payloads', () => {
  assert.equal(plainText([{ type: 'text', text: '报告任务进度' }, { type: 'image_url', image_url: { url: 'private' } }]), '报告任务进度');
});
test('only explicit original personal input is forwarded, with a bounded header', () => {
  assert.equal(personalInput('请记住，我偏好简短回答。'), '请记住，我偏好简短回答。');
  assert.equal(personalInput('记住了吗？'), null);
  assert.equal(personalInput('不要记住这句话'), null);
  assert.equal(personalInput('使用技能：concise-report 整理要点'), '使用技能：concise-report 整理要点');
  assert.throws(() => personalInput('记住：' + '长'.repeat(1000)), /1000/);
});
