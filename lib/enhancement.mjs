import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { requireValue, hash, parseSourceUrl, validateArtifact, contentHash } from './artifact.mjs';

const requireHash = value => requireValue(typeof value === 'string' && /^[a-f0-9]{64}$/.test(value), 'INVALID_ENHANCEMENT', '需要 SHA-256 摘要');
const string = value => typeof value === 'string' && value.trim().length > 0;
const plain = value => value.replaceAll('\r', '').replaceAll('\n', ' ').replace(/[<>]/g, '');
const literal = value => {
  const fence = '`'.repeat(Math.max(3, ...[...value.matchAll(/`+/g)].map(m => m[0].length + 1)));
  return `${fence}text\n${value}\n${fence}`;
};
export const resolveHome = value => path.resolve(value === '~' ? os.homedir() : value.startsWith('~/') ? path.join(os.homedir(), value.slice(2)) : value);

// 对保存位置的每个组件检查符号链接，避免沿已有链接写入其他目录。
export async function realDirectory(folder, create = false) {
  folder = path.resolve(folder);
  let current = path.parse(folder).root;
  for (const part of folder.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    if (create) await fs.mkdir(current, { mode: 0o700 }).catch(e => { if (e.code !== 'EEXIST') throw e; });
    const stat = await fs.lstat(current);
    requireValue(stat.isDirectory() && !stat.isSymbolicLink(), 'UNSAFE_PATH', '目录不能包含符号链接');
  }
  return folder;
}

export async function readRegular(file) {
  const stat = await fs.lstat(file);
  requireValue(stat.isFile() && !stat.isSymbolicLink(), 'UNSAFE_PATH', '需要普通文件，不能是符号链接');
  return fs.readFile(file);
}

export function enhancementId(a) {
  const stable = value => value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]))
    : Array.isArray(value) ? value.map(stable) : value;
  const { title, ...source } = a.source;
  // 标题、字段顺序、知识措辞和执行时间不制造重复增强。
  return `media-${hash(JSON.stringify(stable({ source, processor: a.processor, parameters: a.parameters, ...(a.schema_version === 2 ? { schema_version: 2 } : {}) }))).slice(0, 24)}`;
}

export function validateEnhancement(a) {
  requireValue([1, 2].includes(a?.schema_version) && a.kind === 'source_enhancement' && a.pack === 'media', 'INVALID_ENHANCEMENT', '需要 SourceEnhancement v1/v2 media 结果');
  const vision = a.schema_version === 2;
  const { source: s, processor: p, parameters: params, coverage: c, frames, knowledge: k, provenance: prov } = a;
  requireValue(s && p && params && c && k && prov, 'INVALID_ENHANCEMENT', '增强结果缺少必需字段');
  const parsed = parseSourceUrl(s.url);
  requireValue(!parsed.short && s.url === parsed.canonical && s.id === parsed.source_id && string(s.title), 'INVALID_ENHANCEMENT', '原来源身份不一致');
  requireHash(s.base_content_sha256); requireHash(s.media_sha256);
  requireValue(string(p.adapter) && string(p.summarize) && (vision ? ['host-native', 'explicit-visual-tool'].includes(p.vision) : string(p.ocr) && string(p.languages)), 'INVALID_ENHANCEMENT', '必须记录实际抽帧工具和识读方式');
  requireHash(p.runtime_lock_sha256);
  requireValue([24, 48].includes(params.max_frames) && params.scene_threshold === (params.max_frames === 24 ? 0.2 : 0.1) && params.min_duration_seconds === 2, 'INVALID_ENHANCEMENT', '不支持的 media 抽样配方');
  if (!vision) {
    requireValue(params.ocr_languages === 'chi_sim+eng' && params.ocr_psm === 3, 'INVALID_ENHANCEMENT', '不支持的 OCR 配方');
    requireValue(params.ocr_load_sublangs === undefined || params.ocr_load_sublangs === '', 'INVALID_ENHANCEMENT', '不支持隐式加载额外 OCR 语言');
  }
  requireValue(c.scope === (vision ? 'sampled_frames_vision' : 'sampled_frames_ocr') && ['complete', 'partial'].includes(c.status) && ['complete', 'missing'].includes(c.frames) && ['pending', 'complete'].includes(c.review), 'INVALID_ENHANCEMENT', '覆盖状态无效');
  requireValue(vision ? ['pending', 'partial', 'complete'].includes(c.vision) : ['complete', 'partial', 'missing'].includes(c.ocr), 'INVALID_ENHANCEMENT', '识读覆盖状态无效');
  requireValue(Array.isArray(c.limitations) && c.limitations.length > 0 && c.limitations.every(string), 'INVALID_ENHANCEMENT', '必须声明抽样与识读限制');
  requireValue(Array.isArray(frames) && frames.length <= params.max_frames, 'INVALID_ENHANCEMENT', '帧数量超出配方上限');
  const ids = new Set(), files = new Set();
  for (const f of frames) {
    requireHash(f.sha256);
    requireValue(Number.isFinite(f.timestamp_seconds) && f.timestamp_seconds >= 0, 'INVALID_TIMESTAMP', '帧时间戳必须是非负秒数');
    const expectedId = `frame-${hash(`${f.sha256}:${f.timestamp_seconds}`).slice(0, 20)}`;
    requireValue(f.id === expectedId && f.path === `frames/${f.id}.png` && !ids.has(f.id) && !files.has(f.path), 'INVALID_FRAME', '帧 ID、路径或唯一性无效');
    ids.add(f.id); files.add(f.path);
    if (vision) {
      const v = f.vision;
      requireValue(v && ['pending', 'complete', 'failed'].includes(v.status) && typeof v.text === 'string' && typeof v.description === 'string', 'INVALID_VISION', '需要逐帧视觉识读状态、原文与必要描述');
      if (v.status === 'complete') {
        const r = v.reviewer;
        requireValue(r && string(r.identity) && (r.model === null || string(r.model) && r.model !== 'pending') && string(r.tool) && r.visual_input_received === true && typeof r.reviewed_at === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(r.reviewed_at) && !Number.isNaN(Date.parse(r.reviewed_at)), 'VISION_NOT_REVIEWED', '视觉完成须记录真实图像输入、工具、核对者与时间；读到路径不算看图');
      } else {
        requireValue(!v.text && !v.description && v.reviewer === null, 'VISION_NOT_REVIEWED', '未实际看图的帧不能附识读文字或核图者');
        if (v.status === 'failed') requireValue(string(v.error_code), 'INVALID_VISION', '视觉读取失败需要错误码');
      }
    } else {
      requireValue(f.ocr && ['complete', 'failed'].includes(f.ocr.status) && typeof f.ocr.text === 'string', 'INVALID_OCR', 'OCR 输出无效');
      requireValue(f.ocr.status === 'failed' ? f.ocr.confidence === null && !f.ocr.text && string(f.ocr.error_code) : Number.isFinite(f.ocr.confidence) && f.ocr.confidence >= 0 && f.ocr.confidence <= 1, 'INVALID_OCR', 'OCR 置信度或失败状态无效');
    }
  }
  requireValue(c.frames !== 'complete' || frames.length > 0, 'INCOMPLETE_ENHANCEMENT', '没有实际帧');
  requireValue((vision ? c.vision : c.ocr) !== 'complete' || (frames.length > 0 && frames.every(f => (vision ? f.vision : f.ocr).status === 'complete')), 'INCOMPLETE_ENHANCEMENT', '部分帧未识读或失败不能标为完成');
  requireValue(typeof k.summary === 'string' && Array.isArray(k.claims), 'INVALID_ENHANCEMENT', '缺少增强摘要与事实');
  for (const claim of k.claims) {
    requireValue(string(claim.text) && Array.isArray(claim.evidence) && claim.evidence.length > 0, 'UNSUPPORTED_CLAIM', '新增事实必须有帧证据');
    for (const ev of claim.evidence) {
      const frame = frames.find(f => f.id === ev.frame_id);
      const recognized = vision ? frame?.vision : frame?.ocr;
      requireValue(recognized?.status === 'complete' && string(ev.quote) && recognized.text.includes(ev.quote), 'UNSUPPORTED_CLAIM', vision ? '引文必须逐字存在于该帧经实际图像输入的视觉识读文字中' : '引文必须逐字存在于该帧 OCR 中');
    }
  }
  requireValue(string(prov.model) && Array.isArray(prov.steps) && prov.steps.length > 0 && prov.steps.every(string) && typeof prov.created_at === 'string' && !Number.isNaN(Date.parse(prov.created_at)), 'INVALID_ENHANCEMENT', '缺少真实处理记录');
  if (c.status === 'complete') requireValue(c.frames === 'complete' && (vision ? c.vision : c.ocr) === 'complete' && c.review === 'complete' && k.summary.trim() && k.claims.length > 0 && prov.model !== 'pending', 'INCOMPLETE_ENHANCEMENT', '抽帧、实际识读与 Agent 整理都完成后才可进入检索');
  return { id: enhancementId(a), source_id: s.id };
}

export async function checkFrameFiles(a, folder) {
  await realDirectory(folder);
  if (a.frames.length) await realDirectory(path.join(folder, 'frames'));
  for (const f of a.frames) {
    const bytes = await readRegular(path.join(folder, f.path));
    requireValue(bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && bytes.length >= 24, 'INVALID_FRAME', '附件不是 PNG 帧');
    requireValue(hash(bytes) === f.sha256, 'FRAME_CHANGED', '帧附件与记录的摘要不一致');
  }
}

export function renderEnhancement(a) {
  const { id } = validateEnhancement(a);
  if (a.schema_version === 2) return renderVisionEnhancement(a, id);
  const meta = { type: 'source_enhancement', source_id: a.source.id, source_url: a.source.url, enhancement_id: id, coverage: a.coverage.scope, extraction_status: a.coverage.status };
  const evidence = a.knowledge.claims.map(claim => `- ${plain(claim.text)}\n${claim.evidence.map(ev => {
    const f = a.frames.find(frame => frame.id === ev.frame_id);
    return `  - 画面证据：${f.timestamp_seconds.toFixed(2)} 秒，[帧 ${f.id}](${f.path})；OCR 原文：${plain(ev.quote)}`;
  }).join('\n')}`).join('\n');
  return `---\n${Object.entries(meta).map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join('\n')}\n---\n\n# ${plain(a.source.title)}：画面补充\n\n- 原链接：${a.source.url}\n- 原笔记：[来源正文](../../source.md)\n- 覆盖范围：抽样关键帧与 OCR，未进行图表关系或动作理解。\n- 限制：${a.coverage.limitations.map(plain).join('；')}\n\n## 新增信息（AI 整理，OCR 未经逐字校对）\n\n${a.knowledge.summary}\n\n## 带画面证据的事实\n\n${evidence || '暂无可引用事实。'}\n\n## 帧与 OCR 原文（不可信来源材料）\n\n${a.frames.map(f => `### ${f.timestamp_seconds.toFixed(2)} 秒 · ${f.id}\n\n![视频帧](${f.path})\n\nOCR 状态：${f.ocr.status}；置信度：${f.ocr.confidence ?? '未知'}\n\n${literal(f.ocr.text)}\n`).join('\n')}\n## 处理记录\n\n- summarize：${plain(a.processor.summarize)}\n- OCR：${plain(a.processor.ocr)}\n- 整理模型：${plain(a.provenance.model)}\n${a.provenance.steps.map(s => `- ${plain(s)}`).join('\n')}\n`;
}

function renderVisionEnhancement(a, id) {
  const meta = { type: 'source_enhancement', schema_version: 2, source_id: a.source.id, source_url: a.source.url, enhancement_id: id, coverage: a.coverage.scope, extraction_status: a.coverage.status };
  const claims = a.knowledge.claims.map(claim => `- ${plain(claim.text)}\n${claim.evidence.map(ev => {
    const frame = a.frames.find(f => f.id === ev.frame_id);
    return `  - ${frame.timestamp_seconds.toFixed(2)} 秒，[帧 ${frame.id}](${frame.path})；视觉识读原文：${plain(ev.quote)}`;
  }).join('\n')}`).join('\n');
  const frames = a.frames.map(frame => {
    const v = frame.vision, r = v.reviewer;
    return `### ${frame.timestamp_seconds.toFixed(2)} 秒 · ${frame.id}\n\n![视频帧](${frame.path})\n\n视觉状态：${v.status}\n\n${literal(v.text)}\n\n可见描述（模型识读）：${plain(v.description)}\n\n- 实际核对者：${plain(r?.identity ?? '未核对')}\n- 模型：${plain(r?.model ?? '未知或不适用')}\n- 视觉输入工具：${plain(r?.tool ?? '无')}\n- 实际获得图像：${r?.visual_input_received === true}\n- 核对时间：${r?.reviewed_at ?? '无'}\n`;
  }).join('\n');
  return `---\n${Object.entries(meta).map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join('\n')}\n---\n\n# ${plain(a.source.title)}：画面补充\n\n- 原链接：${a.source.url}\n- 原笔记：[来源正文](../../source.md)\n- 覆盖范围：抽样帧的视觉识读；不代表全片或连续动作理解。\n- 限制：${a.coverage.limitations.map(plain).join('；')}\n\n## 新增信息（AI 整理）\n\n${a.knowledge.summary}\n\n## 带画面证据的事实\n\n${claims}\n\n## 帧与视觉识读原文（不可信来源材料）\n\n${frames}\n## 处理记录\n\n- summarize：${plain(a.processor.summarize)}\n- 识读方式：${a.processor.vision === 'explicit-visual-tool' ? '用户明确指定的视觉工具' : '现有宿主原生视觉能力'}\n- 整理模型：${plain(a.provenance.model)}\n${a.provenance.steps.map(step => `- ${plain(step)}`).join('\n')}\n`;
}

export async function verifyEnhancementDirectory(folder) {
  await realDirectory(folder);
  const a = JSON.parse(await readRegular(path.join(folder, 'enhancement.json')));
  const { id } = validateEnhancement(a);
  requireValue(path.basename(folder) === id, 'INVALID_ENHANCEMENT', '增强目录身份不匹配');
  const receipt = JSON.parse(await readRegular(path.join(folder, 'receipt.json')));
  requireValue(receipt.artifact_sha256 === hash(JSON.stringify(a)), 'ARTIFACT_CHANGED', '增强结果与回执不一致');
  await checkFrameFiles(a, folder);
  let edited = false;
  if (a.coverage.status === 'complete') edited = receipt.markdown_sha256 !== hash(await readRegular(path.join(folder, 'enhancement.md')));
  return { enhancement_id: id, artifact: a, edited };
}

export async function saveEnhancement(root, artifactPath) {
  root = resolveHome(root); artifactPath = resolveHome(artifactPath);
  // 接受系统 /tmp、/var 别名；知识库本身和库内目录仍拒绝符号链接。
  const rootStat = await fs.lstat(root);
  requireValue(rootStat.isDirectory() && !rootStat.isSymbolicLink(), 'UNSAFE_PATH', '知识库必须是真实目录');
  root = await fs.realpath(root);
  artifactPath = path.join(await fs.realpath(path.dirname(artifactPath)), path.basename(artifactPath));
  const a = JSON.parse(await readRegular(artifactPath));
  const { id, source_id } = validateEnhancement(a);
  await checkFrameFiles(a, path.dirname(artifactPath));
  const baseDir = await realDirectory(path.join(root, 'Sources', source_id));
  const base = JSON.parse(await readRegular(path.join(baseDir, 'artifact.json')));
  const baseReceipt = JSON.parse(await readRegular(path.join(baseDir, 'receipt.json')));
  requireValue(validateArtifact(base).id === source_id && base.extraction.status === 'complete' && contentHash(base) === a.source.base_content_sha256 && baseReceipt.content_sha256 === contentHash(base), 'BASE_CHANGED', '原来源已改变或未完成，不能附加到错误版本');
  const partial = a.coverage.status !== 'complete';
  const parent = await realDirectory(path.join(root, partial ? 'Pending' : 'Sources', source_id, 'enhancements'), true);
  const stageParent = await realDirectory(path.join(root, '.source2brain'), true);
  const dest = path.join(parent, id);
  const result = status => ({ status, source_id, enhancement_id: id, path: path.join(dest, partial ? 'enhancement.json' : 'enhancement.md'), indexed: false });
  const existing = async () => {
    if (!(await fs.lstat(dest).catch(e => { if (e.code === 'ENOENT') return null; throw e; }))) return null;
    await verifyEnhancementDirectory(dest);
    return result(partial ? 'pending_duplicate' : 'duplicate');
  };
  const duplicate = await existing(); if (duplicate) return duplicate;
  const stage = path.join(stageParent, `enhancement-${randomUUID()}`);
  await fs.mkdir(stage, { mode: 0o700 });
  try {
    if (a.frames.length) await fs.mkdir(path.join(stage, 'frames'), { mode: 0o700 });
    for (const f of a.frames) {
      const bytes = await readRegular(path.join(path.dirname(artifactPath), f.path));
      requireValue(hash(bytes) === f.sha256, 'FRAME_CHANGED', '复制期间帧附件发生变化');
      await fs.writeFile(path.join(stage, f.path), bytes, { flag: 'wx', mode: 0o600 });
    }
    const markdown = partial ? null : renderEnhancement(a);
    await fs.writeFile(path.join(stage, 'enhancement.json'), `${JSON.stringify(a, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    if (markdown) await fs.writeFile(path.join(stage, 'enhancement.md'), markdown, { flag: 'wx', mode: 0o600 });
    await fs.writeFile(path.join(stage, 'receipt.json'), `${JSON.stringify({ schema_version: 1, artifact_sha256: hash(JSON.stringify(a)), markdown_sha256: markdown ? hash(markdown) : null, saved_at: new Date().toISOString(), indexed: false }, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    try { await fs.rename(stage, dest); }
    catch (e) { if (['EEXIST', 'ENOTEMPTY'].includes(e.code)) return await existing(); throw e; }
    return result(partial ? 'pending' : 'saved');
  } finally { await fs.rm(stage, { recursive: true, force: true }); }
}
