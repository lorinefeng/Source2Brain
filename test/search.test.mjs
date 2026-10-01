import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { saveSource, initStore } from '../lib/store.mjs';
import { searchStore } from '../lib/search.mjs';

const sample = () => ({ schema_version: 1, source: { url: 'https://www.xiaohongshu.com/explore/000000000000000000000001', original_url: 'https://xhslink.cn/o/synthetic', platform: 'xiaohongshu', title: '合成检索材料', author: null, published_at: null, captured_at: '2026-10-01T00:00:00.000Z' }, content: { type: 'post', text: '归档 Benchmark 42', transcript: '', visual_notes: '' }, extraction: { status: 'complete', text: 'complete', transcript: 'not_applicable', visuals: 'not_applicable', limitations: [] }, knowledge: { summary: '合成检索测试', claims: [], insights: [], actions: [], related_topics: [] }, provenance: { adapter: 'synthetic', model: 'synthetic', steps: ['合成检索测试'] } });
async function temp(t) { const p = await fs.mkdtemp(path.join(os.tmpdir(), 's2b-search-')); t.after(() => fs.rm(p, { recursive: true, force: true })); return p; }

test('文件检索支持中英文、原文与人工批注，不搜索 Pending', async t => {
  const root = await temp(t), a = sample();
  const saved = await saveSource(root, a);
  await fs.appendFile(saved.path, '\n人工批注独特词\n');
  const pending = sample(); pending.source.url = pending.source.url.replace(/1$/, '2'); pending.content.text = 'Pending独特词'; pending.extraction.status = 'partial'; pending.extraction.limitations = ['待整理'];
  await saveSource(root, pending);
  const result = await searchStore(root, '归档 benchmark');
  assert.equal(result.mode, 'file_keyword'); assert.equal(result.total, 1);
  assert.equal(result.matches[0].source_url, a.source.url);
  assert.ok(result.matches[0].excerpts.some(e => e.text.includes('42') && e.line > 0));
  assert.equal((await searchStore(root, '人工批注独特词')).total, 1);
  assert.equal((await searchStore(root, 'Pending独特词')).total, 0);
  assert.equal((await searchStore(root, '$(anything)')).total, 0);
  await assert.rejects(searchStore(root, ''), { code: 'INVALID_QUERY' });
  await assert.rejects(searchStore(root, 'test', { limit: 0 }), { code: 'INVALID_LIMIT' });
});

test('损坏来源和链接笔记不泄漏内容；Sources 符号链接拒绝检索', async t => {
  const root = await temp(t), outside = await temp(t), a = sample();
  const saved = await saveSource(root, a);
  const artifact = path.join(path.dirname(saved.path), 'artifact.json');
  a.content.text = '篡改'; await fs.writeFile(artifact, JSON.stringify(a));
  const damaged = await searchStore(root, '归档');
  assert.equal(damaged.total, 0); assert.equal(damaged.issues.length, 1);
  await fs.writeFile(artifact, JSON.stringify(sample()));
  const external = path.join(outside, 'private.md'); await fs.writeFile(external, '外部秘密');
  await fs.rm(saved.path); await fs.symlink(external, saved.path);
  assert.equal((await searchStore(root, '外部秘密')).total, 0);
  const linked = await temp(t); await fs.symlink(path.join(root, 'Sources'), path.join(linked, 'Sources'));
  await assert.rejects(searchStore(linked, '秘密'), { code: 'UNSAFE_PATH' });
  const empty = await temp(t); await initStore(empty);
  assert.equal((await searchStore(empty, '任意')).total, 0);
});
