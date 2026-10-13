import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { extractUrl, parseSourceUrl, requireValue, BrainError, hash } from './artifact.mjs';
import { readDouyinSource, downloadDouyinVideo, validateDouyinMediaUrl } from './douyin.mjs';
import { run, parseJsonOutput } from './process.mjs';
import { atomicJson, fileDigest, verifyFile, withRetry, retryAfter } from './reliability.mjs';
import { realDirectory } from './enhancement.mjs';

// 对齐 OpenCLI 1.8.6 buildDownloadExtractJs 的当前笔记结构化数据路线。
// 不读取其他笔记、浏览器 Cookie 或整页脚本；拿不到当前笔记就暂停。
export function xhsMediaProbe(id) {
  requireValue(/^[a-f0-9]{24}$/.test(id), 'INVALID_URL', '需要已核对的小红书 ID');
  return `(() => { const id='${id}', body=document.body?.innerText||'';
    const entry=window.__INITIAL_STATE__?.note?.noteDetailMap?.[id]; const n=entry?.note||entry;
    const images=(n?.imageList||[]).map(i=>i.urlDefault||i.urlPre||i.url||i.infoList?.find(x=>x.imageScene==='WB_DFT')?.url||i.infoList?.[0]?.url).filter(Boolean);
    const video=n?.video; const streams=Object.values(video?.media?.stream||{}).flatMap(a=>Array.isArray(a)?a:[]).filter(s=>!s.format||s.format==='mp4').sort((a,b)=>(a.width||0)-(b.width||0));
    const videos=[video?.url,...streams.flatMap(s=>[s.masterUrl,...(s.backupUrls||[])])].filter(u=>typeof u==='string'&&/^https?:/.test(u));
    return {href:location.href,security_block:/安全限制|访问链接异常|请完成.{0,10}验证/.test(body),login_wall:/^(手机号登录|登录)$/.test(document.title),
      content_type:n?.type,media:videos.length?[{type:'video',urls:[...new Set(videos)]}]:n?.type==='video'?[]:images.map(url=>({type:'image',urls:[url]}))}; })()`;
}
const unwrap = v => v && typeof v === 'object' && 'session' in v && 'data' in v ? v.data : v;
function capturedArtifact(meta, files) {
  const video=meta.media.some(m=>m.type==='video');
  return {schema_version:1,source:{url:meta.source_url,original_url:meta.original_url,platform:meta.platform,title:meta.title,author:meta.author,published_at:meta.published_at,captured_at:meta.captured_at},
    content:{type:video?'video':'post',text:meta.text,transcript:'',visual_notes:''},
    extraction:{status:'partial',text:'complete',transcript:video?'missing':'not_applicable',visuals:'missing',limitations:[video?'尚待真实转写与抽样画面识读':'尚待逐页实际看图',...(files.length<meta.media.length?['媒体附件尚未完整下载']:[])]},
    knowledge:{summary:'',claims:[],insights:[],actions:[],related_topics:[]},provenance:{adapter:meta.adapter,model:'pending',steps:['复用 Agent Reach/OpenCLI 浏览器读取当前指定来源','逐附件校验与持久化检查点'],raw_note_sha256:hash(JSON.stringify(meta)),media_files:files}};
}

