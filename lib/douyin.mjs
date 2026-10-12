import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {BrainError, requireValue, extractUrl, parseDouyinUrl} from './artifact.mjs';
import {run, parseJsonOutput} from './process.mjs';

// 媒体域白名单；调用方还必须给出本次指定页面响应中实际观察到的主机。
export const DOUYIN_MEDIA_DOMAINS = ['douyinvod.com'];
export function validateDouyinMediaUrl(input, observedHosts) {
  let url;
  try { url = new URL(input); } catch { throw new BrainError('MEDIA_URL_REJECTED', '视频媒体 URL 无效'); }
  const host = url.hostname.toLowerCase();
  requireValue(url.protocol === 'https:' && !url.username && !url.password && !url.port && input.length <= 8192,
    'MEDIA_URL_REJECTED', '视频只从无凭据的官方 HTTPS 媒体地址下载');
  requireValue(DOUYIN_MEDIA_DOMAINS.some(domain => host === domain || host.endsWith(`.${domain}`)),
    'MEDIA_URL_REJECTED', '媒体主机不在允许的官方 CDN 范围内');
  requireValue(observedHosts instanceof Set && observedHosts.has(host),
    'MEDIA_URL_REJECTED', '媒体主机未在本次指定页面中观察到');
  return url;
}

const unwrap = value => value && typeof value === 'object' && 'session' in value && 'data' in value ? value.data : value;
export const DOUYIN_PAGE_PROBE = `(() => {
  const text = (document.body?.innerText || '').slice(0, 100000);
  return {href:location.href, login_wall:/扫码登录|登录后.{0,12}(观看|查看)|登录后免费畅享/.test(text),
    security_block:/请完成.{0,10}验证|安全验证|访问异常|验证后继续/.test(text)};
})()`;

function isTargetRequest(entry, id) {
  if (!entry || typeof entry.url !== 'string' || entry.method !== 'GET' || entry.status !== 200 || entry.body_truncated) return false;
  try {
    const u = new URL(entry.url);
    return u.protocol === 'https:' && u.hostname === 'www.douyin.com' && !u.username && !u.password && !u.port
      && u.pathname === '/aweme/v1/web/aweme/detail/' && u.searchParams.getAll('aweme_id').length === 1 && u.searchParams.get('aweme_id') === id;
  } catch {return false;}
}

// 字段来源：OpenCLI user-videos 的 aweme_id/desc/video.play_addr 与 yt-dlp DouyinIE 的
// aweme_detail 投影。只解析浏览器已经收到的单条响应，不构造 API 请求、Cookie 或签名。
export function projectDouyinDetail(envelope, expectedId) {
  requireValue(!envelope?.body_truncated && isTargetRequest(envelope, expectedId), 'SOURCE_MISMATCH', '网络响应不是本次指定的抖音视频');
  let body=envelope.body;
  if(typeof body==='string') {
    requireValue(body.length<=2_000_000,'OUTPUT_LIMIT','抖音单条响应超出安全读取限制');
    try {body=JSON.parse(body);}catch {throw new BrainError('INVALID_TOOL_OUTPUT','抖音单条响应不是完整 JSON');}
  }
  requireValue(body && typeof body==='object' && (body.status_code===undefined || body.status_code===0), 'EMPTY_RESULT', '平台未返回可读取的单条内容');
  const d=body.aweme_detail;
  requireValue(d && typeof d==='object' && typeof d.aweme_id==='string' && d.aweme_id===expectedId, 'SOURCE_MISMATCH','视频元数据 ID 与原链接不一致');
  requireValue(typeof d.desc==='string' && d.desc.trim() && d.desc.length<=30_000, 'EMPTY_CONTENT','没有取得目标视频配文；不把页面导航文字当作正文');
  requireValue(d.video && typeof d.video==='object' && !Array.isArray(d.video), 'UNSUPPORTED_CONTENT','当前抖音配方只支持单条视频');
  const urls=[];
  for(const key of ['play_addr_h264','play_addr','download_addr']) {
    const list=d.video[key]?.url_list;
    if(Array.isArray(list)) for(const url of list.slice(0,8)) if(typeof url==='string' && url.length<=8192 && !urls.includes(url))urls.push(url);
  }
  const rawTime=d.create_time;
  const published=Number.isSafeInteger(rawTime) && rawTime>=946684800 && rawTime<=Date.now()/1000+86400 ? new Date(rawTime*1000).toISOString():null;
  return {id:expectedId, title:d.desc.trim().slice(0,200),text:d.desc.trim(),
    author:typeof d.author?.nickname==='string' && d.author.nickname.trim() ? d.author.nickname.trim().slice(0,200):null,
    published_at:published,media_urls:urls.slice(0,12),metadata_source:'observed-browser-network:aweme_detail'};
}

