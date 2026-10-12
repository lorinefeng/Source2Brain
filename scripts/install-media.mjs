#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { doctorMedia, mediaRuntime, recipeDirectory } from '../lib/media.mjs';
import { realDirectory, resolveHome } from '../lib/enhancement.mjs';
import { requireValue } from '../lib/artifact.mjs';
import { run } from '../lib/process.mjs';

export async function installMedia(runtime = mediaRuntime(), { runner = run, checkRuntime = doctorMedia } = {}) {
  runtime = resolveHome(runtime);
  requireValue(Number(process.versions.node.split('.')[0]) >= 24, 'NODE_UNSUPPORTED', 'media 配方要求 Node 24+；基础收藏不受影响');
  const current = await checkRuntime(runtime);
  if (current.ready) return { status: 'reused', ...current };
  const parent = await realDirectory(path.dirname(runtime), true);
  const lock = `${runtime}.install-lock`;
  await fs.mkdir(lock, { mode: 0o700 });
  const stage = path.join(parent, `media-install-${randomUUID()}`);
  let backup = null;
  try {
    await fs.mkdir(stage, { mode: 0o700 });
    for (const name of ['package.json', 'package-lock.json']) await fs.copyFile(path.join(recipeDirectory, name), path.join(stage, name), fs.constants.COPYFILE_EXCL);
    // 固定锁只含抽帧工具及其依赖，不安装 OCR 语言包或任何视觉模型。
    await runner(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: stage, timeout: 1_200_000 });
    const ready = await checkRuntime(stage);
    requireValue(ready.ready, 'MEDIA_INSTALL_INCOMPLETE', 'media 依赖安装后检查未通过，原运行目录已保留');
    const packages = JSON.parse(await fs.readFile(path.join(stage, 'package-lock.json'), 'utf8')).packages;
    await fs.writeFile(path.join(stage, 'install-receipt.json'), `${JSON.stringify({ schema_version: 2, mode: 'frames-only', automatic_ocr: false, vision_status: 'not_probed', installed_at: new Date().toISOString(), platform: process.platform, arch: process.arch, node: process.versions.node, lock_sha256: ready.runtime_lock_sha256, packages: Object.fromEntries(Object.entries(packages).filter(([name]) => name).map(([name, pkg]) => [name, { version: pkg.version, integrity: pkg.integrity || null }])) }, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    if (await fs.lstat(runtime).catch(e => { if (e.code === 'ENOENT') return null; throw e; })) {
      await realDirectory(runtime);
      backup = `${runtime}.backup-${Date.now()}-${randomUUID().slice(0, 8)}`;
      await fs.rename(runtime, backup);
    }
    try { await fs.rename(stage, runtime); }
    catch (error) { if (backup) await fs.rename(backup, runtime); throw error; }
    return { status: 'installed', runtime, backup, ...await checkRuntime(runtime) };
  } finally {
    await fs.rm(stage, { recursive: true, force: true });
    await fs.rmdir(lock);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { values } = parseArgs({ options: { runtime: { type: 'string' } } });
    process.stdout.write(`${JSON.stringify(await installMedia(values.runtime), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ ok: false, code: error.code || 'MEDIA_INSTALL_FAILED', message: error.message })}\n`);
    process.exitCode = 1;
  }
}
