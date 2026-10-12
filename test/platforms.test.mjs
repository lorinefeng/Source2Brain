import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseDouyinUrl, parseSourceUrl, extractUrl, validateArtifact, contentHash, hash } from '../lib/artifact.mjs';
import { saveSource, verifyStore } from '../lib/store.mjs';
import { searchStore } from '../lib/search.mjs';

const video = () => ({ schema_version: 1,
  source: { url: 'https://www.douyin.com/video/7123456789012345678', original_url: 'https://v.douyin.com/synthetic/', platform: 'douyin', title: '合成抖音测试', author: null, published_at: null, captured_at: '2026-10-07T00:00:00.000Z' },
  content: { type: 'video', text: '合成配文', transcript: '合成口播：先写草稿再核对来源。', visual_notes: '' },
  extraction: { status: 'complete', text: 'complete', transcript: 'complete', visuals: 'missing', limitations: ['仅口播；未提取画面'] },
  knowledge: { summary: '合成摘要', claims: [{ text: '先写草稿', evidence: [{ field: 'transcript', quote: '先写草稿' }] }], insights: [], actions: [], related_topics: [] },
  provenance: { adapter: 'synthetic', model: 'synthetic', steps: ['合成测试'] }
});
async function temp(t) { const dir = await fs.mkdtemp(path.join(os.tmpdir(), 's2b-platforms-')); t.after(() => fs.rm(dir, { recursive: true, force: true })); return dir; }

test('抖音短链和两种标准链接解析为独立命名空间，不接受用户页或伪域名', () => {
  const id = '7123456789012345678';
  assert.equal(extractUrl('复制打开抖音 https://v.douyin.com/synthetic/ 观看'), 'https://v.douyin.com/synthetic/');
  assert.equal(parseSourceUrl(`https://www.iesdouyin.com/share/video/${id}/?region=CN`).source_id, `dy-${id}`);
  assert.equal(parseDouyinUrl(`https://www.douyin.com/video/${id}?foo=bar`).canonical, `https://www.douyin.com/video/${id}`);
  for (const url of ['https://www.douyin.com/user/test', 'https://www.douyin.com/video/abc', 'https://v.douyin.com/', 'https://v.douyin.com/aa/bb', 'https://douyin.com.evil.test/video/7123456789012345678', 'https://user:secret@www.douyin.com/video/7123456789012345678', 'https://www.douyin.com:444/video/7123456789012345678', 'file:///tmp/test']) assert.throws(() => parseDouyinUrl(url));
});

test('跨平台或不同标准 ID 的原始链接不能绑定到另一个来源', () => {
  const a = video();
  assert.equal(validateArtifact(a).id, 'dy-7123456789012345678');
  a.source.original_url = 'https://xhslink.cn/o/synthetic';
  assert.throws(() => validateArtifact(a), { code: 'INVALID_ARTIFACT' });
  a.source.original_url = 'https://www.douyin.com/video/7123456789012345679';
  assert.throws(() => validateArtifact(a), { code: 'INVALID_ARTIFACT' });
  a.source.original_url = a.source.url; a.content.type = 'post';
  assert.throws(() => validateArtifact(a), { code: 'INVALID_ARTIFACT' });
});

test('旧小红书 ID 与内容哈希格式完全保持兼容', () => {
  const a = video(); a.source.platform = 'xiaohongshu'; a.source.url = 'https://www.xiaohongshu.com/explore/000000000000000000000001?xsec_token=synthetic'; a.source.original_url = 'https://xhslink.cn/o/synthetic';
  assert.equal(validateArtifact(a).id, 'xhs-000000000000000000000001');
  const legacy = hash(JSON.stringify({ source: 'https://www.xiaohongshu.com/explore/000000000000000000000001', content: a.content, extraction: a.extraction }));
  assert.equal(contentHash(a), legacy);
});

test('抖音保存、并发去重、人工批注和混合平台检索保持原保护', async t => {
  const store = await temp(t), a = video();
  const results = await Promise.all(Array.from({ length: 4 }, () => saveSource(store, a)));
  assert.equal(results.filter(x => x.status === 'saved').length, 1);
  const saved = results[0]; await fs.appendFile(saved.path, '\n人工批注独特词');
  assert.equal((await saveSource(store, a)).status, 'duplicate');
  assert.ok((await fs.readFile(saved.path, 'utf8')).endsWith('人工批注独特词'));
  const b = video(); b.source.platform = 'xiaohongshu'; b.source.url = 'https://www.xiaohongshu.com/explore/000000000000000000000001'; b.source.original_url = 'https://xhslink.cn/o/synthetic';
  await saveSource(store, b);
  const found = await searchStore(store, '草稿');
  assert.equal(found.total, 2); assert.equal(found.issues.length, 0);
  assert.equal((await verifyStore(store)).ok, true);
  a.content.transcript += '新内容';
  await assert.rejects(saveSource(store, a), { code: 'SOURCE_CHANGED' });
});
