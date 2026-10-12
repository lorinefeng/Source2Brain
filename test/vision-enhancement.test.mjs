import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { hash, contentHash } from '../lib/artifact.mjs';
import { saveSource, verifyStore } from '../lib/store.mjs';
import { enhancementId, validateEnhancement, saveEnhancement } from '../lib/enhancement.mjs';
import { readSource, saveReview, claimHash } from '../lib/review.mjs';
import { searchStore } from '../lib/search.mjs';
import { main } from '../scripts/brain.mjs';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1kAAAAASUVORK5CYII=', 'base64');
const base = () => ({ schema_version: 1, source: { url: 'https://www.xiaohongshu.com/explore/000000000000000000000001', original_url: 'https://xhslink.cn/o/synthetic', platform: 'xiaohongshu', title: '合成视觉视频', author: null, published_at: null, captured_at: '2026-10-07T00:00:00.000Z' }, content: { type: 'video', text: '视频配文', transcript: '口播没有说图中数字。', visual_notes: '' }, extraction: { status: 'complete', text: 'complete', transcript: 'complete', visuals: 'missing', limitations: ['音频范围'] }, knowledge: { summary: '合成摘要', claims: [], insights: [], actions: [], related_topics: [] }, provenance: { adapter: 'synthetic', model: 'text-only-organizer', steps: ['合成测试'] } });
function pending() {
  const b = base(), sha = hash(png), time = 2.5, id = `frame-${hash(`${sha}:${time}`).slice(0,20)}`;
  return { schema_version: 2, kind: 'source_enhancement', pack: 'media', source: { id: 'xhs-000000000000000000000001', url: b.source.url, title: b.source.title, base_content_sha256: contentHash(b), media_sha256: hash('synthetic-video') }, processor: { adapter: 'source2brain/media-vision-v2', summarize: '0.24.0', vision: 'host-native', runtime_lock_sha256: hash('runtime') }, parameters: { max_frames: 24, scene_threshold: .2, min_duration_seconds: 2 }, coverage: { scope: 'sampled_frames_vision', status: 'partial', frames: 'complete', vision: 'pending', review: 'pending', limitations: ['抽样，尚待实际看图，不代表完整动作理解'] }, frames: [{ id, path: `frames/${id}.png`, sha256: sha, timestamp_seconds: time, vision: { status: 'pending', text: '', description: '', reviewer: null } }], knowledge: { summary: '', claims: [] }, provenance: { model: 'pending', created_at: '2026-10-07T00:00:00.000Z', steps: ['仅抽帧，未做OCR或视觉识读'] } };
}
function complete(mode = 'host-native') {
  const a = pending(); a.processor.vision = mode;
  a.frames[0].vision = { status: 'complete', text: '评分 4.2★\n归档', description: '界面中可读文字', reviewer: { identity: '合成测试视觉执行者', model: 'synthetic-visual-tool-model', tool: mode === 'host-native' ? 'host_view_image' : 'explicit_image_adapter', visual_input_received: true, reviewed_at: '2026-10-07T01:00:00.000Z' } };
  a.coverage = { ...a.coverage, status: 'complete', vision: 'complete', review: 'complete', limitations: ['仅抽样画面文字，未理解连续动作；模型识读可能有误'] };
  a.knowledge = { summary: '画面显示评分4.2星', claims: [{ text: '画面评分为4.2星', evidence: [{ frame_id: a.frames[0].id, quote: '评分 4.2★' }] }] };
  a.provenance.model = 'text-only-organizer'; a.provenance.steps.push('由已确认视觉工具识读，再由文本模型整理');
  return a;
}
async function fixture(t, artifact = pending()) {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 's2b-vision-')); t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const root = await fs.realpath(temp), store = path.join(root, 'store'), input = path.join(root, 'input');
  await fs.mkdir(path.join(input, 'frames'), { recursive: true });
  for (const frame of artifact.frames) await fs.writeFile(path.join(input, frame.path), png);
  const file = path.join(input, 'enhancement.json'); await fs.writeFile(file, JSON.stringify(artifact));
  const source = await saveSource(store, base());
  return { root, store, input, file, source, artifact };
}

