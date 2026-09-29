#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

// 使用明确的文件清单，安装时不携带 .git、.local、测试样本和机器配置。
const root = fileURLToPath(new URL('../', import.meta.url));
const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'source2brain-skill-'));
const output = path.join(parent, 'source2brain');
await fs.mkdir(output);
for (const name of ['SKILL.md', 'lib', 'references', 'scripts/brain.mjs', 'scripts/transcribe-local.py']) {
  await fs.mkdir(path.dirname(path.join(output, name)), { recursive: true });
  await fs.cp(path.join(root, name), path.join(output, name), { recursive: true, dereference: false, errorOnExist: true });
}
console.log(output);
