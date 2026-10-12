import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { hash, contentHash } from '../lib/artifact.mjs';
import { saveSource, verifyStore } from '../lib/store.mjs';
import { saveEnhancement } from '../lib/enhancement.mjs';
import { parametersFor } from '../lib/media.mjs';
import { claimHash, saveReview, readSource } from '../lib/review.mjs';
import { searchStore } from '../lib/search.mjs';
import { main } from '../scripts/brain.mjs';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1kAAAAASUVORK5CYII=', 'base64');
async function fixture(t) {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 's2b-review-'));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const root = await fs.realpath(temp), store = path.join(root, 'store'), sourceId = 'xhs-000000000000000000000001';
  const base = { schema_version: 1, source: { url: 'https://www.xiaohongshu.com/explore/000000000000000000000001', original_url: 'https://xhslink.cn/o/synthetic', platform: 'xiaohongshu', title: '合成勘误视频', author: null, published_at: null, captured_at: '2026-10-07T00:00:00.000Z' }, content: { type: 'video', text: '配文原始关键词', transcript: '口播介绍操作方法。', visual_notes: '' }, extraction: { status: 'complete', text: 'complete', transcript: 'complete', visuals: 'missing', limitations: ['仅音频'] }, knowledge: { summary: '口播摘要', claims: [], insights: [], actions: [], related_topics: [] }, provenance: { adapter: 'synthetic', model: 'synthetic', steps: ['合成测试'] } };
  const source = await saveSource(store, base), timestamp = 2.5, sha = hash(png), frameId = `frame-${hash(`${sha}:${timestamp}`).slice(0,20)}`;
  const artifact = { schema_version: 1, kind: 'source_enhancement', pack: 'media', source: { id: sourceId, url: base.source.url, title: base.source.title, base_content_sha256: contentHash(base), media_sha256: hash('video') }, processor: { adapter: 'source2brain/media-v1', summarize: '0.24.0', ocr: 'tesseract.js@7.0.0', languages: 'chi_sim@1.0.0+eng@1.0.0', runtime_lock_sha256: hash('lock') }, parameters: parametersFor(false), coverage: { scope: 'sampled_frames_ocr', status: 'complete', frames: 'complete', ocr: 'complete', review: 'complete', limitations: ['抽样 OCR'] }, frames: [{ id: frameId, path: `frames/${frameId}.png`, sha256: sha, timestamp_seconds: timestamp, ocr: { status: 'complete', text: '评分42%\n183G\n归档', confidence: .9 } }], knowledge: { summary: '过时摘要 评分42% 183G', claims: [{ text: '评分42%', evidence: [{ frame_id: frameId, quote: '评分42%' }] }, { text: '容量183G', evidence: [{ frame_id: frameId, quote: '183G' }] }, { text: '归档入口', evidence: [{ frame_id: frameId, quote: '归档' }] }] }, provenance: { model: 'synthetic', created_at: '2026-10-07T00:00:00.000Z', steps: ['合成 OCR'] } };
  const input = path.join(root, 'input'); await fs.mkdir(path.join(input, 'frames'), { recursive: true });
  await fs.writeFile(path.join(input, artifact.frames[0].path), png);
  const extraFile = path.join(input, 'enhancement.json'); await fs.writeFile(extraFile, JSON.stringify(artifact));
  const extra = await saveEnhancement(store, extraFile), folder = path.dirname(extra.path);
  const review = { schema_version: 1, kind: 'ocr_review', source_id: sourceId, enhancement_id: extra.enhancement_id, enhancement_sha256: hash(JSON.stringify(artifact)), reviewer: { identity: '合成视觉测试工具', model: 'synthetic-vision', method: 'image_tool', visual_input_received: true, reviewed_at: '2026-10-07T01:00:00.000Z' }, items: [{ claim_index: 0, claim_sha256: claimHash(artifact.knowledge.claims[0]), disposition: 'corrected', reason: '合成测试：百分号识别错误', correction: '评分4.2星', evidence: [{ frame_id: frameId, frame_sha256: sha, observed_text: '4.2★' }] }, { claim_index: 1, claim_sha256: claimHash(artifact.knowledge.claims[1]), disposition: 'withdraw', reason: '合成测试：不可辨认数字，撤回', correction: null, evidence: [{ frame_id: frameId, frame_sha256: sha, observed_text: null }] }] };
  const reviewFile = path.join(root, 'review-input.json');
  const writeReview = () => fs.writeFile(reviewFile, JSON.stringify(review)); await writeReview();
  return { root, store, sourceId, source, artifact, extra, folder, review, reviewFile, writeReview };
}

