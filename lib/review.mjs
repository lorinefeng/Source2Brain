import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { hash, requireValue, validateArtifact, contentHash } from './artifact.mjs';
import { expandHome } from './store.mjs';
import { realDirectory, verifyEnhancementDirectory } from './enhancement.mjs';

const sourcePattern = /^(?:xhs-[a-f0-9]{24}|dy-\d{16,22})$/;
const enhancementPattern = /^media-[a-f0-9]{24}$/;
const isHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const text = value => typeof value === 'string' && Boolean(value.trim());
const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
export const reviewHash = value => hash(JSON.stringify(stable(value)));
export const claimHash = claim => reviewHash(claim);
const present = async file => fs.lstat(file).catch(error => { if (error.code === 'ENOENT') return null; throw error; });

async function regular(file) {
  const stat = await fs.lstat(file);
  requireValue(stat.isFile() && !stat.isSymbolicLink(), 'UNSAFE_PATH', '回读需要普通文件');
  requireValue(stat.size <= 2 * 1024 * 1024, 'REVIEW_FILE_TOO_LARGE', '回读文件超过 2 MiB');
  return fs.readFile(file, 'utf8');
}
const json = async file => JSON.parse(await regular(file));

async function baseSource(store, id) {
  requireValue(sourcePattern.test(id), 'INVALID_SOURCE', '需要有效 source_id');
  const input = expandHome(store), stat = await fs.lstat(input);
  requireValue(stat.isDirectory() && !stat.isSymbolicLink(), 'UNSAFE_PATH', '知识库必须是真实目录');
  const root = await fs.realpath(input), folder = await realDirectory(path.join(root, 'Sources', id));
  const artifact = await json(path.join(folder, 'artifact.json'));
  const identity = validateArtifact(artifact), receipt = await json(path.join(folder, 'receipt.json'));
  requireValue(identity.id === id && artifact.extraction.status === 'complete' && receipt.content_sha256 === contentHash(artifact), 'INVALID_SOURCE', '来源状态或内容与回执不匹配');
  const markdown = await regular(path.join(folder, 'source.md'));
  return { root, folder, artifact, identity, markdown, edited: receipt.markdown_sha256 !== hash(markdown) };
}

export function validateReview(review, artifact) {
  requireValue(review?.schema_version === 1 && review.kind === 'ocr_review', 'INVALID_REVIEW', '需要 OCR 勘误记录');
  requireValue(artifact.schema_version === 1, 'UNSUPPORTED_REVIEW', '当前 OCR 勘误只用于旧 v1 增强，不修改 v2 视觉记录');
  requireValue(sourcePattern.test(review.source_id) && enhancementPattern.test(review.enhancement_id) && isHash(review.enhancement_sha256), 'INVALID_REVIEW', '勘误目标身份无效');
  requireValue(review.source_id === artifact.source.id && review.enhancement_sha256 === hash(JSON.stringify(artifact)), 'REVIEW_TARGET_CHANGED', '勘误没有绑定当前原增强');
  const person = review.reviewer;
  requireValue(person && text(person.identity) && (person.model === null || text(person.model)) && ['human_visual', 'image_tool', 'ocr_text'].includes(person.method) && typeof person.visual_input_received === 'boolean' && typeof person.reviewed_at === 'string' && !Number.isNaN(Date.parse(person.reviewed_at)), 'INVALID_REVIEW', '必须准确记录核对者、实际模型、方法和时间');
  requireValue(person.method === 'ocr_text' ? !person.visual_input_received : person.visual_input_received, 'INVALID_REVIEW', '核对方法与实际图像输入不一致');
  requireValue(Array.isArray(review.items) && review.items.length > 0 && review.items.length <= artifact.knowledge.claims.length, 'INVALID_REVIEW', '需要至少一条有目标的勘误');
  const indices = new Set();
  for (const item of review.items) {
    const claim = artifact.knowledge.claims[item.claim_index];
    requireValue(Number.isInteger(item.claim_index) && item.claim_index >= 0 && claim && !indices.has(item.claim_index) && item.claim_sha256 === claimHash(claim), 'REVIEW_CLAIM_CHANGED', '勘误的事实序号或哈希不匹配');
    indices.add(item.claim_index);
    requireValue(['withdraw', 'uncertain', 'corrected'].includes(item.disposition) && text(item.reason), 'INVALID_REVIEW', '需要勘误结论与理由');
    requireValue(item.disposition === 'corrected' ? text(item.correction) && person.visual_input_received : item.correction === null, 'INVALID_REVIEW', '纠正值需要实际视觉核对；撤回或待定不附猜测值');
    requireValue(Array.isArray(item.evidence) && item.evidence.length > 0, 'INVALID_REVIEW', '勘误需要绑定原事实的帧');
    const frames = new Set();
    for (const ev of item.evidence) {
      const frame = artifact.frames.find(value => value.id === ev.frame_id);
      requireValue(frame && claim.evidence.some(value => value.frame_id === frame.id) && ev.frame_sha256 === frame.sha256 && !frames.has(frame.id), 'REVIEW_FRAME_CHANGED', '勘误帧必须与原事实和文件哈希对应');
      frames.add(frame.id);
      requireValue(ev.observed_text === null || text(ev.observed_text), 'INVALID_REVIEW', '视觉核对原文应为文字或 null');
      requireValue(person.visual_input_received || ev.observed_text === null, 'INVALID_REVIEW', '未看图不能填写视觉核对原文');
      if (item.disposition === 'corrected') requireValue(text(ev.observed_text), 'INVALID_REVIEW', '纠正需保留实际看见的文字，不更改原 OCR');
    }
  }
  return reviewHash(review);
}