async function xhsMetadata(message, runner) {
  const original = extractUrl(message), initial = parseSourceUrl(original), session = `s2b-job-${randomUUID().slice(0,8)}`;
  await runner('agent-reach', ['doctor', '--json'], { timeout: 120_000 });
  try {
    await runner('opencli', ['browser', session, 'open', original, '--window', 'background']);
    let resolved;
    for (let i = 0; i < 4; i++) {
      resolved = (await runner('opencli', ['browser', session, 'get', 'url'])).stdout.trim().split('\n')[0];
      if (!parseSourceUrl(resolved).short) break;
      await new Promise(r => setTimeout(r, 1500));
    }
    const parsed = parseSourceUrl(resolved);
    requireValue(!parsed.short && (!initial.id || parsed.id === initial.id), 'SOURCE_MISMATCH', '来源跳转不一致');
    requireValue(parsed.url.searchParams.get('xsec_token'), 'SIGNED_URL_REQUIRED', '需要当前可访问的分享链接');
    const title = (await runner('opencli', ['browser', session, 'get', 'title'])).stdout.trim().split('\n')[0].replace(/ - 小红书$/, '');
    const raw = parseJsonOutput((await runner('opencli', ['xiaohongshu', 'note', resolved, '--site-session', 'ephemeral', '-f', 'json'])).stdout);
    requireValue(Array.isArray(raw) && raw.every(r => typeof r.field === 'string'), 'INVALID_TOOL_OUTPUT', '笔记字段不完整');
    const fields = Object.fromEntries(raw.map(r => [r.field, r.value]));
    const probe = unwrap(parseJsonOutput((await runner('opencli', ['browser', session, 'eval', xhsMediaProbe(parsed.id)])).stdout));
    requireValue(!probe?.security_block, 'SECURITY_BLOCK', '平台要求验证');
    requireValue(!probe?.login_wall && title && !/^(手机号登录|登录|小红书)$/.test(title), 'AUTH_REQUIRED', '请本人登录平台');
    requireValue(parseSourceUrl(probe.href).source_id === parsed.source_id, 'SOURCE_MISMATCH', '媒体页面不对应当前来源');
    requireValue(typeof fields.content === 'string' && fields.content.trim(), 'EMPTY_CONTENT', '没有可读配文');
    requireValue(Array.isArray(probe.media) && probe.media.length > 0 && probe.media.length <= 100, 'EMPTY_MEDIA', '未取得当前笔记媒体，保留待处理');
    return { source_id: parsed.source_id, source_url: parsed.canonical, original_url: original, platform: parsed.platform,
      id: parsed.id, title, text: fields.content, author: fields.author || null, published_at: null, media: probe.media,
      captured_at: new Date().toISOString(), adapter: 'agent-reach/OpenCLI-current-note' };
  } finally { await runner('opencli', ['browser', session, 'close'], { timeout: 10_000 }).catch(() => {}); }
}

