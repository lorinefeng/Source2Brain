#!/usr/bin/env node
import fs from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { ocrFrames } from '../lib/media.mjs';
const { values } = parseArgs({ options: { runtime: { type: 'string' }, input: { type: 'string' } } });
try {
  const { frames, output } = JSON.parse(await fs.readFile(values.input, 'utf8'));
  const results = await ocrFrames(frames, output, values.runtime);
  process.stdout.write(`${JSON.stringify({ results })}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({ ok: false, code: error.code || 'OCR_FAILED', message: '本地 OCR 失败，请检查语言包和运行目录' })}\n`);
  process.exitCode = 1;
}
