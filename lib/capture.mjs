import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { extractUrl, parseXhsUrl, requireValue, BrainError, hash } from './artifact.mjs';
import { expandHome } from './store.mjs';
import { run, parseJsonOutput } from './process.mjs';

export async function captureXhs(message, output, { runner = run } = {}) {
  const original = extractUrl(message);
  output = expandHome(output);
  // 只创建新目录，避免覆盖上一次采集或用户文件。
  await fs.mkdir(path.dirname(output), { recursive: true, mode: 0o700 });
  await fs.mkdir(output, { mode: 0o700 });
  const journal = { schema_version: 1, original_url: original, captured_at: new Date().toISOString(), status: 'started', steps: [] };
  const write = (name, obj) => fs.writeFile(path.join(output, name), `${JSON.stringify(obj, null, 2)}\n`, { mode: 0o600 });
  const session = `source2brain-${randomUUID().slice(0, 8)}`;
  let browserOpened = false;
  try {
    const doctor = parseJsonOutput((await runner('agent-reach', ['doctor', '--json'], { timeout: 120_000 })).stdout);
    const channel = doctor.xiaohongshu;
    const confirmed = channel?.status === 'ok' && channel.active_backend === 'OpenCLI';
    const needsProbe = channel?.status === 'warn' && !channel.active_backend && channel.backends?.includes('OpenCLI');
    requireValue(confirmed || needsProbe, 'BACKEND_UNAVAILABLE', 'Agent Reach 未找到可测试的 OpenCLI 后端');
    if (needsProbe) await runner('opencli', ['--version']);
    journal.steps.push(`agent-reach doctor：OpenCLI ${confirmed ? '已就绪' : '需实际读取验证登录态'}`);
    let resolved = original;
    browserOpened = true;
    await runner('opencli', ['browser', session, 'open', original, '--window', 'background']);
    if (parseXhsUrl(original).short) {
      // 等待短链跳转；次数有上限，不尝试绕过登录或风控。
      for (let i = 0; i < 4; i++) {
        const result = await runner('opencli', ['browser', session, 'get', 'url']);
        resolved = result.stdout.trim().split('\n')[0].trim();
        if (!parseXhsUrl(resolved).short) break;
        await new Promise(resolve => setTimeout(resolve, 1500));
      }
    }
    const parsed = parseXhsUrl(resolved);
    requireValue(!parsed.short && parsed.url.searchParams.get('xsec_token'), 'SIGNED_URL_REQUIRED', '尚未取得含 xsec_token 的笔记链接；请在浏览器打开后重试');
    journal.source_url = parsed.canonical;
    const pageTitle = (await runner('opencli', ['browser', session, 'get', 'title'])).stdout.trim().split('\n')[0].trim();
    const raw = parseJsonOutput((await runner('opencli', ['xiaohongshu', 'note', resolved, '--site-session', 'ephemeral', '-f', 'json'])).stdout);
    requireValue(Array.isArray(raw) && raw.every(r => typeof r.field === 'string'), 'INVALID_TOOL_OUTPUT', 'OpenCLI note 输出格式发生变化');
    const fields = Object.fromEntries(raw.map(r => [r.field, r.value]));
    const title = pageTitle.endsWith(' - 小红书') ? pageTitle.slice(0, -6).trim() : fields.title;
    requireValue(title && !/^(手机号登录|登录|小红书)$/.test(title), 'INVALID_TITLE', '当前页面标题是登录界面，不能当作笔记标题');
    requireValue(typeof fields.content === 'string' && fields.content.trim(), 'EMPTY_CONTENT', '没有获取到笔记正文，不生成摘要');
    await write('raw-note.json', raw);
    journal.steps.push('opencli xiaohongshu note：读取配文');
    let media = [], mediaError = null;
    try {
      media = parseJsonOutput((await runner('opencli', ['xiaohongshu', 'download', resolved, '--site-session', 'ephemeral', '--output', path.join(output, 'media'), '-f', 'json'], { timeout: 300_000 })).stdout);
      requireValue(Array.isArray(media), 'INVALID_TOOL_OUTPUT', '媒体输出格式发生变化');
      await write('raw-media.json', media);
      journal.steps.push('opencli xiaohongshu download：采集媒体');
    } catch (e) { mediaError = e.code || 'MEDIA_FAILED'; }
    const video = media.some(m => m.type === 'video');
    const files = media.filter(m => m.status === 'success').map(m => ({ type: m.type, path: path.join(output, 'media', parsed.id, `${parsed.id}_${m.index}.${m.type === 'video' ? 'mp4' : 'jpg'}`) }));
    const artifact = {
      schema_version: 1,
      source: { url: parsed.canonical, original_url: original, platform: 'xiaohongshu', title, author: fields.author || null, published_at: null, captured_at: journal.captured_at },
      content: { type: video ? 'video' : 'post', text: fields.content, transcript: '', visual_notes: '' },
      extraction: { status: 'partial', text: 'complete', transcript: video ? 'missing' : 'not_applicable', visuals: 'missing', limitations: [mediaError ? `媒体采集失败：${mediaError}` : video ? '视频尚未转写；画面未分析' : '图片内容尚未读取'] },
      knowledge: { summary: '', claims: [], insights: [], actions: [], related_topics: [] },
      provenance: { adapter: 'agent-reach/OpenCLI', model: 'pending', steps: [...journal.steps], raw_note_sha256: hash(JSON.stringify(raw)), media_files: files }
    };
    journal.status = 'captured_partial';
    journal.media_error = mediaError;
    await write('artifact.json', artifact);
    return { status: 'captured_partial', artifact: path.join(output, 'artifact.json'), media: files, media_error: mediaError, source_url: parsed.canonical };
  } catch (e) {
    journal.status = 'failed'; journal.error_code = e.code || 'CAPTURE_FAILED';
    throw e;
  } finally {
    await write('capture.json', journal);
    if (browserOpened) await runner('opencli', ['browser', session, 'close'], { timeout: 10_000 }).catch(() => {});
  }
}
