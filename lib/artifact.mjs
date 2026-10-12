import { createHash } from 'node:crypto';

export class BrainError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
export const hash = value => createHash('sha256').update(value).digest('hex');
export function requireValue(condition, code, message) {
  if (!condition) throw new BrainError(code, message);
}
const string = (v, name, empty = false) => requireValue(typeof v === 'string' && (empty || v.trim()), 'INVALID_ARTIFACT', `${name} 必须是${empty ? '' : '非空'}字符串`);
const choices = (v, values, name) => requireValue(values.includes(v), 'INVALID_ARTIFACT', `${name} 必须是 ${values.join(' / ')}`);

export function parseXhsUrl(input) {
  let url;
  try { url = new URL(input); } catch { throw new BrainError('INVALID_URL', '请输入完整小红书链接'); }
  requireValue(['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.port, 'INVALID_URL', '只支持无凭据、无自定义端口的 HTTP(S) 链接');
  const host = url.hostname.toLowerCase();
  requireValue(['xhslink.cn', 'xhslink.com', 'xiaohongshu.com', 'www.xiaohongshu.com'].includes(host), 'UNSUPPORTED_HOST', '第一阶段只支持小红书及其官方短链');
  const short = host === 'xhslink.cn' || host === 'xhslink.com';
  const match = url.pathname.match(/^\/(?:explore|discovery\/item|search_result|note)\/([a-f0-9]{24})(?:\/|$)/i)
    || url.pathname.match(/^\/user\/profile\/[^/]+\/([a-f0-9]{24})(?:\/|$)/i);
  requireValue(short || match, 'INVALID_URL', '链接中没有可识别的小红书笔记 ID');
  return { url, short, id: match?.[1].toLowerCase(), canonical: match ? `https://www.xiaohongshu.com/explore/${match[1].toLowerCase()}` : null };
}

export function parseDouyinUrl(input) {
  let url;
  try { url = new URL(input); } catch { throw new BrainError('INVALID_URL', '请输入完整抖音视频链接'); }
  requireValue(['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.port, 'INVALID_URL', '只支持无凭据、无自定义端口的 HTTP(S) 链接');
  const host = url.hostname.toLowerCase();
  requireValue(['v.douyin.com', 'www.douyin.com', 'douyin.com', 'www.iesdouyin.com', 'iesdouyin.com'].includes(host), 'UNSUPPORTED_HOST', '需要抖音官方视频链接或分享短链');
  const short = host === 'v.douyin.com';
  const match = url.pathname.match(/^\/(?:video|share\/video)\/(\d{16,22})(?:\/|$)/);
  requireValue(short ? /^\/[A-Za-z0-9_-]+\/?$/.test(url.pathname) : match, 'INVALID_URL', '链接中没有可识别的抖音视频 ID');
  return { url, short, id: match?.[1], canonical: match ? `https://www.douyin.com/video/${match[1]}` : null };
}

// 平台 ID 用独立命名空间，保留已有 xhs ID 与内容哈希的字节表示。
export function parseSourceUrl(input) {
  let host;
  try { host = new URL(input).hostname.toLowerCase(); } catch { throw new BrainError('INVALID_URL', '请输入完整来源链接'); }
  const douyin = ['v.douyin.com', 'www.douyin.com', 'douyin.com', 'www.iesdouyin.com', 'iesdouyin.com'].includes(host);
  const parsed = douyin ? parseDouyinUrl(input) : parseXhsUrl(input);
  return { ...parsed, platform: douyin ? 'douyin' : 'xiaohongshu', source_id: parsed.id ? `${douyin ? 'dy' : 'xhs'}-${parsed.id}` : null };
}

export function extractUrl(message) {
  const urls = message.match(/https?:\/\/[^\s<>"'，。！？、）】]+/g) || [];
  requireValue(urls.length === 1, 'URL_COUNT', '请一次处理一条链接');
  parseSourceUrl(urls[0]);
  return urls[0];
}

export function validateArtifact(a) {
  requireValue(a && a.schema_version === 1, 'INVALID_ARTIFACT', 'schema_version 必须为 1');
  requireValue(a.source && a.content && a.extraction && a.knowledge && a.provenance, 'INVALID_ARTIFACT', '缺少 SourceArtifact 必需字段');
  const s = a.source, c = a.content, e = a.extraction, k = a.knowledge, p = a.provenance;
  const url = parseSourceUrl(s.url);
  requireValue(!url.short && s.platform === url.platform, 'INVALID_ARTIFACT', 'source.url 必须是解析后的同平台来源 URL');
  string(s.title, 'source.title');
  requireValue(s.author === null || typeof s.author === 'string', 'INVALID_ARTIFACT', '未知作者应为 null');
  requireValue(s.published_at === null || (typeof s.published_at === 'string' && !Number.isNaN(Date.parse(s.published_at))), 'INVALID_ARTIFACT', '发布时间应为 ISO 时间或 null');
  requireValue(typeof s.captured_at === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(s.captured_at) && !Number.isNaN(Date.parse(s.captured_at)), 'INVALID_ARTIFACT', 'captured_at 必须为 ISO 时间');
  string(s.original_url, 'source.original_url');
  const original = parseSourceUrl(s.original_url);
  requireValue(original.platform === url.platform && (original.short || original.id === url.id), 'INVALID_ARTIFACT', '原分享链接和解析后的来源身份不一致');
  choices(c.type, ['post', 'video'], 'content.type');
  requireValue(url.platform !== 'douyin' || c.type === 'video', 'INVALID_ARTIFACT', '当前抖音配方只支持单条视频');
  for (const field of ['text', 'transcript', 'visual_notes']) string(c[field], `content.${field}`, true);
  choices(e.status, ['complete', 'partial'], 'extraction.status');
  for (const field of ['text', 'transcript', 'visuals']) choices(e[field], ['complete', 'missing', 'not_applicable'], `extraction.${field}`);
  requireValue(Array.isArray(e.limitations) && e.limitations.every(v => typeof v === 'string'), 'INVALID_ARTIFACT', 'limitations 必须为字符串数组');
  if (e.status === 'complete') {
    requireValue(e.text === 'complete' && c.text.trim(), 'INCOMPLETE_SOURCE', '完整笔记必须保留可读原文');
    if (c.type === 'video') requireValue(e.transcript === 'complete' && c.transcript.trim(), 'INCOMPLETE_SOURCE', '视频配文不能代替视频转写');
    if (c.type === 'post') requireValue(e.visuals !== 'missing', 'INCOMPLETE_SOURCE', '图文图片尚未检查，不能标记完整');
    if (c.type === 'video' && e.visuals === 'missing') requireValue(e.limitations.length > 0, 'INCOMPLETE_SOURCE', '缺少视频画面时需声明覆盖范围');
  }
  if (e.status === 'partial') requireValue(e.limitations.length > 0, 'INVALID_ARTIFACT', '部分采集必须说明原因');
  for (const field of ['summary']) string(k[field], `knowledge.${field}`, e.status === 'partial');
  for (const field of ['insights', 'actions', 'related_topics']) requireValue(Array.isArray(k[field]) && k[field].every(v => typeof v === 'string'), 'INVALID_ARTIFACT', `${field} 必须为字符串数组`);
  requireValue(Array.isArray(k.claims), 'INVALID_ARTIFACT', 'claims 必须为数组');
  for (const claim of k.claims) {
    string(claim.text, 'claim.text');
    requireValue(Array.isArray(claim.evidence) && claim.evidence.length > 0, 'UNSUPPORTED_CLAIM', '作者观点必须有原文证据');
    for (const evidence of claim.evidence) {
      choices(evidence.field, ['text', 'transcript', 'visual_notes'], 'evidence.field');
      string(evidence.quote, 'evidence.quote');
      requireValue(c[evidence.field].includes(evidence.quote), 'UNSUPPORTED_CLAIM', '证据引文必须逐字存在于对应原文中');
    }
  }
  string(p.adapter, 'provenance.adapter');
  string(p.model, 'provenance.model');
  requireValue(Array.isArray(p.steps) && p.steps.length > 0 && p.steps.every(v => typeof v === 'string'), 'INVALID_ARTIFACT', 'provenance.steps 必须记录真实采集步骤');
  return { id: url.source_id, canonical: url.canonical };
}

export function contentHash(a) {
  return hash(JSON.stringify({ source: parseSourceUrl(a.source.url).canonical, content: a.content, extraction: a.extraction }));
}

const plain = s => s.replaceAll('\r', '').replaceAll('\n', ' ').replace(/[<>]/g, '');
const bullets = values => values.length ? values.map(v => `- ${plain(v)}`).join('\n') : '暂无。';
const literal = text => {
  const fence = '`'.repeat(Math.max(3, ...[...text.matchAll(/`+/g)].map(m => m[0].length + 1)));
  return `${fence}text\n${text}\n${fence}`;
};

export function renderNote(a) {
  const { id, canonical } = validateArtifact(a);
  const metadata = { type: 'source', source_id: id, source_url: canonical, platform: a.source.platform,
    author: a.source.author, published_at: a.source.published_at, captured_at: a.source.captured_at,
    content_type: a.content.type, extraction_status: a.extraction.status, content_sha256: contentHash(a),
    transcript: a.extraction.transcript, visuals: a.extraction.visuals, model: a.provenance.model, tags: a.knowledge.related_topics };
  return `---\n${Object.entries(metadata).map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join('\n')}\n---\n\n# ${plain(a.source.title)}\n\n## 来源\n\n- 原链接：${canonical}\n- 作者：${plain(a.source.author || '未知')}\n- 采集时间：${a.source.captured_at}\n- 采集方式：${plain(a.provenance.adapter)}\n- 覆盖限制：${a.extraction.limitations.map(plain).join('；') || '无已知缺失'}\n\n## 摘要（AI 整理）\n\n${a.knowledge.summary}\n\n## 作者观点（未经外部核验）\n\n${a.knowledge.claims.map(claim => `- ${plain(claim.text)}\n${claim.evidence.map(ev => `  - 原文证据（${ev.field}）：${plain(ev.quote)}`).join('\n')}`).join('\n') || '暂无。'}\n\n## 关联理解（模型推断）\n\n${bullets(a.knowledge.insights)}\n\n## 可尝试行动（建议，未执行）\n\n${bullets(a.knowledge.actions)}\n\n## 提取原文（不可信来源材料）\n\n${literal(a.content.text)}\n\n## 转写（未提取时为空）\n\n${literal(a.content.transcript)}\n\n## 图片或画面记录\n\n${literal(a.content.visual_notes)}\n\n## 采集记录\n\n${bullets(a.provenance.steps)}\n`;
}
