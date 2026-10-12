#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { initStore, saveSource, verifyStore, expandHome } from '../lib/store.mjs';
import { captureSource } from '../lib/capture.mjs';
import { validateArtifact, BrainError, requireValue, hash } from '../lib/artifact.mjs';
import { run } from '../lib/process.mjs';
import { doctorMedia, enhanceVideo } from '../lib/media.mjs';
import { saveEnhancement, validateEnhancement } from '../lib/enhancement.mjs';
import { searchStore } from '../lib/search.mjs';
import { doctor } from '../lib/doctor.mjs';
import { saveReview, readSource } from '../lib/review.mjs';

const help = `Source2Brain 0.2 候选\n\nnode scripts/brain.mjs init --store ~/SecondBrain\nnode scripts/brain.mjs capture --message '收藏 https://xhslink.cn/…' --out /tmp/新采集目录\nnode scripts/brain.mjs transcribe --artifact /path/artifact.json [--from /path/transcript.json]\nnode scripts/brain.mjs validate --artifact /path/artifact.json\nnode scripts/brain.mjs save --artifact /path/artifact.json --store ~/SecondBrain\nnode scripts/brain.mjs verify --store ~/SecondBrain\nnode scripts/brain.mjs search --store ~/SecondBrain --query '关键词 同义词' [--limit 10]\nnode scripts/brain.mjs doctor [--message '抖音视频链接']\n\n保存不会调用模型。部分采集只进入 Pending，不进入 Sources。\n`;