export async function readDouyinSource(message, {runner=run, wait=ms=>new Promise(r=>setTimeout(r,ms)), onStep=()=>{}, onResolved=()=>{}}={}) {
  const original=extractUrl(message), initial=parseDouyinUrl(original);
  const session=`source2brain-dy-${randomUUID().slice(0,8)}`;
  let opened=false;
  try {
    await runner('agent-reach',['doctor','--json'],{timeout:120_000,maxBytes:500_000});
    await runner('opencli',['--version'],{timeout:20_000,maxBytes:20_000});
    onStep('Agent Reach / OpenCLI：复用浏览器桥接；抖音访问以指定页面实际内容为准');
    opened=true;
    const open=unwrap(parseJsonOutput((await runner('opencli',['browser',session,'open',original,'--window','background'],{timeout:45_000,maxBytes:100_000})).stdout));
    requireValue(typeof open?.page==='string' && /^[A-Za-z0-9][A-Za-z0-9:_-]{0,199}$/.test(open.page),'INVALID_TOOL_OUTPUT','OpenCLI 没有返回可独立绑定的目标标签');
    const tab=['--tab',open.page];
    let page, id;
    for(let attempt=0;attempt<4;attempt++) {
      page=unwrap(parseJsonOutput((await runner('opencli',['browser',session,'eval',DOUYIN_PAGE_PROBE,...tab],{timeout:15_000,maxBytes:100_000})).stdout));
      requireValue(typeof page?.href==='string','INVALID_TOOL_OUTPUT','浏览器没有返回当前来源 URL');
      requireValue(!page.security_block,'SECURITY_BLOCK','平台页面要求安全验证，请本人处理，不绕过验证');
      const parsed=parseDouyinUrl(page.href);
      if(parsed.short) {if(attempt<3){await wait(1500);continue;}throw new BrainError('SHORT_URL_UNRESOLVED','抖音短链未跳转到可核对的单条视频');}
      id=parsed.id;
      requireValue(!initial.id || initial.id===id,'SOURCE_MISMATCH','浏览器跳转到了另一条抖音视频');
      onResolved({platform:'douyin',source_id:`dy-${id}`,source_url:parsed.canonical});
      // --filter 仅读取本 session 已捕获响应的形状；--detail 从已存在缓存取正文。
      const capture=unwrap(parseJsonOutput((await runner('opencli',['browser',session,'network','--filter','aweme_detail',...tab],{timeout:15_000,maxBytes:1_000_000})).stdout));
      requireValue(Array.isArray(capture?.entries),'INVALID_TOOL_OUTPUT','OpenCLI 网络捕获输出格式发生变化');
      const entries=capture.entries.slice(0,200).filter(e=>isTargetRequest(e,id));
      for(const entry of entries.slice(-3).reverse()) {
        // OpenCLI 1.8.6 的稳定键格式为 METHOD host+pathname，重复响应追加 #2、#3。
        requireValue(typeof entry.key==='string' && /^GET www\.douyin\.com\/aweme\/v1\/web\/aweme\/detail\/(?:#[2-9][0-9]*|#1[0-9]+)?$/.test(entry.key),'INVALID_TOOL_OUTPUT','网络捕获键无效');
        const detail=unwrap(parseJsonOutput((await runner('opencli',['browser',session,'network','--detail',entry.key,'--max-body','2000000',...tab],{timeout:15_000,maxBytes:2_200_000})).stdout));
        const projected=projectDouyinDetail(detail,id);
        onStep('OpenCLI：读取本页已收到的目标单条响应，并核对 URL 与 aweme_id');
        return {...projected,original_url:original,source_url:parsed.canonical,source_id:`dy-${id}`,platform:'douyin',auth_scope:'reused-browser; login-not-asserted'};
      }
      if(attempt<3) await wait(1500);
    }
    throw new BrainError(page?.login_wall?'AUTH_REQUIRED':'EMPTY_RESULT',page?.login_wall?'页面要求本人登录，尚未取得目标视频内容':'页面没有可核对的目标单条响应；不猜接口或抓取其他视频');
  } finally {
    if(opened)await runner('opencli',['browser',session,'close'],{timeout:10_000,maxBytes:50_000}).catch(()=>{});
  }
}

// 不导出浏览器 Cookie；不追随页面未观察到的主机；下载中断只删除自己创建的 .part。
export async function downloadDouyinVideo(input, directory, id, {
  observedHosts, fetcher = fetch, timeoutMs = 180_000, maxBytes = 256 * 1024 * 1024, maxRedirects = 3,
} = {}) {
  requireValue(/^\d{16,22}$/.test(id), 'INVALID_MEDIA_ID', '媒体文件需要有效抖音视频 ID');
  requireValue(Number.isInteger(maxBytes) && maxBytes > 0 && maxBytes <= 256 * 1024 * 1024,
    'INVALID_MEDIA_LIMIT', '媒体大小限制必须为正值且不超过 256 MiB');
  requireValue(Number.isInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 180_000,
    'INVALID_MEDIA_LIMIT', '媒体下载超时必须为正值且不超过 180 秒');
  requireValue(Number.isInteger(maxRedirects) && maxRedirects >= 0 && maxRedirects <= 3,
    'INVALID_MEDIA_LIMIT', '媒体重定向最多 3 次');
  const root = await fs.realpath(directory);
  const file = path.join(root, `dy-${id}.mp4`);
  const temp = path.join(root, `.dy-${id}-${randomUUID()}.part`);
  let url = validateDouyinMediaUrl(input, observedHosts), handle, bytes = 0, prefix = Buffer.alloc(0);
  const digest = createHash('sha256');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response;
    for (let hop = 0; hop <= maxRedirects; hop++) {
      response = await fetcher(url.href, {redirect:'manual', signal:controller.signal,
        headers:{'Accept':'video/mp4,application/octet-stream;q=0.8'}});
      if (![301,302,303,307,308].includes(response.status)) break;
      await response.body?.cancel();
      requireValue(hop < maxRedirects && response.headers.get('location'), 'MEDIA_REDIRECT_LIMIT', '媒体跳转次数超出限制');
      url = validateDouyinMediaUrl(new URL(response.headers.get('location'), url).href, observedHosts);
    }
    requireValue(response?.ok, `MEDIA_HTTP_${response?.status ?? 'ERROR'}`, '媒体请求失败，请检查平台登录或稍后重试');
    requireValue(response.status === 200 && !response.headers.has('content-range'), 'MEDIA_PARTIAL_RESPONSE', '媒体只返回部分内容，不能作为完整视频保存');
    const lengthHeader = response.headers.get('content-length');
    const length = lengthHeader === null ? null : Number(lengthHeader);
    requireValue(length === null || (/^\d+$/.test(lengthHeader) && Number.isSafeInteger(length) && length > 0 && length <= maxBytes), 'MEDIA_SIZE_LIMIT', '媒体大小声明无效或超出下载限制');
    const type = (response.headers.get('content-type') || '').split(';')[0].toLowerCase();
    requireValue(['video/mp4','application/octet-stream','binary/octet-stream'].includes(type), 'INVALID_MEDIA_TYPE', '媒体响应不是可接受的 MP4 类型');
    requireValue(response.body, 'EMPTY_MEDIA', '媒体响应没有内容');
    handle = await fs.open(temp, 'wx', 0o600);
    for await (const value of response.body) {
      const chunk = Buffer.from(value);bytes += chunk.length;
      requireValue(bytes <= maxBytes, 'MEDIA_SIZE_LIMIT', '媒体下载超过大小限制');
      if (prefix.length < 16) prefix = Buffer.concat([prefix,chunk.subarray(0,16-prefix.length)]);
      digest.update(chunk);await handle.writeFile(chunk);
    }
    requireValue(bytes >= 16 && prefix.subarray(4,8).toString('ascii') === 'ftyp', 'INVALID_MEDIA_FILE', '媒体内容不是完整 MP4 文件头');
    if (length && !response.headers.get('content-encoding')) requireValue(bytes === length, 'MEDIA_TRUNCATED', '媒体实际大小与响应声明不一致');
    await handle.sync();await handle.close();handle = null;
    // link 的目标不能已存在，防止复跑或并发覆盖已有证据。
    await fs.link(temp, file);await fs.unlink(temp);
    return {type:'video',path:file,size:bytes,sha256:digest.digest('hex')};
  } catch (error) {
    if (controller.signal.aborted) throw new BrainError('MEDIA_TIMEOUT', '媒体下载超时，请稍后在有效登录状态重试');
    if (error instanceof BrainError) throw error;
    if (error.code === 'EEXIST') throw new BrainError('MEDIA_EXISTS', '媒体文件已存在，不能覆盖');
    throw new BrainError('MEDIA_DOWNLOAD_FAILED', '媒体下载失败，保留采集回执，不生成完成结果');
  } finally {
    clearTimeout(timer);
    controller.abort();
    await handle?.close().catch(() => {});
    await fs.unlink(temp).catch(() => {});
  }
}