function xhsUrl(input, observed) {
  let u; try { u = new URL(input); } catch { throw new BrainError('MEDIA_URL_REJECTED', '媒体地址无效'); }
  // 平台结构化状态常给 HTTP CDN URL；只在同一已观察官方主机升级为 HTTPS，绝不明文下载。
  if(u.protocol==='http:')u.protocol='https:';
  requireValue(u.protocol === 'https:' && !u.port && !u.username && !u.password && observed.has(u.hostname)
    && ['xhscdn.com', 'xiaohongshu.com'].some(d => u.hostname === d || u.hostname.endsWith(`.${d}`)), 'MEDIA_URL_REJECTED', '媒体不在当前页面观察到的官方 CDN 中');
  return u;
}
async function downloadXhs(input, file, type, observed, fetcher) {
  let url = xhsUrl(input, observed), handle;
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 180_000);
  const part = `${file}.${randomUUID()}.part`, digest = createHash('sha256');
  try {
    let response;
    for (let i = 0; i < 4; i++) {
      response = await fetcher(url.href, { redirect: 'manual', signal: controller.signal });
      if (![301,302,303,307,308].includes(response.status)) break;
      await response.body?.cancel();
      requireValue(i < 3 && response.headers.get('location'), 'MEDIA_REDIRECT_LIMIT', '媒体跳转次数超限');
      url = xhsUrl(new URL(response.headers.get('location'), url).href, observed);
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw Object.assign(new BrainError(`MEDIA_HTTP_${response.status}`, '媒体请求失败'), { retry_after_seconds: retryAfter(response.headers.get('retry-after')) });
    }
    requireValue(response.status === 200 && !response.headers.has('content-range'), 'MEDIA_PARTIAL_RESPONSE', '媒体不是完整响应');
    const length = response.headers.get('content-length'), expected = length === null ? null : Number(length);
    requireValue(expected === null || /^\d+$/.test(length) && expected > 0 && expected <= 256 * 1024 * 1024, 'MEDIA_SIZE_LIMIT', '媒体大小声明无效');
    handle = await fs.open(part, 'wx', 0o600); let size = 0, prefix = Buffer.alloc(0);
    for await (const chunk of response.body) {
      const bytes = Buffer.from(chunk); size += bytes.length;
      requireValue(size <= 256 * 1024 * 1024, 'MEDIA_SIZE_LIMIT', '媒体超过限制');
      if (prefix.length < 32) prefix = Buffer.concat([prefix, bytes.subarray(0, 32-prefix.length)]);
      digest.update(bytes); await handle.writeFile(bytes);
    }
    const image = prefix.subarray(0,3).equals(Buffer.from([255,216,255])) || prefix.subarray(1,4).toString() === 'PNG'
      || prefix.subarray(0,4).toString() === 'RIFF' && prefix.subarray(8,12).toString() === 'WEBP';
    requireValue(size > 16 && (type === 'video' ? prefix.subarray(4,8).toString() === 'ftyp' : image), 'INVALID_MEDIA_FILE', '媒体文件头无效');
    requireValue(expected === null || response.headers.has('content-encoding') || size === expected, 'MEDIA_TRUNCATED', '媒体下载不完整');
    await handle.sync(); await handle.close(); handle = null;
    await fs.link(part, file); return { path: file, type, size, sha256: digest.digest('hex') };
  } catch (e) {
    if (controller.signal.aborted) throw new BrainError('MEDIA_TIMEOUT', '下载超时');
    if (e instanceof BrainError || e.code === 'EEXIST') throw e;
    throw new BrainError('MEDIA_DOWNLOAD_FAILED', '媒体连接中断');
  } finally { clearTimeout(timer); controller.abort(); await handle?.close().catch(() => {}); await fs.unlink(part).catch(() => {}); }
}

