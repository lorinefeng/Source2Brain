import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { hash, contentHash } from '../lib/artifact.mjs';
import { saveSource, verifyStore } from '../lib/store.mjs';
import { enhancementId, validateEnhancement, saveEnhancement } from '../lib/enhancement.mjs';
import { doctorMedia, enhanceVideo, parametersFor } from '../lib/media.mjs';
import { installMedia } from '../scripts/install-media.mjs';
import { searchStore } from '../lib/search.mjs';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1kAAAAASUVORK5CYII=', 'base64');
const base = () => ({ schema_version: 1, source: { url: 'https://www.xiaohongshu.com/explore/000000000000000000000001', original_url: 'https://xhslink.cn/o/synthetic', platform: 'xiaohongshu', title: '合成视频', author: null, published_at: null, captured_at: '2026-09-29T00:00:00.000Z' }, content: { type: 'video', text: '合成配文', transcript: '口播只提到模型排名。', visual_notes: '' }, extraction: { status: 'complete', text: 'complete', transcript: 'complete', visuals: 'missing', limitations: ['仅音频'] }, knowledge: { summary: '合成摘要', claims: [], insights: [], actions: [], related_topics: [] }, provenance: { adapter: 'synthetic', model: 'synthetic', steps: ['合成测试'] } });
async function temp(t) { const p = await fs.mkdtemp(path.join(os.tmpdir(), 's2b-enhancement-')); t.after(() => fs.rm(p, { recursive: true, force: true })); return fs.realpath(p); }
function extra(b = base()) {
  const sha256 = hash(png), timestamp_seconds = 2.5;
  const id = `frame-${hash(`${sha256}:${timestamp_seconds}`).slice(0, 20)}`;
  return { schema_version: 1, kind: 'source_enhancement', pack: 'media', source: { id: 'xhs-000000000000000000000001', url: b.source.url, title: b.source.title, base_content_sha256: contentHash(b), media_sha256: hash('synthetic-video') }, processor: { adapter: 'source2brain/media-v1', summarize: '0.24.0', ocr: 'tesseract.js@7.0.0', languages: 'chi_sim@1.0.0+eng@1.0.0', runtime_lock_sha256: hash('lock') }, parameters: parametersFor(false), coverage: { scope: 'sampled_frames_ocr', status: 'complete', frames: 'complete', ocr: 'complete', review: 'complete', limitations: ['抽样与 OCR，未理解全片'] }, frames: [{ id, path: `frames/${id}.png`, sha256, timestamp_seconds, ocr: { status: 'complete', text: '合成榜单\nModel A 42分', confidence: 0.9 } }], knowledge: { summary: '图示分数为42。', claims: [{ text: 'Model A 为42分', evidence: [{ frame_id: id, quote: 'Model A 42分' }] }] }, provenance: { model: 'synthetic', created_at: '2026-09-29T00:00:00.000Z', steps: ['合成测试'] } };
}
async function fixture(t, a = extra()) {
  const root = await temp(t), input = path.join(root, 'input'), store = path.join(root, 'store');
  await fs.mkdir(path.join(input, 'frames'), { recursive: true });
  for (const frame of a.frames) await fs.writeFile(path.join(input, frame.path), png);
  const file = path.join(input, 'enhancement.json');
  await fs.writeFile(file, JSON.stringify(a));
  const saved = await saveSource(store, base());
  return { root, input, file, store, saved, a };
}

test('增强协议拒绝无效时间戳、路径和虚构引用；稳定身份不依赖 JSON 字段顺序', () => {
  assert.ok(validateEnhancement(extra()));
  for (const mutate of [a => { a.frames[0].timestamp_seconds = -1; }, a => { a.frames[0].path = '../outside.png'; }, a => { a.knowledge.claims[0].evidence[0].quote = '没有说过'; }, a => { a.coverage.review = 'pending'; }, a => { a.frames[0].ocr.confidence = 99; }]) {
    const a = extra(); mutate(a); assert.throws(() => validateEnhancement(a));
  }
  const a = extra(), b = extra(); b.processor = Object.fromEntries(Object.entries(b.processor).reverse()); b.source.title = '标题措辞不同';
  assert.equal(enhancementId(a), enhancementId(b));
});

test('增强并发仅发布一份；原文和人工批注不变，重复增强也保留人工编辑', async t => {
  const x = await fixture(t);
  await fs.appendFile(x.saved.path, '\n人工原笔记批注');
  const before = await fs.readFile(x.saved.path);
  const results = await Promise.all(Array.from({ length: 6 }, () => saveEnhancement(x.store, x.file)));
  assert.equal(results.filter(r => r.status === 'saved').length, 1);
  assert.deepEqual(await fs.readFile(x.saved.path), before);
  const p = results[0].path; await fs.appendFile(p, '\n增强人工批注');
  assert.equal((await saveEnhancement(x.store, x.file)).status, 'duplicate');
  assert.ok((await fs.readFile(p, 'utf8')).endsWith('增强人工批注'));
  const verified = await verifyStore(x.store);
  assert.equal(verified.ok, true); assert.equal(verified.enhancements.length, 1); assert.equal(verified.enhancements[0].edited, true);
  assert.deepEqual(await fs.readdir(path.join(x.store, '.source2brain')), []);
});

