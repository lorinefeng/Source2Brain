import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { BrainError, requireValue, validateArtifact, renderNote, contentHash, hash } from './artifact.mjs';

export const expandHome = value => path.resolve(value === '~' ? os.homedir() : value.startsWith('~/') ? path.join(os.homedir(), value.slice(2)) : value);

async function directory(p) {
  await fs.mkdir(p, { recursive: true, mode: 0o700 });
  const stat = await fs.lstat(p);
  requireValue(stat.isDirectory() && !stat.isSymbolicLink(), 'UNSAFE_PATH', `需要真实目录：${p}`);
}

export async function initStore(root) {
  root = expandHome(root);
  await directory(root);
  root = await fs.realpath(root);
  for (const name of ['Sources', 'Pending', '.source2brain']) await directory(path.join(root, name));
  return { root, sources: path.join(root, 'Sources') };
}

export async function saveSource(root, artifact) {
  const { id } = validateArtifact(artifact);
  ({ root } = await initStore(root));
  const partial = artifact.extraction.status === 'partial';
  const parent = path.join(root, partial ? 'Pending' : 'Sources');
  const dest = path.join(parent, id);
  const digest = contentHash(artifact);
  const existing = async () => {
    const stat = await fs.lstat(dest).catch(e => { if (e.code === 'ENOENT') return null; throw e; });
    if (!stat) return null;
    requireValue(stat.isDirectory() && !stat.isSymbolicLink(), 'UNSAFE_PATH', '来源目录不能是符号链接');
    const stored = JSON.parse(await fs.readFile(path.join(dest, 'artifact.json'), 'utf8'));
    // 限制说明/模型措辞改变，不表示来源内容发生变化。
    const identity = a => JSON.stringify({ content: a.content, coverage: [a.extraction.status, a.extraction.text, a.extraction.transcript, a.extraction.visuals] });
    requireValue(identity(stored) === identity(artifact), 'SOURCE_CHANGED', '该链接已有不同内容，原笔记已保留；请人工审阅差异后更新');
    const note = await fs.lstat(path.join(dest, partial ? 'artifact.json' : 'source.md'));
    requireValue(note.isFile() && !note.isSymbolicLink(), 'DAMAGED_SOURCE', '已有来源文件缺失或不是普通文件，请先恢复');
    return { status: partial ? 'pending_duplicate' : 'duplicate', source_id: id, path: path.join(dest, partial ? 'artifact.json' : 'source.md'), indexed: false };
  };
  const duplicate = await existing();
  if (duplicate) return duplicate;
  // 同一文件系统内发布整个目录，防止原文、笔记、回执只写入一半。
  const stage = path.join(root, '.source2brain', `stage-${randomUUID()}`);
  await fs.mkdir(stage, { mode: 0o700 });
  try {
    await fs.writeFile(path.join(stage, 'artifact.json'), `${JSON.stringify(artifact, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    const markdown = partial ? null : renderNote(artifact);
    if (markdown) await fs.writeFile(path.join(stage, 'source.md'), markdown, { mode: 0o600, flag: 'wx' });
    await fs.writeFile(path.join(stage, 'receipt.json'), `${JSON.stringify({ schema_version: 1, source_id: id, content_sha256: digest, markdown_sha256: markdown ? hash(markdown) : null, saved_at: new Date().toISOString(), status: partial ? 'pending' : 'saved', indexed: false }, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    try { await fs.rename(stage, dest); }
    catch (e) {
      if (['EEXIST', 'ENOTEMPTY'].includes(e.code)) return await existing();
      throw e;
    }
    return { status: partial ? 'pending' : 'saved', source_id: id, path: path.join(dest, partial ? 'artifact.json' : 'source.md'), indexed: false };
  } finally { await fs.rm(stage, { recursive: true, force: true }); }
}

export async function verifyStore(root) {
  root = expandHome(root);
  const issues = [], notes = [];
  for (const entry of await fs.readdir(path.join(root, 'Sources'), { withFileTypes: true })) {
    if (!entry.isDirectory()) { issues.push({ source_id: entry.name, error: 'Sources 中出现非来源目录' }); continue; }
    const dir = path.join(root, 'Sources', entry.name);
    try {
      const artifact = JSON.parse(await fs.readFile(path.join(dir, 'artifact.json'), 'utf8'));
      const identity = validateArtifact(artifact);
      requireValue(identity.id === entry.name && artifact.extraction.status === 'complete', 'INVALID_SOURCE', '来源 ID 或完成状态不一致');
      const receipt = JSON.parse(await fs.readFile(path.join(dir, 'receipt.json'), 'utf8'));
      const text = await fs.readFile(path.join(dir, 'source.md'), 'utf8');
      requireValue(receipt.content_sha256 === contentHash(artifact), 'ARTIFACT_CHANGED', '原始 artifact 与回执不一致');
      notes.push({ source_id: entry.name, edited: receipt.markdown_sha256 !== hash(text), path: path.join(dir, 'source.md') });
    } catch (e) { issues.push({ source_id: entry.name, error: e.message }); }
  }
  return { ok: issues.length === 0, notes, issues };
}
