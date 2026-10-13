#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

// 明确携带运行与安装依赖；不会复制 .git、.local、模型或机器配置。
export const skillFiles = ['SKILL.md', 'LICENSE', 'README.md', 'package.json', 'integrations.yaml',
  'lib', 'references', 'templates', 'docs/installation.md', 'docs/wechat-recipe.md', 'docs/recovery.md',
  'scripts/brain.mjs', 'scripts/transcribe-local.py', 'scripts/install-media.mjs', 'scripts/media-ocr.mjs',
  'scripts/install-asr.py', 'scripts/package-skill.mjs', 'scripts/bootstrap-macos.sh',
  'scripts/openclaw.sh', 'scripts/runtime-env.sh', 'scripts/configure-openclaw.py'];
const repoRoot = fileURLToPath(new URL('../', import.meta.url));

export async function packageSkill({ root = repoRoot, parent } = {}) {
  root = await fs.realpath(root);
  parent ||= await fs.mkdtemp(path.join(os.tmpdir(), 'source2brain-skill-'));
  const output = path.join(parent, 'source2brain'), copied = new Set();
  await fs.mkdir(output);
  async function copy(rel) {
    if (copied.has(rel)) return;
    const src = path.resolve(root, rel);
    if (!src.startsWith(`${root}${path.sep}`) || /(^|\/)(\.local|\.git|node_modules|__pycache__|video)(\/|$)/.test(rel)) throw new Error(`分发路径不允许：${rel}`);
    const stat = await fs.lstat(src);
    if (stat.isSymbolicLink()) throw new Error(`Skill 包不允许符号链接：${rel}`);
    copied.add(rel);
    if (stat.isDirectory()) {
      await fs.mkdir(path.join(output, rel), { recursive: true });
      for (const name of (await fs.readdir(src)).sort()) await copy(path.join(rel, name));
      return;
    }
    if (!stat.isFile()) throw new Error(`Skill 包只允许普通文件：${rel}`);
    await fs.mkdir(path.dirname(path.join(output, rel)), { recursive: true });
    await fs.copyFile(src, path.join(output, rel), fs.constants.COPYFILE_EXCL);
    // 安装文档的本地引用递归闭合；相对链接缺失即构建失败。
    if (rel.endsWith('.md')) for (const match of (await fs.readFile(src, 'utf8')).matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
      const target = match[1].split('#')[0];
      if (!target || /^(https?:|mailto:)/.test(target)) continue;
      await copy(path.relative(root, path.resolve(path.dirname(src), decodeURIComponent(target))));
    }
  }
  try { for (const rel of skillFiles) await copy(rel); }
  catch (error) { await fs.rm(output, { recursive: true, force: true }); throw error; }
  return output;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(await packageSkill()); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
