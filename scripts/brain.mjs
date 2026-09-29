#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { initStore, saveSource, verifyStore, expandHome } from '../lib/store.mjs';
import { captureXhs } from '../lib/capture.mjs';
import { validateArtifact, BrainError, requireValue } from '../lib/artifact.mjs';
import { run, parseJsonOutput } from '../lib/process.mjs';

const help = `Source2Brain 0.1\n\nnode scripts/brain.mjs init --store ~/SecondBrain\nnode scripts/brain.mjs capture --message '收藏 https://xhslink.cn/…' --out /tmp/新采集目录\nnode scripts/brain.mjs transcribe --artifact /path/artifact.json [--from /path/transcript.json]\nnode scripts/brain.mjs validate --artifact /path/artifact.json\nnode scripts/brain.mjs save --artifact /path/artifact.json --store ~/SecondBrain\nnode scripts/brain.mjs verify --store ~/SecondBrain\nnode scripts/brain.mjs doctor\n\n保存不会调用模型。部分采集只进入 Pending，不进入 Sources。\n`;

export async function main(argv = process.argv.slice(2)) {
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: {
    store: { type: 'string', default: process.env.SOURCE2BRAIN_STORE || '~/SecondBrain' },
    artifact: { type: 'string' }, message: { type: 'string' }, out: { type: 'string' }, from: { type: 'string' }, help: { type: 'boolean' }
  } });
  const command = positionals[0];
  if (values.help || !command) return { help };
  requireValue(positionals.length === 1, 'INVALID_ARGUMENTS', '命令参数请使用命名选项');
  if (command === 'init') return initStore(values.store);
  if (command === 'verify') return verifyStore(values.store);
  if (command === 'capture') {
    requireValue(values.message && values.out, 'INVALID_ARGUMENTS', 'capture 需要 --message 与 --out');
    return captureXhs(values.message, values.out);
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
      transcriptPath = path.join(folder, `transcript-${Date.now()}.json`);
      await run(expandHome(process.env.SOURCE2BRAIN_ASR_PYTHON), [fileURLToPath(new URL('./transcribe-local.py', import.meta.url)), video, '--output', transcriptPath], { timeout: 1_200_000 });
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
    if (command === 'validate') return { status: 'valid', ...validateArtifact(artifact), extraction: artifact.extraction.status };
    return saveSource(values.store, artifact);
  }
  if (command === 'doctor') {
    const checks = {};
    for (const [name, args] of [['node', ['--version']], ['agent-reach', ['doctor', '--json']], ['opencli', ['--version']], ['openclaw', ['--version']]]) {
      try {
        const { stdout } = await run(name, args);
        checks[name] = name === 'agent-reach' ? parseJsonOutput(stdout).xiaohongshu : { status: 'ok', version: stdout.trim().split('\n')[0] };
      } catch (e) { checks[name] = { status: 'missing_or_failed', code: e.code }; }
    }
    return { checks, capture_ready: checks['agent-reach']?.status === 'ok' && checks.opencli.status === 'ok', e2e_verified: false };
  }
  throw new BrainError('UNKNOWN_COMMAND', '未知命令；使用 --help 查看用法');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { const result = await main(); process.stdout.write(`${JSON.stringify(result, null, 2)}\n`); if (result.ok === false) process.exitCode = 1; }
  catch (e) { process.stderr.write(`${JSON.stringify({ ok: false, code: e.code || 'ERROR', message: e.message })}\n`); process.exitCode = 1; }
}