async function originals(x) {
  const files = [x.source.path, path.join(path.dirname(x.source.path), 'artifact.json'), x.extra.path, path.join(x.folder, 'enhancement.json'), path.join(x.folder, 'receipt.json'), path.join(x.folder, x.artifact.frames[0].path)];
  return Promise.all(files.map(async file => [file, hash(await fs.readFile(file))]));
}

test('追加勘误保护原来源、OCR及人工批注；read返回有效事实与历史证据，旧摘要不复用', async t => {
  const x = await fixture(t); await fs.appendFile(x.source.path, '\n人工批注'); await fs.appendFile(x.extra.path, '\n增强人工批注');
  const before = await originals(x);
  assert.equal((await saveReview(x.store, x.reviewFile)).status, 'saved');
  assert.deepEqual(await originals(x), before);
  const result = await main(['read', '--source-id', x.sourceId, '--store', x.store]);
  assert.equal(result.ok, true); assert.equal(result.source.edited, true);
  const e = result.enhancements[0];
  assert.equal(e.edited, true); assert.equal(e.markdown, null);
  assert.equal(e.effective_summary, '评分4.2星；归档入口');
  assert.equal(e.effective_claims.length, 2); assert.equal(e.effective_claims[0].evidence[0].quote, '评分42%');
  assert.equal(e.effective_claims[0].correction_evidence[0].observed_text, '4.2★');
  assert.equal(e.original_claims[1].text, '容量183G'); assert.equal(e.reviews.length, 1);
  assert.equal((await verifyStore(x.store)).ok, true);
});

test('search旧错误值命中只返回校正或撤回提示；每个命中携带勘误', async t => {
  const x = await fixture(t); await saveReview(x.store, x.reviewFile);
  const score = await searchStore(x.store, '42%');
  assert.equal(score.total, 1); assert.equal(score.matches[0].excerpts[0].text, '评分4.2星');
  assert.equal(score.matches[0].reviews[0].items[0].disposition, 'corrected');
  const removed = await searchStore(x.store, '183G');
  assert.equal(removed.total, 1); assert.equal(removed.matches[0].excerpts[0].field, 'review_notice');
  assert.ok(!removed.matches[0].excerpts.some(item => item.text.includes('183G')));
  assert.equal((await searchStore(x.store, '过时摘要')).total, 0);
  assert.equal((await searchStore(x.store, '4.2星')).total, 1);
  assert.equal((await searchStore(x.store, '配文原始关键词')).matches[0].reviews.length, 1);
});

test('重复与并发只发布同一勘误；不同内容冲突，不覆盖已保存审阅', async t => {
  const x = await fixture(t);
  const results = await Promise.all(Array.from({ length: 5 }, () => saveReview(x.store, x.reviewFile)));
  assert.equal(results.filter(value => value.status === 'saved').length, 1);
  assert.equal(results.filter(value => value.status === 'duplicate').length, 4);
  const before = await fs.readFile(path.join(x.folder, 'ocr-review', 'review.json'));
  x.review.items[0].reason = '另一份审阅'; await x.writeReview();
  await assert.rejects(saveReview(x.store, x.reviewFile), { code: 'REVIEW_CONFLICT' });
  assert.deepEqual(await fs.readFile(path.join(x.folder, 'ocr-review', 'review.json')), before);
  assert.deepEqual(await fs.readdir(path.join(x.store, '.source2brain')), []);
});

test('目标、claim、frame哈希与视觉核对声明不符时拒绝发布', async t => {
  const x = await fixture(t), original = structuredClone(x.review);
  for (const [change, code] of [
    [r => r.enhancement_sha256 = hash('wrong'), 'REVIEW_TARGET_CHANGED'],
    [r => r.items[0].claim_sha256 = hash('wrong'), 'REVIEW_CLAIM_CHANGED'],
    [r => r.items[0].evidence[0].frame_sha256 = hash('wrong'), 'REVIEW_FRAME_CHANGED'],
    [r => { r.reviewer.method = 'ocr_text'; r.reviewer.visual_input_received = false; }, 'INVALID_REVIEW'],
    [r => { r.items[0].claim_index = 99; }, 'REVIEW_CLAIM_CHANGED'],
    [r => { r.source_id = '../elsewhere'; }, 'INVALID_REVIEW']
  ]) {
    Object.assign(x.review, structuredClone(original)); change(x.review); await x.writeReview();
    await assert.rejects(saveReview(x.store, x.reviewFile), { code });
  }
  await assert.rejects(fs.stat(path.join(x.folder, 'ocr-review')), { code: 'ENOENT' });
});

