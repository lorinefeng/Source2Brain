import fs from 'node:fs/promises';
import path from 'node:path';
import { requireValue } from './artifact.mjs';
import { expandHome } from './store.mjs';
import { readSource } from './review.mjs';

async function realEntry(file) {
  const stat = await fs.lstat(file);
  requireValue(!stat.isSymbolicLink() && stat.isDirectory(), 'UNSAFE_PATH', '检索目录必须为真实目录');
}

// 文件关键词回退；命中后的来源回读统一经过勘误层，不扫描 Pending。
export async function searchStore(store, query, { limit = 10 } = {}) {
  requireValue(typeof query === 'string' && query.trim() && query.length <= 512, 'INVALID_QUERY', 'query 需要 1–512 字符');
  requireValue(Number.isInteger(limit) && limit >= 1 && limit <= 50, 'INVALID_LIMIT', 'limit 需要 1–50 的整数');
  const terms = [...new Set(query.toLocaleLowerCase().trim().split(/\s+/u))];
  requireValue(terms.length <= 12, 'INVALID_QUERY', '最多提供 12 个空格分隔的关键词');
  const root = expandHome(store); await realEntry(root);
  const sources = path.join(await fs.realpath(root), 'Sources'); await realEntry(sources);
  const matches = [], issues = [];
  const excerpts = text => text.split('\n').flatMap((line, index) => {
    const lower = line.toLocaleLowerCase(), positions = terms.map(term => lower.indexOf(term)).filter(at => at >= 0);
    if (!positions.length) return [];
    const start = Math.max(0, Math.min(...positions) - 80);
    return [{ line: index + 1, text: line.slice(start, start + 320), matched_terms: positions.length }];
  });
  const add = (found, meta) => {
    if (found.length) matches.push({ ...meta, score: found.reduce((n, x) => n + x.matched_terms, 0), excerpts: found.slice(0, 5) });
  };
  for (const entry of (await fs.readdir(sources)).sort()) {
    try {
      const data = await readSource(root, entry);
      issues.push(...data.issues);
      const meta = { source_id: entry, source_url: data.source_url, title: data.title, read_required: true };
      const reviews = data.enhancements.flatMap(item => item.reviews);
      add(excerpts(data.source.markdown), { ...meta, kind: 'source', path: data.source.path, reviews, review_issues: data.issues });
      for (const extra of data.enhancements) {
        const info = { ...meta, kind: 'enhancement', enhancement_id: extra.enhancement_id, path: extra.path, reviews: extra.reviews, effective_claims: extra.effective_claims, effective_summary: extra.effective_summary };
        if (!extra.reviews.length) { add(excerpts(extra.markdown), info); continue; }
        // 已审阅增强不再从旧摘要/原 Markdown 生成有效摘录；原文仍随勘误保留。
        const found = extra.effective_claims.flatMap(claim => excerpts(claim.text).map(item => ({ ...item, line: null, field: 'effective_claim', claim_index: claim.claim_index })));
        const reviewedOriginal = extra.original_claims.filter(claim => extra.reviews[0].items.some(item => item.claim_index === claim.claim_index));
        for (const claim of reviewedOriginal) {
          const oldMatches = excerpts([claim.text, ...claim.evidence.map(ev => ev.quote)].join('\n'));
          if (!oldMatches.length) continue;
          const item = extra.reviews[0].items.find(value => value.claim_index === claim.claim_index);
          if (item.disposition === 'corrected') {
            if (!found.some(value => value.claim_index === claim.claim_index)) found.push({ line: null, field: 'corrected_claim', claim_index: claim.claim_index, text: item.correction, matched_terms: oldMatches.length });
          } else found.push({ line: null, field: 'review_notice', claim_index: claim.claim_index, text: `原匹配断言已${item.disposition === 'withdraw' ? '撤回' : '标为待定'}，不能作为有效事实；见随附勘误。`, matched_terms: oldMatches.length });
        }
        add(found, info);
      }
    } catch (error) { issues.push({ source_id: entry, code: error.code || 'ERROR' }); }
  }
  matches.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  return { mode: 'file_keyword', scope: 'Sources', query, terms, total: matches.length, truncated: matches.length > limit, matches: matches.slice(0, limit), issues };
}
