import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { hash } from '../lib/artifact.mjs';
import { doctorMedia, enhanceVideo, mediaLockCompatibility, recipeDirectory, visionParametersFor, parametersFor } from '../lib/media.mjs';
import { installMedia } from '../scripts/install-media.mjs';

const supportedNode = Number(process.versions.node.split('.')[0]) >= 24;
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1kAAAAASUVORK5CYII=', 'base64');
async function temp(t) {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 's2b-media-runtime-'));
  t.after(() => fs.rm(folder, { recursive: true, force: true }));
  return fs.realpath(folder);
}
async function fakeInstalledSummarize(runtime) {
  const folder = path.join(runtime, 'node_modules/@steipete/summarize');
  await fs.mkdir(path.join(folder, 'dist'), { recursive: true });
  await fs.writeFile(path.join(folder, 'package.json'), JSON.stringify({ name: '@steipete/summarize', version: '0.24.0' }));
  await fs.writeFile(path.join(folder, 'dist/cli.js'), '// 合成就绪检查夹具，不执行');
}
async function runtimeFixture(t) {
  const root = await temp(t), runtime = path.join(root, 'media');
  await fs.mkdir(runtime);
  for (const file of ['package.json', 'package-lock.json']) await fs.copyFile(path.join(recipeDirectory, file), path.join(runtime, file));
  await fakeInstalledSummarize(runtime);
  return { root, runtime };
}

test('media 默认固定锁只依赖 summarize，不携带 Tesseract 或语言数据', async () => {
  const pkg = JSON.parse(await fs.readFile(path.join(recipeDirectory, 'package.json')));
  const lock = JSON.parse(await fs.readFile(path.join(recipeDirectory, 'package-lock.json')));
  assert.deepEqual(pkg.dependencies, { '@steipete/summarize': '0.24.0' });
  assert.deepEqual(lock.packages[''].dependencies, pkg.dependencies);
  assert.equal(lock.packages[''].version, pkg.version);
  assert.equal(lock.packages['node_modules/@steipete/summarize'].version, '0.24.0');
  assert.ok(Object.keys(lock.packages).every(name => !/tesseract|traineddata/i.test(name)));
  assert.ok(Object.values(lock.packages).every(p => !/tesseract|traineddata/i.test(JSON.stringify(p.dependencies || {}))));
});

test('doctor 仅报告抽帧依赖就绪，不因缺少旧 OCR 包失败，也不声称视觉可用', async t => {
  const { runtime } = await runtimeFixture(t);
  const check = await doctorMedia(runtime);
  assert.equal(check.ready, supportedNode);
  assert.equal(check.frame_dependencies_ready, supportedNode);
  assert.equal(check.ready_for, 'frame_extraction_dependencies');
  assert.equal(check.checks.lock.compatibility, 'current');
  assert.equal(check.vision.status, 'not_probed');
  assert.equal(check.automatic_ocr, false);
  assert.equal(check.e2e_verified, false);
  assert.ok(!('languages' in check.checks));
  assert.deepEqual(await fs.readdir(path.join(runtime, 'node_modules')), ['@steipete']);
  await fs.rm(path.join(runtime, 'node_modules/@steipete/summarize/dist/cli.js'));
  assert.equal((await doctorMedia(runtime)).checks.cli.status, 'missing');
  assert.equal((await doctorMedia(runtime)).ready, false);
});

test('doctor 拒绝未知锁和版本漂移；只允许当前锁或已验证旧 v1 锁', async t => {
  const { runtime } = await runtimeFixture(t);
  const current = hash(await fs.readFile(path.join(recipeDirectory, 'package-lock.json')));
  assert.equal(mediaLockCompatibility(current, current), 'current');
  assert.equal(mediaLockCompatibility('5055652225ec5225951ba22dd684744ca57b1c311ec74ffb715b28f128860136', current), 'legacy-v1');
  assert.equal(mediaLockCompatibility(hash('unknown'), current), null);
  await fs.appendFile(path.join(runtime, 'package-lock.json'), '\n');
  assert.equal((await doctorMedia(runtime)).checks.lock.status, 'mismatch');
  await fs.writeFile(path.join(runtime, 'node_modules/@steipete/summarize/package.json'), JSON.stringify({ version: '0.25.0' }));
  const changed = await doctorMedia(runtime);
  assert.equal(changed.checks['@steipete/summarize'].status, 'version_mismatch');
  assert.equal(changed.ready, false);
});

test('抽帧配方与旧 v1 OCR 参数分开保留，重试严格最多 48 帧', () => {
  assert.deepEqual(visionParametersFor(false), { max_frames: 24, scene_threshold: 0.2, min_duration_seconds: 2 });
  assert.deepEqual(visionParametersFor(true), { max_frames: 48, scene_threshold: 0.1, min_duration_seconds: 2 });
  assert.equal(parametersFor(false).ocr_languages, 'chi_sim+eng');
  assert.equal(parametersFor(true).max_frames, 48);
});