test('纯OCR审阅只能撤回或待定，不虚构看图；待定事实不进入有效事实', async t => {
  const x = await fixture(t);
  x.review.reviewer = { ...x.review.reviewer, method: 'ocr_text', visual_input_received: false };
  x.review.items[0] = { ...x.review.items[0], disposition: 'uncertain', correction: null, evidence: [{ ...x.review.items[0].evidence[0], observed_text: null }] };
  await x.writeReview(); await saveReview(x.store, x.reviewFile);
  const r = await readSource(x.store, x.sourceId);
  assert.deepEqual(r.enhancements[0].effective_claims.map(value => value.text), ['归档入口']);
  assert.match((await searchStore(x.store, '42%')).matches[0].excerpts[0].text, /待定/);
});

test('发布中断保留必读标记并fail closed；同输入复跑恢复，无半份目录', async t => {
  const x = await fixture(t), originalRename = fs.rename;
  fs.rename = async (src, dest) => {
    if (src.includes('/.source2brain/ocr-review-')) throw Object.assign(new Error('合成磁盘错误'), { code: 'EIO' });
    return originalRename(src, dest);
  };
  try { await assert.rejects(saveReview(x.store, x.reviewFile), { code: 'EIO' }); }
  finally { fs.rename = originalRename; }
  assert.deepEqual(await fs.readdir(path.join(x.store, '.source2brain')), []);
  const blocked = await readSource(x.store, x.sourceId);
  assert.equal(blocked.ok, false); assert.equal(blocked.enhancements.length, 0); assert.equal(blocked.issues[0].code, 'REVIEW_MISSING');
  assert.equal((await searchStore(x.store, '42%')).total, 0);
  assert.equal((await searchStore(x.store, '配文原始关键词')).total, 1);
  assert.equal((await saveReview(x.store, x.reviewFile)).status, 'saved');
  assert.equal((await readSource(x.store, x.sourceId)).ok, true);
});

test('勘误缺失、损坏或错绑仅阻断对应增强，旧来源继续可读', async t => {
  const x = await fixture(t); await saveReview(x.store, x.reviewFile);
  const file = path.join(x.folder, 'ocr-review', 'review.json'), original = await fs.readFile(file);
  const edited = JSON.parse(original); edited.items[0].correction = '伪造修改'; await fs.writeFile(file, JSON.stringify(edited));
  assert.equal((await readSource(x.store, x.sourceId)).enhancements.length, 0);
  await fs.writeFile(file, original); await fs.rm(path.join(x.folder, 'ocr-review'), { recursive: true });
  const result = await readSource(x.store, x.sourceId);
  assert.equal(result.issues[0].code, 'REVIEW_MISSING'); assert.equal(result.source.artifact.content.text, '配文原始关键词');
  assert.equal((await searchStore(x.store, '归档')).total, 0);
});

test('旧版无勘误兼容，证据损坏仍受保护；拒绝路径越界与符号链接', async t => {
  const x = await fixture(t), result = await readSource(x.store, x.sourceId);
  assert.equal(result.ok, true); assert.deepEqual(result.enhancements[0].reviews, []);
  assert.equal((await searchStore(x.store, '42%')).total, 1);
  await assert.rejects(readSource(x.store, '../other'), { code: 'INVALID_SOURCE' });
  await fs.symlink(x.reviewFile, path.join(x.folder, 'ocr-review.required.json'));
  await assert.rejects(saveReview(x.store, x.reviewFile), { code: 'UNSAFE_PATH' });
  assert.equal((await readSource(x.store, x.sourceId)).ok, false);
});

test('勘误错挂到另一增强时只阻断错挂目标，正常增强与来源仍可引用', async t => {
  const x = await fixture(t); await saveReview(x.store, x.reviewFile);
  const second = structuredClone(x.artifact); second.parameters = parametersFor(true);
  const file = path.join(x.root, 'input', 'enhancement-retry.json'); await fs.writeFile(file, JSON.stringify(second));
  const saved = await saveEnhancement(x.store, file), folder = path.dirname(saved.path);
  await fs.cp(path.join(x.folder, 'ocr-review'), path.join(folder, 'ocr-review'), { recursive: true });
  await fs.copyFile(path.join(x.folder, 'ocr-review.required.json'), path.join(folder, 'ocr-review.required.json'));
  const result = await readSource(x.store, x.sourceId);
  assert.equal(result.ok, false); assert.equal(result.enhancements.length, 1);
  assert.equal(result.enhancements[0].enhancement_id, x.extra.enhancement_id);
  assert.equal(result.issues[0].enhancement_id, saved.enhancement_id);
  assert.equal(result.issues[0].code, 'REVIEW_TARGET_CHANGED');
  const found = await searchStore(x.store, '4.2星');
  assert.equal(found.total, 1); assert.equal(found.matches[0].enhancement_id, x.extra.enhancement_id);
});
