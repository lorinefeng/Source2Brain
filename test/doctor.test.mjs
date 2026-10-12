import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { doctor, bridgeStatus } from '../lib/doctor.mjs';
import { BrainError } from '../lib/artifact.mjs';

const bridge = '[OK] Daemon: running\n[OK] Extension: connected (v1.0.24)\n[OK] Connectivity: connected in 0.1s';
const runner = async (command, args) => {
  if (args[0] === '--version') return { stdout: command === 'node' ? 'v26.8.2' : '2026.9.6' };
  if (command === 'agent-reach') return { stdout: JSON.stringify({ xiaohongshu: { status: 'warn', active_backend: null, backends: ['OpenCLI'], private_account: 'DO_NOT_OUTPUT' } }) };
  if (command === 'opencli' && args[0] === 'doctor') return { stdout: `${bridge}\nProfiles: PRIVATE_PROFILE` };
  if (command === 'python3') return { stdout: JSON.stringify({ status: 'missing_models', transcription_verified: false }) };
  if (command === 'openclaw' && args[2] === 'channels') return { stdout: JSON.stringify({ channels: { 'openclaw-weixin': { configured: true, running: true, token: 'SECRET', account: 'PRIVATE' } }, secret: 'DO_NOT_OUTPUT' }) };
  throw new Error(`非体检命令 ${command}`);
};

test('体检区分工具、桥接、平台内容、ASR和消息送达；只返回白名单', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 's2b-doctor-')); t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const store = path.join(dir, 'uncreated');
  const calls = [];
  const r = await doctor({ store, runner: async (c, a, o) => { calls.push([c, a]); return runner(c, a, o); }, env: {} });
  assert.equal(r.browser_bridge.status, 'ready');
  assert.equal(r.platform_access.douyin.login_verified, false);
  assert.equal(r.platform_access.xiaohongshu.content_verified, false);
  assert.equal(r.asr.status, 'missing_models');
  assert.equal(r.knowledge.status, 'not_initialized');
  assert.equal(r.wechat.status, 'running');
  assert.equal(r.wechat.message_delivery_verified, false);
  assert.equal(r.e2e_verified, false); assert.equal(r.capture_ready, false);
  assert.ok(!JSON.stringify(r).includes('SECRET')); assert.ok(!JSON.stringify(r).includes('PRIVATE')); assert.ok(!JSON.stringify(r).includes('DO_NOT_OUTPUT'));
  assert.ok(!calls.some(([, a]) => a.includes('--install') || a.includes('login') || a.includes('setup')));
  await assert.rejects(fs.stat(store), { code: 'ENOENT' });
});

test('宿主缺失不导致假成功或强制安装；桥接失败不会升级为平台就绪', async () => {
  const r = await doctor({ store: '/source2brain-synthetic-missing', env: {}, runner: async (cmd, args) => {
    if (cmd === 'openclaw' || cmd === 'hermes') throw new BrainError('DEPENDENCY_MISSING', '测试缺失');
    if (cmd === 'opencli' && args[0] === 'doctor') return { stdout: '[OK] Extension: connected (v1.0.24)\n[FAIL] Connectivity: failed' };
    return runner(cmd, args);
  } });
  assert.equal(r.checks.openclaw.required_for_capture, false);
  assert.equal(r.wechat.status, 'not_installed_optional');
  assert.equal(r.browser_bridge.status, 'connected_not_verified');
  assert.equal(r.platform_access.douyin.status, 'not_probed');
  assert.equal(bridgeStatus('[MISSING] Extension: not connected').status, 'unavailable');
});

test('SSH PATH 缺失时检测项目隔离 OpenClaw 并沿用同一 profile', async () => {
  const calls = [];
  const r = await doctor({ profile: 'isolated-check', store: '/source2brain-synthetic-missing', env: {}, runner: async (cmd, args, options) => {
    if (cmd === 'openclaw') throw new BrainError('DEPENDENCY_MISSING', 'PATH 中缺失');
    if (cmd === 'bash') {
      calls.push({ args, profile: options.env.SOURCE2BRAIN_PROFILE });
      return { stdout: args.includes('--version') ? 'OpenClaw 2026.9.6' : JSON.stringify({ channels: { weixin: { configured: false, running: false } } }) };
    }
    return runner(cmd, args);
  } });
  assert.equal(r.checks.openclaw.entrypoint, 'project_wrapper');
  assert.equal(r.wechat.status, 'not_confirmed');
  assert.equal(calls.length, 2);
  assert.ok(calls.every(c => c.profile === 'isolated-check'));
  assert.ok(calls.every(c => c.args[0].endsWith('/scripts/openclaw.sh')));
});

test('指定链接探测只确认元数据，失败保留错误码且不泄露正文', async () => {
  const args = { runner, store:'/source2brain-synthetic-missing', env:{}, message:'https://www.douyin.com/video/1234567890123456789' };
  const result = await doctor({ ...args, prober:async () => ({content_access:'readable_metadata', source_id:'dy-1234567890123456789', media_observed:true, secret:'DO_NOT_OUTPUT'}) });
  assert.equal(result.platform_access.douyin.metadata_verified,true);
  assert.equal(result.platform_access.douyin.content_verified,false);
  assert.equal(result.platform_access.douyin.download_verified,false);
  assert.ok(!JSON.stringify(result).includes('DO_NOT_OUTPUT'));
  const failure = await doctor({ ...args, prober:async () => { throw new BrainError('AUTH_REQUIRED','私人正文'); } });
  assert.equal(failure.platform_access.douyin.code,'AUTH_REQUIRED');
  assert.ok(!JSON.stringify(failure).includes('私人正文'));
});