test('新安装仅走固定抽帧锁，保留旧目录备份，复跑不安装和下载模型', async t => {
  if (!supportedNode) return;
  const root = await temp(t), runtime = path.join(root, 'media');
  await fs.mkdir(runtime);
  await fs.writeFile(path.join(runtime, 'existing-model'), '用户已有内容');
  let calls = 0;
  const runner = async (command, args, options) => {
    calls++;
    assert.equal(command, process.platform === 'win32' ? 'npm.cmd' : 'npm');
    assert.deepEqual(args, ['ci', '--ignore-scripts', '--no-audit', '--no-fund']);
    const lock = JSON.parse(await fs.readFile(path.join(options.cwd, 'package-lock.json')));
    assert.ok(Object.keys(lock.packages).every(name => !/tesseract|traineddata/i.test(name)));
    await fakeInstalledSummarize(options.cwd);
    return { stdout: '', stderr: '' };
  };
  const installed = await installMedia(runtime, { runner });
  assert.equal(installed.status, 'installed'); assert.equal(calls, 1);
  assert.equal(await fs.readFile(path.join(installed.backup, 'existing-model'), 'utf8'), '用户已有内容');
  const receipt = JSON.parse(await fs.readFile(path.join(runtime, 'install-receipt.json')));
  assert.equal(receipt.mode, 'frames-only');
  assert.equal(receipt.automatic_ocr, false);
  assert.equal(receipt.vision_status, 'not_probed');
  assert.ok(Object.keys(receipt.packages).every(name => !/tesseract|traineddata/i.test(name)));
  assert.equal((await fs.stat(path.join(runtime, 'install-receipt.json'))).mode & 0o777, 0o600);
  const reused = await installMedia(runtime, { runner: async () => assert.fail('不得复跑安装或下载模型') });
  assert.equal(reused.status, 'reused');
  assert.equal(reused.vision.status, 'not_probed');
  assert.equal(await fs.readFile(path.join(installed.backup, 'existing-model'), 'utf8'), '用户已有内容');
});

async function inputFixture(t) {
  const root = await temp(t), video = path.join(root, 'video.mp4'), file = path.join(root, 'artifact.json');
  await fs.writeFile(video, Buffer.from([0, 0, 0, 16, ...Buffer.from('ftypisom'), 0, 0, 0, 0]));
  const base = { schema_version: 1, source: { url: 'https://www.xiaohongshu.com/explore/000000000000000000000001', original_url: 'https://xhslink.cn/o/synthetic', platform: 'xiaohongshu', title: '合成视频', author: null, published_at: null, captured_at: '2026-09-29T00:00:00.000Z' }, content: { type: 'video', text: '合成配文', transcript: '合成口播。', visual_notes: '' }, extraction: { status: 'complete', text: 'complete', transcript: 'complete', visuals: 'missing', limitations: ['仅音频'] }, knowledge: { summary: '合成摘要', claims: [], insights: [], actions: [], related_topics: [] }, provenance: { adapter: 'synthetic', model: 'synthetic', steps: ['合成测试'], media_files: [{ type: 'video', path: video }] } };
  await fs.writeFile(file, JSON.stringify(base));
  return { root, file, checkRuntime: async () => ({ ready: true, runtime_lock_sha256: hash('synthetic-lock') }) };
}

test('默认抽帧拒绝越界、无效时间戳及伪 PNG，保留失败回执且不识读', async t => {
  const x = await inputFixture(t), outside = path.join(x.root, 'outside.png');
  await fs.writeFile(outside, png);
  for (const [name, mutate, code] of [
    ['escape', s => ({ ...s, imagePath: outside }), 'UNSAFE_PATH'],
    ['timestamp', s => ({ ...s, timestamp: -1 }), 'INVALID_TIMESTAMP'],
    ['not-png', async s => { await fs.writeFile(s.imagePath, 'not a PNG'); return s; }, 'INVALID_FRAME']
  ]) {
    const runner = async (_, args) => {
      assert.equal(args[1], 'slides'); assert.ok(args.includes('--no-cache'));
      assert.ok(!args.includes('--slides-ocr'));
      const dir = args[args.indexOf('--output') + 1]; await fs.mkdir(dir);
      const imagePath = path.join(dir, 'one.png'); await fs.writeFile(imagePath, png);
      return { stdout: JSON.stringify({ ok: true, slides: { slides: [await mutate({ timestamp: 2, imagePath })] } }) };
    };
    const result = await enhanceVideo(x.file, path.join(x.root, name), { ...x, runner, recognize: async () => assert.fail('默认流程不得 OCR') });
    assert.equal(result.status, 'partial');
    assert.ok(result.coverage.limitations.some(s => s.endsWith(code)));
    const a = JSON.parse(await fs.readFile(result.artifact));
    assert.equal(a.schema_version, 2); assert.equal(a.coverage.vision, 'pending');
    assert.equal(a.knowledge.summary, ''); assert.deepEqual(a.knowledge.claims, []);
    assert.ok(!('ocr' in a.coverage));
  }
});

test('上游后续帧损坏时保留已验证帧，但不能把部分抽取或待视觉识读标完成', async t => {
  const x = await inputFixture(t);
  const runner = async (_, args) => {
    const dir = args[args.indexOf('--output') + 1]; await fs.mkdir(dir);
    const imagePath = path.join(dir, 'one.png'); await fs.writeFile(imagePath, png);
    return { stdout: JSON.stringify({ ok: true, slides: { slides: [{ timestamp: 2, imagePath }, { timestamp: -1, imagePath }] } }) };
  };
  const result = await enhanceVideo(x.file, path.join(x.root, 'out'), { ...x, runner });
  assert.equal(result.status, 'partial'); assert.equal(result.frames, 1);
  const a = JSON.parse(await fs.readFile(result.artifact));
  assert.equal(a.coverage.frames, 'missing'); assert.equal(a.coverage.vision, 'pending');
  assert.deepEqual(a.frames[0].vision, { status: 'pending', text: '', description: '', reviewer: null });
  assert.equal(hash(await fs.readFile(path.join(path.dirname(result.artifact), a.frames[0].path))), a.frames[0].sha256);
});