test('v2抽帧草稿默认pending；实际看图前不能进入Sources或伪造视觉文字', async t => {
  const a = pending(), x = await fixture(t, a);
  assert.ok(validateEnhancement(a));
  const saved = await saveEnhancement(x.store, x.file);
  assert.equal(saved.status, 'pending'); assert.match(saved.path, /\/Pending\//);
  assert.equal((await readSource(x.store, a.source.id)).enhancements.length, 0);
  for (const change of [v => v.coverage.status = 'complete', v => v.frames[0].vision.text = '读到路径后的猜测', v => { v.frames[0].vision.status = 'complete'; }, v => { v.coverage.vision = 'complete'; }]) {
    const candidate = pending(); change(candidate); assert.throws(() => validateEnhancement(candidate));
  }
});

test('宿主或明确视觉工具均可完成，文本整理模型无需具备图像输入', async t => {
  for (const mode of ['host-native', 'explicit-visual-tool']) {
    const a = complete(mode), x = await fixture(t, a);
    assert.ok(validateEnhancement(a));
    const result = await main(['save-enhancement', '--artifact', x.file, '--store', x.store]);
    assert.equal(result.status, 'saved');
    const read = await main(['read', '--source-id', a.source.id, '--store', x.store]);
    assert.equal(read.ok, true); const extra = read.enhancements[0];
    assert.equal(extra.schema_version, 2); assert.equal(extra.effective_claims[0].status, 'vision_text');
    assert.equal(extra.effective_claims[0].evidence[0].quote_kind, 'vision_text');
    assert.equal(extra.effective_claims[0].evidence[0].reviewer.model, 'synthetic-visual-tool-model');
    assert.equal(extra.effective_claims[0].evidence[0].timestamp_seconds, 2.5);
    assert.equal((await searchStore(x.store, '4.2星')).total, 1);
    assert.equal((await verifyStore(x.store)).ok, true);
    assert.ok(!extra.markdown.includes('OCR 状态'));
  }
});

test('v2拒绝假图像输入、未知供应商标识和非视觉原文引文，不从描述推断文本事实', () => {
  for (const mutate of [
    a => a.frames[0].vision.reviewer.visual_input_received = false,
    a => a.frames[0].vision.reviewer.tool = '',
    a => a.frames[0].vision.reviewer.reviewed_at = 'yesterday',
    a => a.frames[0].vision.reviewer = null,
    a => a.knowledge.claims[0].evidence[0].quote = '界面中可读文字',
    a => a.knowledge.claims[0].evidence[0].quote = '不存在的42%',
    a => a.processor.vision = 'unconfigured-provider'
  ]) { const a = complete(); mutate(a); assert.throws(() => validateEnhancement(a)); }
});

test('空文字视觉帧可保留，但无文本事实不能宣称增强完成；失败帧不混入完成覆盖', async t => {
  const a = complete(); a.frames[0].vision.text = ''; a.knowledge = { summary: '', claims: [] };
  a.coverage.status = 'partial'; assert.ok(validateEnhancement(a));
  const x = await fixture(t, a); assert.equal((await saveEnhancement(x.store, x.file)).status, 'pending');
  a.coverage.status = 'complete'; assert.throws(() => validateEnhancement(a));
  const failed = pending(); failed.frames[0].vision = { status: 'failed', text: '', description: '', reviewer: null, error_code: 'VISION_INPUT_UNAVAILABLE' }; failed.coverage.vision = 'partial';
  assert.ok(validateEnhancement(failed)); failed.coverage.vision = 'complete'; assert.throws(() => validateEnhancement(failed));
});

test('v2原子保存、并发去重和人工批注保护，旧v1身份计算不变', async t => {
  const a = complete(), x = await fixture(t, a);
  await fs.appendFile(x.source.path, '\n人工原笔记'); const before = await fs.readFile(x.source.path);
  const results = await Promise.all(Array.from({ length: 4 }, () => saveEnhancement(x.store, x.file)));
  assert.equal(results.filter(v => v.status === 'saved').length, 1);
  const saved = results[0]; await fs.appendFile(saved.path, '\n人工增强批注');
  a.knowledge.summary = '不应覆盖的措辞'; await fs.writeFile(x.file, JSON.stringify(a));
  assert.equal((await saveEnhancement(x.store, x.file)).status, 'duplicate');
  assert.match(await fs.readFile(saved.path, 'utf8'), /人工增强批注/); assert.deepEqual(await fs.readFile(x.source.path), before);
  const { title, ...source } = a.source;
  const stable = obj => obj && typeof obj === 'object' && !Array.isArray(obj) ? Object.fromEntries(Object.keys(obj).sort().map(k => [k, stable(obj[k])])) : Array.isArray(obj) ? obj.map(stable) : obj;
  const oldShape = { ...a, schema_version: 1 };
  assert.equal(enhancementId(oldShape), `media-${hash(JSON.stringify(stable({ source, processor: a.processor, parameters: a.parameters }))).slice(0,24)}`);
  assert.notEqual(enhancementId(oldShape), enhancementId(a));
  assert.deepEqual(await fs.readdir(path.join(x.store, '.source2brain')), []);
});

test('v2帧损坏/路径越界仍拒绝；旧OCR勘误不能错套到新视觉增强', async t => {
  const a = complete(), x = await fixture(t, a);
  for (const mutate of [v => v.frames[0].path = '../outside.png', v => v.frames[0].timestamp_seconds = -1]) { const v = structuredClone(a); mutate(v); assert.throws(() => validateEnhancement(v)); }
  const saved = await saveEnhancement(x.store, x.file);
  const review = { schema_version: 1, kind: 'ocr_review', source_id: a.source.id, enhancement_id: saved.enhancement_id, enhancement_sha256: hash(JSON.stringify(a)), reviewer: { identity: '合成测试', model: null, method: 'ocr_text', visual_input_received: false, reviewed_at: '2026-10-07T01:00:00Z' }, items: [{ claim_index: 0, claim_sha256: claimHash(a.knowledge.claims[0]), disposition: 'withdraw', reason: '不应套用', correction: null, evidence: [{ frame_id: a.frames[0].id, frame_sha256: a.frames[0].sha256, observed_text: null }] }] };
  const file = path.join(x.root, 'review.json'); await fs.writeFile(file, JSON.stringify(review));
  await assert.rejects(saveReview(x.store, file), { code: 'UNSUPPORTED_REVIEW' });
  await fs.writeFile(path.join(path.dirname(saved.path), a.frames[0].path), Buffer.concat([png, Buffer.from('changed')]));
  assert.equal((await readSource(x.store, a.source.id)).enhancements.length, 0);
  assert.equal((await searchStore(x.store, '4.2')).total, 0);
});

test('同一来源v1勘误与v2视觉结果并存，旧事实撤回不会丢失新视觉证据', async t => {
  const a = complete(), x = await fixture(t, a); await saveEnhancement(x.store, x.file);
  const old = structuredClone(a); old.schema_version = 1;
  old.processor = { adapter: 'source2brain/media-v1', summarize: '0.24.0', ocr: 'tesseract.js@7.0.0', languages: 'chi_sim@1.0.0+eng@1.0.0', runtime_lock_sha256: hash('old-runtime') };
  old.parameters = { ...old.parameters, ocr_languages: 'chi_sim+eng', ocr_psm: 3 };
  old.coverage = { scope: 'sampled_frames_ocr', status: 'complete', frames: 'complete', ocr: 'complete', review: 'complete', limitations: ['历史 OCR'] };
  delete old.frames[0].vision; old.frames[0].ocr = { status: 'complete', text: '评分42%', confidence: .9 };
  old.knowledge = { summary: '旧评分42%', claims: [{ text: '旧评分42%', evidence: [{ frame_id: old.frames[0].id, quote: '评分42%' }] }] };
  const oldFile = path.join(x.input, 'legacy.json'); await fs.writeFile(oldFile, JSON.stringify(old));
  const oldSaved = await saveEnhancement(x.store, oldFile);
  const r = { schema_version: 1, kind: 'ocr_review', source_id: old.source.id, enhancement_id: oldSaved.enhancement_id, enhancement_sha256: hash(JSON.stringify(old)), reviewer: { identity: '合成历史审阅', model: 'text-only-organizer', method: 'ocr_text', visual_input_received: false, reviewed_at: '2026-10-07T01:00:00Z' }, items: [{ claim_index: 0, claim_sha256: claimHash(old.knowledge.claims[0]), disposition: 'uncertain', reason: '历史百分号有疑点', correction: null, evidence: [{ frame_id: old.frames[0].id, frame_sha256: old.frames[0].sha256, observed_text: null }] }] };
  const rFile = path.join(x.root, 'legacy-review.json'); await fs.writeFile(rFile, JSON.stringify(r)); await saveReview(x.store, rFile);
  const read = await readSource(x.store, a.source.id);
  assert.equal(read.ok, true); assert.equal(read.enhancements.length, 2);
  assert.equal(read.enhancements.find(value => value.schema_version === 1).effective_claims.length, 0);
  assert.equal(read.enhancements.find(value => value.schema_version === 2).effective_claims[0].text, '画面评分为4.2星');
  const found = await searchStore(x.store, '42%');
  assert.equal(found.total, 1); assert.equal(found.matches[0].excerpts[0].field, 'review_notice');
  assert.equal((await searchStore(x.store, '4.2星')).total, 1);
  assert.equal((await verifyStore(x.store)).enhancements.length, 2);
});