test('附件损坏和缺失不会发布完整增强；verify 能检出已保存帧损坏', async t => {
  const x = await fixture(t), frame = path.join(x.input, x.a.frames[0].path);
  await fs.writeFile(frame, Buffer.concat([png, Buffer.from('changed')]));
  await assert.rejects(saveEnhancement(x.store, x.file), { code: 'FRAME_CHANGED' });
  await fs.rm(frame);
  await assert.rejects(saveEnhancement(x.store, x.file), { code: 'ENOENT' });
  assert.deepEqual(await fs.readdir(path.dirname(x.saved.path)), ['artifact.json', 'receipt.json', 'source.md']);
  await fs.writeFile(frame, png);
  const saved = await saveEnhancement(x.store, x.file);
  assert.equal((await searchStore(x.store, '42分')).matches[0].kind, 'enhancement');
  await fs.writeFile(path.join(path.dirname(saved.path), x.a.frames[0].path), Buffer.concat([png, Buffer.from('tampered')]));
  assert.equal((await verifyStore(x.store)).ok, false);
  const damaged = await searchStore(x.store, '42分');
  assert.equal(damaged.total, 0); assert.ok(damaged.issues.length > 0);
});

test('拒绝符号链接附件和保存目录，不向外部写入', async t => {
  const x = await fixture(t), outside = await temp(t), frame = path.join(x.input, x.a.frames[0].path);
  await fs.writeFile(path.join(outside, 'frame.png'), png);
  await fs.rm(frame); await fs.symlink(path.join(outside, 'frame.png'), frame);
  await assert.rejects(saveEnhancement(x.store, x.file), { code: 'UNSAFE_PATH' });
  await fs.rm(frame); await fs.writeFile(frame, png);
  await fs.symlink(outside, path.join(path.dirname(x.saved.path), 'enhancements'));
  await assert.rejects(saveEnhancement(x.store, x.file), { code: 'UNSAFE_PATH' });
  assert.deepEqual(await fs.readdir(outside), ['frame.png']);
});

test('未整理或部分 OCR 失败的结果只进入 Pending，完成后可追加到 Sources', async t => {
  const a = extra(); a.coverage.status = 'partial'; a.coverage.review = 'pending';
  const x = await fixture(t, a);
  const pending = await saveEnhancement(x.store, x.file);
  assert.equal(pending.status, 'pending'); assert.ok(pending.path.includes('/Pending/'));
  assert.equal((await verifyStore(x.store)).enhancements.length, 0);
  a.coverage.status = 'complete'; a.coverage.review = 'complete'; await fs.writeFile(x.file, JSON.stringify(a));
  assert.equal((await saveEnhancement(x.store, x.file)).status, 'saved');
  assert.equal((await verifyStore(x.store)).enhancements.length, 1);
  a.frames[0].ocr = { status: 'failed', text: '', confidence: null, error_code: 'OCR_FAILED' };
  assert.throws(() => validateEnhancement(a));
});

test('原来源版本改变时拒绝附加到错误版本', async t => {
  const x = await fixture(t); x.a.source.base_content_sha256 = hash('other-version');
  await fs.writeFile(x.file, JSON.stringify(x.a));
  await assert.rejects(saveEnhancement(x.store, x.file), { code: 'BASE_CHANGED' });
});