function renderReview(review, artifact) {
  return `# OCR 追加勘误\n\n原增强与 OCR 保持不变；引用时以有效事实及本勘误为准。\n\n- 来源：${review.source_id}\n- 增强：${review.enhancement_id}\n- 原增强 SHA256：${review.enhancement_sha256}\n- 核对者：${review.reviewer.identity}\n- 实际模型：${review.reviewer.model ?? '不适用'}\n- 方法：${review.reviewer.method}\n- 实际获得图像：${review.reviewer.visual_input_received}\n\n${review.items.map(item => `## 事实 ${item.claim_index}：${item.disposition}\n\n- 原断言（历史记录，不作为当前事实）：${artifact.knowledge.claims[item.claim_index].text}\n- 理由：${item.reason}\n- 校正：${item.correction ?? '无；不再将原断言作为有效事实'}\n${item.evidence.map(ev => `- 原帧：${ev.frame_id}；SHA256：${ev.frame_sha256}；视觉核对文字：${ev.observed_text ?? '未记录'}`).join('\n')}\n`).join('\n')}`;
}

export async function loadReview(folder, checked) {
  const markerPath = path.join(folder, 'ocr-review.required.json'), reviewFolder = path.join(folder, 'ocr-review');
  const markerExists = await present(markerPath), reviewExists = await present(reviewFolder);
  if (!markerExists && !reviewExists) return null; // 旧版没有勘误，不改变原有兼容性。
  requireValue(markerExists && reviewExists, 'REVIEW_MISSING', '该增强已要求勘误，但标记或勘误目录缺失；暂停引用');
  await realDirectory(reviewFolder);
  const marker = await json(markerPath), review = await json(path.join(reviewFolder, 'review.json'));
  const digest = validateReview(review, checked.artifact);
  requireValue(review.enhancement_id === checked.enhancement_id && marker.schema_version === 1 && marker.review_sha256 === digest, 'REVIEW_TARGET_CHANGED', '勘误身份或必读标记不匹配');
  const receipt = await json(path.join(reviewFolder, 'receipt.json'));
  const markdown = await regular(path.join(reviewFolder, 'review.md'));
  requireValue(receipt.schema_version === 1 && receipt.review_sha256 === digest && receipt.markdown_sha256 === hash(markdown), 'REVIEW_CHANGED', '勘误或回执已损坏；暂停引用');
  return { path: path.join(reviewFolder, 'review.md'), artifact_path: path.join(reviewFolder, 'review.json'), review_sha256: digest, ...review };
}

async function checkedEnhancement(folder, base) {
  const checked = await verifyEnhancementDirectory(folder);
  requireValue(checked.artifact.coverage.status === 'complete' && checked.artifact.source.id === base.identity.id && checked.artifact.source.base_content_sha256 === contentHash(base.artifact), 'INVALID_ENHANCEMENT', '增强来源或状态不匹配');
  return checked;
}