export async function main(argv = process.argv.slice(2)) {
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: {
    store: { type: 'string', default: process.env.SOURCE2BRAIN_STORE || '~/SecondBrain' },
    artifact: { type: 'string' }, message: { type: 'string' }, out: { type: 'string' }, from: { type: 'string' }, help: { type: 'boolean' }, 'source-id': { type: 'string' },
    pack: { type: 'string' }, retry: { type: 'boolean', default: false }, query: { type: 'string' }, limit: { type: 'string', default: '10' }, profile: { type: 'string', default: process.env.SOURCE2BRAIN_PROFILE || 'source2brain' }
  } });
  const command = positionals[0];
  if (values.help || !command) return { help: `${help}\n按需 media 扩展（默认仅抽帧，等待宿主原生或用户指定视觉工具实际识读，不自动OCR）：\nnode scripts/brain.mjs doctor --pack media\nnode scripts/brain.mjs enhance --pack media --artifact /path/artifact.json --out /path/new-output [--retry]\nnode scripts/brain.mjs save-enhancement --artifact /path/enhancement.json --store ~/SecondBrain\nnode scripts/brain.mjs save-review --artifact /path/review.json --store ~/SecondBrain\nnode scripts/brain.mjs read --source-id xhs-000000000000000000000001 --store ~/SecondBrain\n` };
  requireValue(positionals.length === 1, 'INVALID_ARGUMENTS', '命令参数请使用命名选项');
  if (values.pack) requireValue(values.pack === 'media' && ['doctor', 'enhance'].includes(command), 'UNSUPPORTED_PACK', '当前只有 doctor/enhance 支持 media 包');
  if (command === 'doctor' && values.pack === 'media') return doctorMedia();
  if (command === 'enhance') {
    requireValue(values.pack === 'media' && values.artifact && values.out, 'INVALID_ARGUMENTS', 'enhance 需要 --pack media、--artifact 和 --out');
    return enhanceVideo(values.artifact, values.out, { retry: values.retry });
  }
  if (command === 'save-enhancement') {
    requireValue(values.artifact, 'INVALID_ARGUMENTS', 'save-enhancement 需要 --artifact');
    return saveEnhancement(values.store, values.artifact);
  }
  if (command === 'save-review') {
    requireValue(values.artifact, 'INVALID_ARGUMENTS', 'save-review 需要 --artifact');
    return saveReview(values.store, values.artifact);
  }
  if (command === 'read') {
    requireValue(values['source-id'], 'INVALID_ARGUMENTS', 'read 需要 --source-id');
    return readSource(values.store, values['source-id']);
  }
  if (command === 'init') return initStore(values.store);
  if (command === 'search') return searchStore(values.store, values.query, { limit: Number(values.limit) });
  if (command === 'verify') return verifyStore(values.store);
  if (command === 'capture') {
    requireValue(values.message && values.out, 'INVALID_ARGUMENTS', 'capture 需要 --message 与 --out');
    return captureSource(values.message, values.out);
  }
  if (command === 'transcribe') {
    requireValue(values.artifact, 'INVALID_ARGUMENTS', 'transcribe 需要 --artifact');
    const artifactPath = expandHome(values.artifact);
    const artifact = JSON.parse(await fs.readFile(artifactPath, 'utf8'));
    validateArtifact(artifact);
    requireValue(artifact.content.type === 'video', 'NOT_VIDEO', '只对视频来源执行转写');
    const folder = await fs.realpath(path.dirname(artifactPath));
    let transcriptPath;
    if (values.from) transcriptPath = expandHome(values.from);
    else {
      requireValue(process.env.SOURCE2BRAIN_ASR_PYTHON, 'ASR_UNCONFIGURED', '请配置 SOURCE2BRAIN_ASR_PYTHON，或使用 --from 读取已有转写 JSON');
      const media = artifact.provenance.media_files?.find(m => m.type === 'video');
      requireValue(media?.path, 'NO_VIDEO', '没有成功下载的视频');
      const video = await fs.realpath(media.path);
      requireValue(video.startsWith(`${folder}${path.sep}`), 'UNSAFE_PATH', '只处理当前采集目录中的视频');
      if (media.sha256 !== undefined) requireValue(media.sha256 === hash(await fs.readFile(video)), 'MEDIA_CHANGED', '视频已偏离采集时的哈希，转写已停止');
      transcriptPath = path.join(folder, `transcript-${Date.now()}.json`);
      const args = [fileURLToPath(new URL('./transcribe-local.py', import.meta.url)), video, '--output', transcriptPath];
      if (process.env.SOURCE2BRAIN_ASR_MODEL_ROOT) args.push('--model-root', expandHome(process.env.SOURCE2BRAIN_ASR_MODEL_ROOT));
      await run(expandHome(process.env.SOURCE2BRAIN_ASR_PYTHON), args, { timeout: 1_200_000 });
    }
    const transcript = JSON.parse(await fs.readFile(transcriptPath, 'utf8'));
    requireValue(typeof transcript.text === 'string' && transcript.text.trim() && typeof transcript.model === 'string', 'EMPTY_TRANSCRIPT', '转写文件缺少正文或模型来源');
    artifact.content.transcript = transcript.text;
    artifact.extraction.transcript = 'complete';
    artifact.extraction.limitations = ['语音识别结果未经逐字校对；只覆盖音频，不包含视频画面'];
    artifact.provenance.steps.push(`本地 ASR：${transcript.model}`);
    artifact.provenance.transcript_file = transcriptPath;
    // 转写完成仍需 LLM 审阅、整理摘要，不能自动晋级 complete。
    const output = expandHome(values.out || path.join(folder, 'artifact-transcribed.json'));
    await fs.writeFile(output, `${JSON.stringify(artifact, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    return { status: 'transcribed_needs_summary', artifact: output, characters: transcript.text.length };
  }
  if (['save', 'validate'].includes(command)) {
    requireValue(values.artifact, 'INVALID_ARGUMENTS', '需要 --artifact');
    const artifact = JSON.parse(await fs.readFile(expandHome(values.artifact), 'utf8'));
    if (command === 'validate') return artifact.kind === 'source_enhancement'
      ? { status: 'valid', ...validateEnhancement(artifact), extraction: artifact.coverage.status }
      : { status: 'valid', ...validateArtifact(artifact), extraction: artifact.extraction.status };
    return saveSource(values.store, artifact);
  }
  if (command === 'doctor') {
    return doctor({ store: values.store, profile: values.profile, message: values.message });
  }
  throw new BrainError('UNKNOWN_COMMAND', '未知命令；使用 --help 查看用法');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { const result = await main(); process.stdout.write(`${JSON.stringify(result, null, 2)}\n`); if (result.ok === false) process.exitCode = 1; }
  catch (e) { process.stderr.write(`${JSON.stringify({ ok: false, code: e.code || 'ERROR', message: e.message })}\n`); process.exitCode = 1; }
}