// download 的每个附件有一个预算；候选切换与网络重试共用最多三次。
export async function captureJob(message, directory, { runner = run, fetcher = fetch, wait, checkpoint = async () => {}, beforeDownload, onMetadata } = {}) {
  await realDirectory(directory, true);
  const stateFile = path.join(directory, 'capture-state.json');
  let state = await fs.readFile(stateFile, 'utf8').then(JSON.parse).catch(e => { if (e.code === 'ENOENT') return { schema_version: 1, files: [], attempts: [] }; throw e; });
  const commit = async () => {
    if(state.metadata) {
      const draft=capturedArtifact(state.metadata,state.files),name=`partial-${hash(JSON.stringify(draft)).slice(0,24)}.json`;
      const target=path.join(directory,name);
      if(!await fs.lstat(target).catch(e=>{if(e.code==='ENOENT')return null;throw e;}))await atomicJson(target,draft);
      state.partial_artifact=target;
    }
    await atomicJson(stateFile, state); await checkpoint(state);
  };
  const parsed = parseSourceUrl(extractUrl(message));
  const getMetadata = async () => {
    const value = parsed.platform === 'douyin' ? await readDouyinSource(message, { runner, wait }) : await xhsMetadata(message, runner);
    if (parsed.platform === 'douyin') Object.assign(value, { captured_at: new Date().toISOString(), adapter: 'agent-reach/OpenCLI-observed-douyin', media: [{ type: 'video', urls: value.media_urls }] });
    if (state.metadata) requireValue(state.metadata.source_id === value.source_id && state.metadata.text === value.text && state.metadata.media.length === value.media.length
      && state.metadata.media.every((m,i) => m.type === value.media[i].type), 'SOURCE_CHANGED', '来源或媒体清单变化，停止恢复');
    if(state.metadata && parsed.platform==='xiaohongshu') {
      const identity=item=>new URL(item.urls[0]).pathname.split('!')[0];
      requireValue(state.metadata.media.every((m,i)=>m.type!=='image'||identity(m)===identity(value.media[i])),'SOURCE_CHANGED','图文图片顺序或内容地址已变化，不能混用旧页');
    }
    state.metadata = value; await commit(); return value;
  };
  if (!state.metadata) await withRetry(getMetadata, { stage: 'capture', wait, onAttempt: async a => { state.attempts.push(a); await commit(); } });
  const meta = state.metadata;
  requireValue(!parsed.source_id || parsed.source_id === meta.source_id, 'SOURCE_MISMATCH', '采集检查点来源不一致');
  const adoption=await onMetadata?.(meta);
  if(adoption)return adoption;
  await realDirectory(path.join(directory, 'media'), true);
  for (let index = 0; index < meta.media.length; index++) {
    const existing = state.files.find(f => f.index === index + 1);
    if (existing) { await verifyFile(existing, directory); continue; }
    const type = meta.media[index].type;
    requireValue(['video','image'].includes(type), 'INVALID_MEDIA_TYPE', '媒体类型无效');
    const file = path.join(directory, 'media', `${meta.id}_${index+1}.${type === 'video' ? 'mp4' : 'jpg'}`);
    // 文件发布在检查点之前的故障窗口：只有完成回执可用于接管，孤立文件不冒充成功。
    const ready = `${file}.receipt.json`;
    const orphan = await fs.readFile(ready, 'utf8').then(JSON.parse).catch(e => { if (e.code === 'ENOENT') return null; throw e; });
    if (orphan) { await verifyFile(orphan, directory); state.files.push({ ...orphan, index:index+1, type }); await commit(); continue; }
    if (await fs.lstat(file).catch(e => { if (e.code === 'ENOENT') return null; throw e; })) throw new BrainError('UNVERIFIED_MEDIA', '存在未登记媒体，请审阅；不会覆盖');
    await withRetry(async attempt => {
      // 手动恢复与签名地址失败均重新读取页面；成功附件保持原哈希。
      if (state.refresh || attempt > 1) await getMetadata();
      const item = state.metadata.media[index], urls = item.urls.slice(0,3);
      requireValue(urls.length > 0, 'EMPTY_MEDIA', '没有可下载的媒体');
      const observed = new Set(urls.map(u => { try { return new URL(u).hostname; } catch { return ''; } }));
      const candidate = urls[Math.min(attempt-1, urls.length-1)];
      await beforeDownload?.({ index:index+1, attempt });
      let result;
      try {
        if (parsed.platform === 'douyin') {
          validateDouyinMediaUrl(candidate, observed);
          result = await downloadDouyinVideo(candidate, path.dirname(file), `${meta.id}_${index+1}`.split('_')[0], { observedHosts:observed, fetcher });
          // 上游文件名不含附件序号，统一为任务确定路径。
          if (result.path !== file) { await fs.link(result.path, file); await fs.unlink(result.path); result.path = file; }
        } else result = await downloadXhs(candidate, file, type, observed, fetcher);
      } catch (error) {
        if (['MEDIA_HTTP_403','MEDIA_HTTP_404'].includes(error.code) && attempt < 3) throw new BrainError('NETWORK_ERROR', '临时媒体地址失效，重新读取来源');
        throw error;
      }
      result = { ...await fileDigest(result.path, directory), type, index:index+1 };
      await atomicJson(ready, result); state.files.push(result); state.refresh = false; await commit();
    }, { stage:`download:${index+1}`, wait, onAttempt: async a => { state.attempts.push(a); await commit(); } });
  }
  const artifact = capturedArtifact(meta,state.files);
  const target = path.join(directory, 'artifact.json'); await atomicJson(target, artifact);
  state.complete = true; await commit();
  return { artifact:target, source_id:meta.source_id, media:state.files };
}

export async function refreshCapture(directory) {
  const file = path.join(directory, 'capture-state.json');
  const state = await fs.readFile(file, 'utf8').then(JSON.parse).catch(e => { if (e.code === 'ENOENT') return null; throw e; });
  if (state && !state.complete) { state.refresh = true; await atomicJson(file, state); }
}
