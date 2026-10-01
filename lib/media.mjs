import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { hash, requireValue, validateArtifact, contentHash } from './artifact.mjs';
import { resolveHome, readRegular, validateEnhancement } from './enhancement.mjs';
import { run, parseJsonOutput } from './process.mjs';

export const recipeDirectory = fileURLToPath(new URL('../references/extensions/media-runtime/', import.meta.url));
export const mediaRuntime = () => resolveHome(process.env.SOURCE2BRAIN_MEDIA_RUNTIME || '~/.local/share/source2brain/runtime/media');
export const parametersFor = retry => ({ max_frames: retry ? 48 : 24, scene_threshold: retry ? 0.1 : 0.2, min_duration_seconds: 2, ocr_languages: 'chi_sim+eng', ocr_psm: 3, ocr_load_sublangs: '' });
const expectedVersions = { '@steipete/summarize': '0.24.0', 'tesseract.js': '7.0.0', '@tesseract.js-data/chi_sim': '1.0.0', '@tesseract.js-data/eng': '1.0.0' };

export async function languageFiles(runtime) {
  const result = {};
  for (const lang of ['chi_sim', 'eng']) {
    const base = path.join(runtime, 'node_modules', '@tesseract.js-data', lang);
    // npm 官方语言包提供 4.0.0_best_int 数据，运行时完全使用本地副本。
    const file = path.join(base, '4.0.0_best_int', `${lang}.traineddata.gz`);
    await readRegular(file);
    result[lang] = file;
  }
  return result;
}

export async function doctorMedia(runtime = mediaRuntime()) {
  const checks = { node: { status: Number(process.versions.node.split('.')[0]) >= 24 ? 'ok' : 'unsupported', version: process.versions.node } };
  for (const [name, expected] of Object.entries(expectedVersions)) {
    try {
      const pkg = JSON.parse(await readRegular(path.join(runtime, 'node_modules', name, 'package.json')));
      checks[name] = { status: pkg.version === expected ? 'ok' : 'version_mismatch', version: pkg.version, expected };
    } catch { checks[name] = { status: 'missing', expected }; }
  }
  try { await languageFiles(runtime); checks.languages = { status: 'ok', languages: ['chi_sim', 'eng'] }; }
  catch { checks.languages = { status: 'missing' }; }
  let lockHash = null;
  try {
    lockHash = hash(await readRegular(path.join(runtime, 'package-lock.json')));
    checks.lock = { status: lockHash === hash(await fs.readFile(path.join(recipeDirectory, 'package-lock.json'))) ? 'ok' : 'mismatch' };
  } catch { checks.lock = { status: 'missing' }; }
  return { pack: 'media', ready: Object.values(checks).every(c => c.status === 'ok'), checks, runtime, runtime_lock_sha256: lockHash, e2e_verified: false };
}

export async function ocrFrames(frames, output, runtime) {
  const require = createRequire(path.join(runtime, 'package.json'));
  const { createWorker, PSM } = require('tesseract.js');
  const languages = await languageFiles(runtime);
  const localLanguages = path.join(output, 'ocr-languages');
  await fs.mkdir(localLanguages, { mode: 0o700 });
  for (const [lang, source] of Object.entries(languages)) await fs.copyFile(source, path.join(localLanguages, `${lang}.traineddata.gz`), fs.constants.COPYFILE_EXCL);
  let worker;
  try {
    // 仅加载明确选择的两种语言，避免语言包中的隐含子语言初始化告警。
    worker = await createWorker(['chi_sim', 'eng'], 1, { langPath: localLanguages, cachePath: localLanguages, gzip: true }, { tessedit_load_sublangs: '' });
    await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO });
    const results = [];
    for (const frame of frames) {
      try {
        const { data } = await worker.recognize(path.join(output, frame.path));
        requireValue(typeof data.text === 'string' && Number.isFinite(data.confidence), 'INVALID_OCR', 'OCR 缺少文本或置信度');
        results.push({ status: 'complete', text: data.text, confidence: Math.max(0, Math.min(1, data.confidence / 100)) });
      } catch { results.push({ status: 'failed', text: '', confidence: null, error_code: 'OCR_FAILED' }); }
    }
    return results;
  } finally { if (worker) await worker.terminate(); }
}

