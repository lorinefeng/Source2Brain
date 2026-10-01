import fs from 'node:fs/promises';
import path from 'node:path';
import { requireValue, validateArtifact, contentHash } from './artifact.mjs';
import { expandHome } from './store.mjs';
import { verifyEnhancementDirectory } from './enhancement.mjs';

async function realEntry(file, kind) {
  const stat = await fs.lstat(file);
  requireValue(!stat.isSymbolicLink() && (kind === 'dir' ? stat.isDirectory() : stat.isFile()), 'UNSAFE_PATH', '检索路径必须为真实目录或普通文件');
  if (kind !== 'dir') requireValue(stat.size <= 2 * 1024 * 1024, 'SEARCH_FILE_TOO_LARGE', '文件超过检索上限 2 MiB');
}
async function json(file) { await realEntry(file, 'file'); return JSON.parse(await fs.readFile(file, 'utf8')); }

// 文件关键词回退：不建数据库、不调用模型、不扫描 Pending 或审计目录。
export async function searchStore(store, query, { limit = 10 } = {}) {
  requireValue(typeof query === 'string' && query.trim() && query.length <= 512, 'INVALID_QUERY', 'query 需要 1–512 字符');
  requireValue(Number.isInteger(limit) && limit >= 1 && limit <= 50, 'INVALID_LIMIT', 'limit 需要 1–50 的整数');
  const terms = [...new Set(query.toLocaleLowerCase().trim().split(/\s+/u))];
  requireValue(terms.length <= 12, 'INVALID_QUERY', '最多提供 12 个空格分隔的关键词');
  const root = expandHome(store);
  await realEntry(root, 'dir');
  const sources = path.join(await fs.realpath(root), 'Sources');
  await realEntry(sources, 'dir');
  const matches = [], issues = [];
  const inspect = async (file, meta) => {
    await realEntry(file, 'file');
    const lines = (await fs.readFile(file, 'utf8')).split('\n');
    const found = lines.flatMap((text, index) => {
      const lower = text.toLocaleLowerCase();
      const positions = terms.map(term => lower.indexOf(term)).filter(at => at >= 0);
      if (!positions.length) return [];
      const start = Math.max(0, Math.min(...positions) - 80);
      return [{ line: index + 1, text: text.slice(start, start + 320), matched_terms: positions.length }];
    });
    if (found.length) matches.push({ ...meta, path: file, score: found.reduce((n, x) => n + x.matched_terms, 0), excerpts: found.slice(0, 5) });
  };
  for (const entry of (await fs.readdir(sources)).sort()) {
    try {
      requireValue(/^xhs-[a-f0-9]{24}$/.test(entry), 'INVALID_SOURCE', '非来源目录不参与检索');
      const dir = path.join(sources, entry);
      await realEntry(dir, 'dir');
      const artifact = await json(path.join(dir, 'artifact.json'));
      const identity = validateArtifact(artifact);
      const receipt = await json(path.join(dir, 'receipt.json'));
      requireValue(identity.id === entry && artifact.extraction.status === 'complete' && receipt.content_sha256 === contentHash(artifact), 'INVALID_SOURCE', '来源状态或内容与回执不匹配');
      const meta = { source_id: entry, source_url: identity.canonical, title: artifact.source.title };
      await inspect(path.join(dir, 'source.md'), { ...meta, kind: 'source' });
      const extras = path.join(dir, 'enhancements');
      if (!await fs.lstat(extras).catch(e => { if (e.code === 'ENOENT') return null; throw e; })) continue;
      await realEntry(extras, 'dir');
      for (const id of (await fs.readdir(extras)).sort()) {
        try {
          const extra = path.join(extras, id);
          await realEntry(extra, 'dir');
          const checked = await verifyEnhancementDirectory(extra);
          requireValue(checked.artifact.coverage.status === 'complete' && checked.artifact.source.id === entry && checked.artifact.source.base_content_sha256 === contentHash(artifact), 'INVALID_ENHANCEMENT', '增强来源或状态不匹配');
          await inspect(path.join(extra, 'enhancement.md'), { ...meta, kind: 'enhancement', enhancement_id: id });
        } catch (error) { issues.push({ source_id: entry, enhancement_id: id, code: error.code || 'ERROR' }); }
      }
    } catch (error) { issues.push({ source_id: entry, code: error.code || 'ERROR' }); }
  }
  matches.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  return { mode: 'file_keyword', scope: 'Sources', query, terms, total: matches.length, truncated: matches.length > limit, matches: matches.slice(0, limit), issues };
}
