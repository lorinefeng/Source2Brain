#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { createJob, listJobs, statusJob, resumeJob, recordJob } from '../lib/jobs.mjs';
import { transcribeArtifact } from '../lib/transcribe.mjs';
import { failure } from '../lib/reliability.mjs';
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

const help = `Source2Brain 0.3 恢复接口\n\nnode scripts/brain.mjs init --store ~/SecondBrain\nnode scripts/brain.mjs capture --message '收藏 https://xhslink.cn/…' --out /tmp/新采集目录\nnode scripts/brain.mjs transcribe --artifact /path/artifact.json [--from /path/transcript.json]\nnode scripts/brain.mjs validate --artifact /path/artifact.json\nnode scripts/brain.mjs save --artifact /path/artifact.json --store ~/SecondBrain\nnode scripts/brain.mjs verify --store ~/SecondBrain\nnode scripts/brain.mjs search --store ~/SecondBrain --query '关键词 同义词' [--limit 10]\nnode scripts/brain.mjs job create --message '单个分享链接' --scope '<可信会话范围>' [--requirements video|audio]\nnode scripts/brain.mjs job list|status|resume|record --scope '<可信会话范围>' [--id <任务号>]\nnode scripts/brain.mjs doctor [--message '抖音视频链接']\n\n保存不会调用模型。部分采集只进入 Pending，不进入 Sources。\n`;

export async function main(argv = process.argv.slice(2)) {
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: {
    store: { type: 'string', default: process.env.SOURCE2BRAIN_STORE || '~/SecondBrain' },
    artifact: { type: 'string' }, message: { type: 'string' }, out: { type: 'string' }, from: { type: 'string' }, help: { type: 'boolean' }, 'source-id': { type: 'string' },
    scope: { type: 'string' }, id: { type: 'string' }, requirements: { type: 'string', default: 'video' }, 'action-id': { type: 'string' }, result: { type: 'string' }, resend: { type: 'boolean', default: false }, pack: { type: 'string' }, retry: { type: 'boolean', default: false }, query: { type: 'string' }, limit: { type: 'string', default: '10' }, profile: { type: 'string', default: process.env.SOURCE2BRAIN_PROFILE || 'source2brain' }
  } });
  const command = positionals[0];
  if (values.help || !command) return { help: `${help}\n按需 media 扩展（默认仅抽帧，等待宿主原生或用户指定视觉工具实际识读，不自动OCR）：\nnode scripts/brain.mjs doctor --pack media\nnode scripts/brain.mjs enhance --pack media --artifact /path/artifact.json --out /path/new-output [--retry]\nnode scripts/brain.mjs save-enhancement --artifact /path/enhancement.json --store ~/SecondBrain\nnode scripts/brain.mjs save-review --artifact /path/review.json --store ~/SecondBrain\nnode scripts/brain.mjs read --source-id xhs-000000000000000000000001 --store ~/SecondBrain\n` };
  if (command === 'job') {
    const action = positionals[1];
    requireValue(positionals.length === 2, 'INVALID_ARGUMENTS', 'job 需要 create/list/status/resume/record');
    const options = {store:values.store,profile:values.profile,scope:values.scope,id:values.id,message:values.message,requirements:values.requirements,resend:values.resend,actionId:values['action-id'],resultFile:values.result};
    if (action === 'create') return createJob(options);
    if (action === 'list') return listJobs(options);
    if (action === 'status') return statusJob(options);
    if (action === 'resume') return resumeJob(options);
    if (action === 'record') { requireValue(values.result && values['action-id'], 'INVALID_ARGUMENTS', 'record 需要 --result 与 --action-id'); return recordJob(options); }
    throw new BrainError('INVALID_ARGUMENTS', '未知 job 操作');
  }
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
    return transcribeArtifact(values.artifact, {from:values.from,out:values.out});
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

const commandSafeStage = argv => ['capture','transcribe','enhance','save','save-enhancement','job'].includes(argv[0]) ? argv[0] : 'cli';

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { const result = await main(); process.stdout.write(`${JSON.stringify(result, null, 2)}\n`); if (result.ok === false) process.exitCode = 1; }
  catch (e) { process.stderr.write(`${JSON.stringify({ ok: false, ...failure(e, commandSafeStage(process.argv.slice(2))), message: '处理未完成；请按错误码与 next_action 恢复。' })}\n`); process.exitCode = 1; }
}