export async function saveReview(store, inputFile) {
  inputFile = expandHome(inputFile);
  const review = await json(inputFile);
  requireValue(sourcePattern.test(review?.source_id) && enhancementPattern.test(review?.enhancement_id), 'INVALID_REVIEW', '勘误目标身份无效');
  const base = await baseSource(store, review.source_id);
  const folder = await realDirectory(path.join(base.folder, 'enhancements', review.enhancement_id));
  const checked = await checkedEnhancement(folder, base), digest = validateReview(review, checked.artifact);
  requireValue(review.enhancement_id === checked.enhancement_id, 'REVIEW_TARGET_CHANGED', '勘误增强 ID 不匹配');
  const dest = path.join(folder, 'ocr-review'), markerPath = path.join(folder, 'ocr-review.required.json');
  const result = status => ({ status, source_id: review.source_id, enhancement_id: review.enhancement_id, review_sha256: digest, path: path.join(dest, 'review.md'), indexed: false });
  const existing = async () => {
    if (!await present(dest)) return null;
    const previous = await loadReview(folder, checked);
    requireValue(previous?.review_sha256 === digest, 'REVIEW_CONFLICT', '该增强已有另一份勘误；原记录保持不变');
    return result('duplicate');
  };
  const duplicate = await existing(); if (duplicate) return duplicate;
  const stageParent = await realDirectory(path.join(base.root, '.source2brain'), true);
  const stage = path.join(stageParent, `ocr-review-${randomUUID()}`);
  await fs.mkdir(stage, { mode: 0o700 });
  try {
    const markdown = renderReview(review, checked.artifact), marker = { schema_version: 1, review_sha256: digest };
    const write = (name, value) => fs.writeFile(path.join(stage, name), value, { flag: 'wx', mode: 0o600 });
    await write('review.json', `${JSON.stringify(review, null, 2)}\n`);
    await write('review.md', markdown);
    await write('receipt.json', `${JSON.stringify({ schema_version: 1, review_sha256: digest, markdown_sha256: hash(markdown), saved_at: new Date().toISOString() }, null, 2)}\n`);
    await write('required.json', `${JSON.stringify(marker)}\n`);
    // 发布前重查原证据；先原子建立必读标记，断电时只让这一份增强暂停引用。
    const current = await checkedEnhancement(folder, await baseSource(store, review.source_id));
    validateReview(review, current.artifact);
    try { await fs.link(path.join(stage, 'required.json'), markerPath); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const previous = await json(markerPath);
      requireValue(previous.schema_version === 1 && previous.review_sha256 === digest, 'REVIEW_CONFLICT', '已有另一份必读勘误；不覆盖');
    }
    try { await fs.rename(stage, dest); }
    catch (error) { if (['EEXIST', 'ENOTEMPTY'].includes(error.code)) return await existing(); throw error; }
    return result('saved');
  } finally { await fs.rm(stage, { recursive: true, force: true }); }
}

function evidenceFor(claim, artifact, folder) {
  return claim.evidence.map(ev => {
    const frame = artifact.frames.find(value => value.id === ev.frame_id);
    return { ...ev, frame_sha256: frame.sha256, frame_path: path.join(folder, frame.path), timestamp_seconds: frame.timestamp_seconds, ...(artifact.schema_version === 2 ? { quote_kind: 'vision_text', reviewer: frame.vision.reviewer } : { ocr_confidence: frame.ocr.confidence, quote_kind: 'original_ocr' }) };
  });
}

export async function readSource(store, sourceId) {
  const base = await baseSource(store, sourceId), enhancements = [], issues = [];
  const extras = path.join(base.folder, 'enhancements');
  if (await present(extras)) {
    await realDirectory(extras);
    for (const id of (await fs.readdir(extras)).sort()) {
      try {
        requireValue(enhancementPattern.test(id), 'INVALID_ENHANCEMENT', '增强目录身份无效');
        const folder = await realDirectory(path.join(extras, id));
        const checked = await checkedEnhancement(folder, base), artifact = checked.artifact;
        const review = await loadReview(folder, checked);
        const effectiveClaims = artifact.knowledge.claims.flatMap((claim, index) => {
          const item = review?.items.find(value => value.claim_index === index);
          if (item && item.disposition !== 'corrected') return [];
          return [{ claim_index: index, claim_sha256: claimHash(claim), status: item ? 'corrected' : artifact.schema_version === 2 ? 'vision_text' : 'original_ocr', text: item?.correction ?? claim.text, evidence: evidenceFor(claim, artifact, folder), ...(item ? { correction_evidence: item.evidence, reviewer: review.reviewer, reason: item.reason } : {}) }];
        });
        enhancements.push({ enhancement_id: id, schema_version: artifact.schema_version, path: path.join(folder, 'enhancement.md'), artifact_path: path.join(folder, 'enhancement.json'), artifact_sha256: hash(JSON.stringify(artifact)), edited: checked.edited, coverage: artifact.coverage, effective_claims: effectiveClaims, effective_summary: effectiveClaims.map(claim => claim.text).join('；') || '没有可继续引用的有效画面事实', original_claims: artifact.knowledge.claims.map((claim, index) => ({ ...claim, claim_index: index, claim_sha256: claimHash(claim), role: artifact.schema_version === 2 ? 'original_vision_record' : 'historical_ocr_record', evidence: evidenceFor(claim, artifact, folder) })), reviews: review ? [review] : [], markdown: review ? null : await regular(path.join(folder, 'enhancement.md')) });
      } catch (error) { issues.push({ source_id: sourceId, enhancement_id: id, code: error.code || 'ERROR', message: '该增强证据或勘误校验失败，已暂停引用；原来源不受影响' }); }
    }
  }
  return { ok: issues.length === 0, source_id: sourceId, source_url: base.identity.canonical, title: base.artifact.source.title, source: { path: path.join(base.folder, 'source.md'), artifact: base.artifact, markdown: base.markdown, edited: base.edited }, enhancements, issues };
}