export async function enhanceVideo(artifactPath, output, { retry = false, runtime = mediaRuntime(), runner = run, checkRuntime = doctorMedia, recognize } = {}) {
  artifactPath = resolveHome(artifactPath); output = resolveHome(output);
  const base = JSON.parse(await readRegular(artifactPath));
  const identity = validateArtifact(base);
  requireValue(base.content.type === 'video', 'NOT_VIDEO', 'media 首轮只处理视频');
  const dependency = await checkRuntime(runtime);
  requireValue(dependency.ready, 'MEDIA_DEPENDENCY_MISSING', 'media 配方未就绪；先 doctor --pack media，再按配方安装');
  const videoPath = base.provenance.media_files?.find(m => m.type === 'video')?.path;
  requireValue(typeof videoPath === 'string' && path.isAbsolute(videoPath) && path.extname(videoPath).toLowerCase() === '.mp4', 'NO_VIDEO', '来源没有可复用的本地 MP4');
  const videoBytes = await readRegular(videoPath);
  requireValue(videoBytes.length > 12 && videoBytes.subarray(4, 8).toString() === 'ftyp', 'INVALID_VIDEO', '本地媒体不是 MP4');
  await fs.mkdir(path.dirname(output), { recursive: true, mode: 0o700 });
  // macOS 临时目录的系统 /var 链接由调用者解析；产物目录自身不能是链接。
  await fs.mkdir(output, { mode: 0o700 });
  output = await fs.realpath(output);
  const params = parametersFor(retry);
  const a = {
    schema_version: 1, kind: 'source_enhancement', pack: 'media',
    source: { id: identity.id, url: identity.canonical, title: base.source.title, base_content_sha256: contentHash(base), media_sha256: hash(videoBytes) },
    processor: { adapter: 'source2brain/media-v1', summarize: '0.24.0', ocr: 'tesseract.js@7.0.0', languages: 'chi_sim@1.0.0+eng@1.0.0', runtime_lock_sha256: dependency.runtime_lock_sha256 },
    parameters: params,
    coverage: { scope: 'sampled_frames_ocr', status: 'partial', frames: 'missing', ocr: 'missing', review: 'pending', limitations: ['仅覆盖抽样关键帧，可能遗漏画面；不理解图表关系和动作', 'OCR 未经逐字校对，置信度不代表事实正确', '尚待 Agent 阅读与整理'] },
    frames: [], knowledge: { summary: '', claims: [] },
    provenance: { model: 'pending', created_at: new Date().toISOString(), steps: ['复用已采集本地视频和原转写，不重新采集、转写或上传媒体'] }
  };
  try {
    const executable = path.join(runtime, 'node_modules', '@steipete/summarize', 'dist', 'cli.js');
    const slidesDir = path.join(output, 'slides');
    const response = await runner(process.execPath, [executable, 'slides', videoPath, '--json', '--output', slidesDir, '--slides-max', String(params.max_frames), '--slides-scene-threshold', String(params.scene_threshold), '--slides-min-duration', '2'], { timeout: 1_200_000, cwd: output });
    const data = parseJsonOutput(response.stdout);
    requireValue(data.ok === true && Array.isArray(data.slides?.slides) && data.slides.slides.length > 0 && data.slides.slides.length <= params.max_frames, 'INVALID_SLIDES', 'summarize 未返回有效的抽样帧');
    await fs.writeFile(path.join(output, 'slides-result.json'), `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    await fs.mkdir(path.join(output, 'frames'), { mode: 0o700 });
    const frames = [];
    for (const slide of data.slides.slides) {
      requireValue(Number.isFinite(slide.timestamp) && slide.timestamp >= 0, 'INVALID_TIMESTAMP', '上游返回无效帧时间戳');
      requireValue(typeof slide.imagePath === 'string' && path.isAbsolute(slide.imagePath), 'UNSAFE_PATH', '上游帧文件必须使用绝对路径');
      const actual = await fs.realpath(slide.imagePath);
      requireValue(actual.startsWith(`${output}${path.sep}`), 'UNSAFE_PATH', '上游帧路径越界');
      const bytes = await readRegular(slide.imagePath);
      requireValue(bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && bytes.length >= 24, 'INVALID_FRAME', '上游没有生成 PNG');
      const digest = hash(bytes), id = `frame-${hash(`${digest}:${slide.timestamp}`).slice(0, 20)}`;
      requireValue(!frames.some(f => f.id === id), 'INVALID_SLIDES', '上游返回重复帧');
      const relative = `frames/${id}.png`;
      await fs.writeFile(path.join(output, relative), bytes, { mode: 0o600, flag: 'wx' });
      frames.push({ id, path: relative, sha256: digest, timestamp_seconds: slide.timestamp, ocr: { status: 'failed', text: '', confidence: null, error_code: 'OCR_NOT_RUN' } });
    }
    a.frames = frames; a.coverage.frames = 'complete';
    a.provenance.steps.push(`summarize 0.24.0 抽帧：${frames.length} 帧，最大 ${params.max_frames} 帧`);
    let results;
    if (recognize) results = await recognize(frames, output, runtime);
    else {
      await fs.writeFile(path.join(output, 'ocr-input.json'), JSON.stringify({ frames, output }), { mode: 0o600, flag: 'wx' });
      const result = await runner(process.execPath, [fileURLToPath(new URL('../scripts/media-ocr.mjs', import.meta.url)), '--runtime', runtime, '--input', path.join(output, 'ocr-input.json')], { timeout: 1_200_000, cwd: output });
      results = parseJsonOutput(result.stdout).results;
    }
    requireValue(Array.isArray(results) && results.length === frames.length, 'INVALID_OCR', 'OCR 结果数量不符');
    requireValue(results.every(r => r && typeof r.text === 'string' && (r.status === 'complete' ? Number.isFinite(r.confidence) && r.confidence >= 0 && r.confidence <= 1 : r.status === 'failed' && r.confidence === null && !r.text && typeof r.error_code === 'string')), 'INVALID_OCR', 'OCR 输出格式无效');
    results.forEach((r, i) => { a.frames[i].ocr = r; });
    a.coverage.ocr = results.every(r => r.status === 'complete') ? 'complete' : results.some(r => r.status === 'complete') ? 'partial' : 'missing';
    a.provenance.steps.push('Tesseract.js 7.0.0 本地中英文 OCR，保留原文与置信度');
    if (a.coverage.ocr !== 'complete') a.coverage.limitations.push('部分帧 OCR 失败');
    if (!results.some(r => r.text.trim())) a.coverage.limitations.push('未识别到可引用文字；空文字帧并不代表识别器失败');
  } catch (error) {
    a.coverage.limitations.push(`媒体增强未完成：${error.code || 'MEDIA_FAILED'}`);
    a.provenance.steps.push(`失败回执：${error.code || 'MEDIA_FAILED'}`);
  }
  validateEnhancement(a);
  const target = path.join(output, 'enhancement.json');
  await fs.writeFile(target, `${JSON.stringify(a, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  return { status: a.coverage.frames === 'complete' && a.coverage.ocr === 'complete' ? 'enhanced_needs_review' : 'partial', artifact: target, frames: a.frames.length, coverage: a.coverage, retry_available: !retry };
}
