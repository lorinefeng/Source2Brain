import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { captureXhs } from '../lib/capture.mjs';
import { BrainError } from '../lib/artifact.mjs';

const signed = 'https://www.xiaohongshu.com/explore/000000000000000000000002?xsec_token=synthetic';
async function setup(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'source2brain-capture-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const calls = [];
  const runner = async (command, args) => {
    calls.push([command, args]);
    if (command === 'agent-reach') return { stdout: JSON.stringify({ xiaohongshu: { status: 'warn', active_backend: null, backends: ['OpenCLI'] } }) };
    if (args[0] === '--version') return { stdout: '1.8.6' };
    if (args[0] === 'browser') {
      if (args[2] === 'get') return { stdout: args[3] === 'url' ? signed : '合成来源标题 - 小红书' };
      return { stdout: '{}' };
    }
    if (args[1] === 'note') return { stdout: JSON.stringify([{ field: 'title', value: '手机号登录' }, { field: 'author', value: '测试作者' }, { field: 'content', value: '真实配文的合成测试' }]) };
    if (args[1] === 'download') return { stdout: JSON.stringify([{ index: 1, type: 'video', status: 'success', size: '1 MB' }]) };
    throw new Error('意外命令');
  };
  return { root, calls, runner };
}

test('新版体检 warn 以真实命令验证，并使用页面标题避开登录弹窗标题', async t => {
  const { root, calls, runner } = await setup(t);
  const result = await captureXhs('收藏 https://xhslink.cn/o/test', path.join(root, 'capture'), { runner });
  const artifact = JSON.parse(await fs.readFile(result.artifact, 'utf8'));
  assert.equal(artifact.source.title, '合成来源标题');
  assert.equal(artifact.content.type, 'video');
  assert.equal(artifact.extraction.status, 'partial');
  assert.ok(calls.find(([cmd, args]) => cmd === 'opencli' && args[1] === 'note')[1].includes('ephemeral'));
  assert.equal(calls.at(-1)[1][2], 'close');
});

test('登录失败保留失败回执并释放自己打开的 tab，不生成成功 artifact', async t => {
  const { root, calls, runner } = await setup(t);
  const output = path.join(root, 'capture');
  await assert.rejects(captureXhs('https://xhslink.cn/o/test', output, { runner: async (cmd, args) => {
    if (args[1] === 'note') throw new BrainError('AUTH_REQUIRED', '需要登录');
    return runner(cmd, args);
  } }), { code: 'AUTH_REQUIRED' });
  const journal = JSON.parse(await fs.readFile(path.join(output, 'capture.json'), 'utf8'));
  assert.equal(journal.status, 'failed');
  await assert.rejects(fs.stat(path.join(output, 'artifact.json')), { code: 'ENOENT' });
  assert.equal(calls.at(-1)[1][2], 'close');
});

test('媒体失败仅生成 partial，不把只有配文的来源标记完整', async t => {
  const { root, runner } = await setup(t);
  const result = await captureXhs('https://xhslink.cn/o/test', path.join(root, 'capture'), { runner: async (cmd, args) => {
    if (args[1] === 'download') throw new BrainError('MEDIA_FAILED', '测试失败');
    return runner(cmd, args);
  } });
  assert.equal(result.media_error, 'MEDIA_FAILED');
  const artifact = JSON.parse(await fs.readFile(result.artifact, 'utf8'));
  assert.equal(artifact.extraction.status, 'partial');
  assert.equal(artifact.extraction.visuals, 'missing');
});