test('系统临时目录别名可用，但不放宽库内符号链接保护', async t => {
  const x = await fixture(t);
  const alias = p => process.platform === 'darwin' ? p.replace(/^\/private\/(var|tmp)\//, '/$1/') : p;
  assert.equal((await saveEnhancement(alias(x.store), alias(x.file))).status, 'saved');
  assert.equal((await verifyStore(alias(x.store))).ok, true);
});

async function mediaFixture(t) {
  const root = await temp(t), b = base(), video = path.join(root, 'video.mp4'), file = path.join(root, 'artifact.json');
  await fs.writeFile(video, Buffer.from([0, 0, 0, 16, ...Buffer.from('ftypisom'), 0, 0, 0, 0]));
  b.provenance.media_files = [{ type: 'video', path: video }]; await fs.writeFile(file, JSON.stringify(b));
  const checkRuntime = async () => ({ ready: true, runtime_lock_sha256: hash('test-lock') });
  const runner = async (command, args) => {
    assert.equal(args[1], 'slides'); assert.ok(!args.includes('--slides-ocr'));
    const dir = args[args.indexOf('--output') + 1]; await fs.mkdir(dir);
    const imagePath = path.join(dir, 'one.png'); await fs.writeFile(imagePath, png);
    return { stdout: JSON.stringify({ ok: true, slides: { slides: [{ index: 1, timestamp: 2.5, imagePath }] } }) };
  };
  return { root, file, checkRuntime, runner };
}

test('media 保留中英文 OCR 原文、真实时间戳，抽取后仍需 Agent 整理', async t => {
  const x = await mediaFixture(t);
  const result = await enhanceVideo(x.file, path.join(x.root, 'out'), { ...x, recognize: async () => [{ status: 'complete', text: '中文\nBenchmark 42', confidence: 0.87 }] });
  assert.equal(result.status, 'enhanced_needs_review');
  const a = JSON.parse(await fs.readFile(result.artifact));
  assert.equal(a.frames[0].ocr.text, '中文\nBenchmark 42'); assert.equal(a.frames[0].timestamp_seconds, 2.5);
  assert.equal(a.coverage.status, 'partial'); assert.equal(a.provenance.model, 'pending');
});

test('空文字帧不是 OCR 失败；重试配方有明确上限', async t => {
  const x = await mediaFixture(t);
  const result = await enhanceVideo(x.file, path.join(x.root, 'out'), { ...x, retry: true, recognize: async () => [{ status: 'complete', text: '', confidence: 0 }] });
  assert.equal(result.coverage.ocr, 'complete'); assert.equal(result.retry_available, false);
  assert.equal(JSON.parse(await fs.readFile(result.artifact)).parameters.max_frames, 48);
});

test('抽帧和 OCR 故障保留部分结果，不伪装成完整', async t => {
  const x = await mediaFixture(t);
  const failed = await enhanceVideo(x.file, path.join(x.root, 'failed'), { ...x, runner: async () => { throw Object.assign(new Error(), { code: 'COMMAND_TIMEOUT' }); } });
  assert.equal(failed.status, 'partial'); assert.equal(failed.frames, 0);
  const ocrFailed = await enhanceVideo(x.file, path.join(x.root, 'ocr-failed'), { ...x, recognize: async () => [{ status: 'failed', text: '', confidence: null, error_code: 'OCR_FAILED' }] });
  assert.equal(ocrFailed.status, 'partial'); assert.equal(ocrFailed.frames, 1); assert.equal(ocrFailed.coverage.ocr, 'missing');
});

test('依赖缺失只报告状态，不安装或创建工作目录', async t => {
  const x = await mediaFixture(t), missing = path.join(x.root, 'missing');
  const check = await doctorMedia(missing); assert.equal(check.ready, false);
  await assert.rejects(fs.stat(missing), { code: 'ENOENT' });
  await assert.rejects(enhanceVideo(x.file, path.join(x.root, 'out'), { runtime: missing }), { code: 'MEDIA_DEPENDENCY_MISSING' });
  await assert.rejects(fs.stat(path.join(x.root, 'out')), { code: 'ENOENT' });
});

test('部分 OCR 失败保留成功帧，但整体不能晋级完成', async t => {
  const x = await mediaFixture(t);
  const runner = async (command, args) => {
    const result = JSON.parse((await x.runner(command, args)).stdout);
    result.slides.slides.push({ ...result.slides.slides[0], index: 2, timestamp: 3.5 });
    return { stdout: JSON.stringify(result) };
  };
  const result = await enhanceVideo(x.file, path.join(x.root, 'out'), { ...x, runner, recognize: async () => [
    { status: 'complete', text: '中文与 English 42', confidence: 0.91 },
    { status: 'failed', text: '', confidence: null, error_code: 'OCR_FAILED' }
  ] });
  assert.equal(result.status, 'partial'); assert.equal(result.coverage.ocr, 'partial');
  const a = JSON.parse(await fs.readFile(result.artifact));
  assert.equal(a.frames[0].ocr.text, '中文与 English 42'); assert.equal(a.frames[1].ocr.status, 'failed');
});

test('发布阶段故障不会留下半份增强，且会清理本次暂存目录', async t => {
  const x = await fixture(t), original = fs.rename;
  fs.rename = async (source, destination) => {
    if (source.includes(`${path.sep}.source2brain${path.sep}enhancement-`)) throw Object.assign(new Error('合成磁盘错误'), { code: 'EIO' });
    return original(source, destination);
  };
  try { await assert.rejects(saveEnhancement(x.store, x.file), { code: 'EIO' }); }
  finally { fs.rename = original; }
  assert.deepEqual(await fs.readdir(path.join(path.dirname(x.saved.path), 'enhancements')), []);
  assert.deepEqual(await fs.readdir(path.join(x.store, '.source2brain')), []);
  assert.equal((await verifyStore(x.store)).ok, true);
});

test('安装失败保留旧运行目录；复跑就绪环境不重复调用 npm', async t => {
  const root = await temp(t), runtime = path.join(root, 'media'); await fs.mkdir(runtime); await fs.writeFile(path.join(runtime, 'old'), '旧环境');
  if (Number(process.versions.node.split('.')[0]) < 24) {
    await assert.rejects(installMedia(runtime), { code: 'NODE_UNSUPPORTED' });
    return;
  }
  await assert.rejects(installMedia(runtime, { checkRuntime: async () => ({ ready: false }), runner: async () => { throw new Error('合成安装失败'); } }));
  assert.equal(await fs.readFile(path.join(runtime, 'old'), 'utf8'), '旧环境');
  assert.deepEqual(await fs.readdir(root), ['media']);
  const result = await installMedia(runtime, { checkRuntime: async () => ({ ready: true }), runner: async () => { assert.fail('不应重复安装'); } });
  assert.equal(result.status, 'reused');
});
