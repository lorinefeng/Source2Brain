import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { extractUrl, parseXhsUrl, parseSourceUrl, requireValue, BrainError, hash } from './artifact.mjs';
import { expandHome } from './store.mjs';
import { run, parseJsonOutput } from './process.mjs';
import {readDouyinSource, downloadDouyinVideo, validateDouyinMediaUrl} from './douyin.mjs';

const errorCode = (error, fallback='CAPTURE_FAILED') => /^[A-Z][A-Z0-9_]{1,63}$/.test(error?.code) ? error.code : fallback;
const nextAction = code => code === 'AUTH_REQUIRED' ? '在 Agent 所在机器的浏览器中由本人重新登录平台，再用新目录重试。'
  : code === 'SECURITY_BLOCK' ? '平台触发安全限制，停止采集；由本人检查页面并等待平台恢复，不绕过验证。'
  : code === 'SOURCE_MISMATCH' ? '页面与原链接的来源 ID 不一致，请核对原视频或笔记链接后重试。'
  : code === 'SIGNED_URL_REQUIRED' ? '从平台重新复制可打开的分享链接，确认浏览器能访问后重试。'
  : code === 'MEDIA_URL_REJECTED' ? '媒体地址不在本次观察到的官方域范围内，保留回执并由维护者核对，不自行放宽下载范围。'
  : code === 'DEPENDENCY_MISSING' || code === 'BACKEND_UNAVAILABLE' ? '先运行 doctor 并按安装配方补齐对应工具与浏览器桥接。'
  : '保留 partial 与采集回执，确认网络和平台可访问后用新目录重试；不要把配文当作完整知识。';

async function fileReceipt(file, allowedRoot, type) {
  const stat = await fs.lstat(file);
  requireValue(stat.isFile() && !stat.isSymbolicLink() && stat.size > 0, 'INVALID_MEDIA_FILE', '下载成功标记没有对应的有效媒体文件');
  requireValue(stat.size <= 256 * 1024 * 1024, 'MEDIA_SIZE_LIMIT', '媒体文件超过 256 MiB 限制');
  const real = await fs.realpath(file), root = await fs.realpath(allowedRoot);
  const relative = path.relative(root, real);
  requireValue(relative && !relative.startsWith('..') && !path.isAbsolute(relative), 'MEDIA_PATH_ESCAPE', '媒体文件不能越出本次采集目录');
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(real)) digest.update(chunk);
  await fs.chmod(real, 0o600);
  return { type, path: real, size: stat.size, sha256: digest.digest('hex') };
}

export async function captureXhs(message, output, { runner = run } = {}) {
  const original = extractUrl(message);
  const initial = parseXhsUrl(original);
  output = path.resolve(expandHome(output));
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
    if (initial.short) {
      // 等待短链跳转；次数有上限，不尝试绕过登录或风控。
      for (let i = 0; i < 4; i++) {
        const result = await runner('opencli', ['browser', session, 'get', 'url']);
        resolved = result.stdout.trim().split('\n')[0].trim();
        if (!parseXhsUrl(resolved).short) break;
        await new Promise(resolve => setTimeout(resolve, 1500));
      }
    }
    else {
      resolved = (await runner('opencli', ['browser', session, 'get', 'url'])).stdout.trim().split('\n')[0].trim();
    }
    const parsed = parseXhsUrl(resolved);
    requireValue(!initial.id || parsed.id === initial.id, 'SOURCE_MISMATCH', '跳转后的笔记 ID 与原链接不一致');
    requireValue(!parsed.short && parsed.url.searchParams.get('xsec_token'), 'SIGNED_URL_REQUIRED', '尚未取得含 xsec_token 的笔记链接；请在浏览器打开后重试');
    journal.source_url = parsed.canonical;
    journal.source_id = `xhs-${parsed.id}`; journal.platform = 'xiaohongshu';
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
    } catch (e) { mediaError = errorCode(e, 'MEDIA_FAILED'); }
    const video = media.some(m => m.type === 'video');
    const files = [], mediaIssues = [];
    for (const m of media) {
      if (!['image','video'].includes(m.type) || !Number.isInteger(m.index) || m.index < 1 || m.index > 100) {
        mediaIssues.push('媒体结果的类型或顺序字段无效');continue;
      }
      if (m.status !== 'success') {mediaIssues.push(`第 ${m.index} 个媒体下载失败`);continue;}
      try {
        const file=path.join(output, 'media', parsed.id, `${parsed.id}_${m.index}.${m.type === 'video' ? 'mp4' : 'jpg'}`);
        files.push(await fileReceipt(file, output, m.type));
      } catch (error) {mediaIssues.push(`第 ${m.index} 个媒体未通过附件校验：${errorCode(error,'MEDIA_FILE_MISSING')}`);}
    }
    if (!media.length && !mediaError) mediaError='EMPTY_MEDIA';
    if (mediaIssues.length && !mediaError) mediaError='MEDIA_PARTIAL';
    const limitations = [video ? '视频尚未转写；画面未分析' : '图片内容尚未读取'];
    if (mediaError) limitations.push(`媒体采集未完成：${mediaError}`);
    limitations.push(...mediaIssues);
    if (!media.length) limitations.push('未取得媒体清单，视频或图文类型尚未核对，不能提升为完整来源');
    const artifact = {
      schema_version: 1,
      source: { url: parsed.canonical, original_url: original, platform: 'xiaohongshu', title, author: fields.author || null, published_at: null, captured_at: journal.captured_at },
      content: { type: video ? 'video' : 'post', text: fields.content, transcript: '', visual_notes: '' },
      extraction: { status: 'partial', text: 'complete', transcript: video ? 'missing' : 'not_applicable', visuals: 'missing', limitations },
      knowledge: { summary: '', claims: [], insights: [], actions: [], related_topics: [] },
      provenance: { adapter: 'agent-reach/OpenCLI', model: 'pending', steps: [...journal.steps], raw_note_sha256: hash(JSON.stringify(raw)), media_files: files }
    };
    journal.status = 'captured_partial';
    journal.media_error = mediaError;
    journal.media = files; journal.media_issues = mediaIssues;
    journal.next_action = mediaError ? nextAction(mediaError) : '读取全部已下载媒体并完成转写或图片检查，再由 Agent 整理可逐字核对的知识。';
    await write('artifact.json', artifact);
    return { status: 'captured_partial', artifact: path.join(output, 'artifact.json'), media: files, media_error: mediaError, source_url: parsed.canonical, source_id: journal.source_id, platform:journal.platform, next_action:journal.next_action };
  } catch (e) {
    journal.status = 'failed'; journal.error_code = errorCode(e); journal.next_action=nextAction(journal.error_code);
    throw e;
  } finally {
    try {await write('capture.json', journal);}
    finally {if (browserOpened) await runner('opencli', ['browser', session, 'close'], { timeout: 10_000 }).catch(() => {});}
  }
}

export async function captureDouyin(message, output, {runner=run, fetcher=fetch, wait}={}) {
  const original=extractUrl(message), parsed=parseSourceUrl(original);
  requireValue(parsed.platform==='douyin','UNSUPPORTED_HOST','抖音采集器只接受抖音官方单条链接');
  output=path.resolve(expandHome(output));
  await fs.mkdir(path.dirname(output),{recursive:true,mode:0o700});
  await fs.mkdir(output,{mode:0o700});
  const journal={schema_version:1,original_url:original,platform:'douyin',captured_at:new Date().toISOString(),status:'started',steps:[]};
  const write=(name,obj)=>fs.writeFile(path.join(output,name),JSON.stringify(obj,null,2)+'\n',{mode:0o600});
  try {
    const metadata=await readDouyinSource(message,{runner,wait,onStep:step=>journal.steps.push(step),onResolved:fields=>Object.assign(journal,fields)});
    // 临时媒体链接只保存在当前新建私有采集目录，公开返回值/回执不携带签名 URL。
    await write('raw-note.json',metadata);
    let mediaError=null;const files=[],attempts=[];
    const hosts=new Set(metadata.media_urls.flatMap(value=>{try{return[new URL(value).hostname.toLowerCase()];}catch{return[];}}));
    const candidates=metadata.media_urls.filter(value=>{try{validateDouyinMediaUrl(value,hosts);return true;}catch{return false;}}).slice(0,3);
    if(!candidates.length)mediaError=metadata.media_urls.length?'MEDIA_URL_REJECTED':'EMPTY_MEDIA';
    else {
      const mediaDir=path.join(output,'media');await fs.mkdir(mediaDir,{mode:0o700});
      const deadline=Date.now()+180_000;
      for(const [index,candidate]of candidates.entries()) {
        const attempt={candidate:index+1,host:new URL(candidate).hostname};
        try {
          requireValue(Date.now()<deadline,'MEDIA_TIMEOUT','媒体候选共用的下载时间已耗尽');
          const downloaded=await downloadDouyinVideo(candidate,mediaDir,metadata.id,{observedHosts:hosts,fetcher,timeoutMs:Math.max(1,deadline-Date.now())});
          files.push(await fileReceipt(downloaded.path,output,'video'));
          attempts.push({...attempt,status:'downloaded'});mediaError=null;
          journal.steps.push('下载本页实际返回的官方视频媒体；检查文件头、大小和 SHA256');break;
        } catch(error){
          mediaError=errorCode(error,'MEDIA_FAILED');attempts.push({...attempt,status:'failed',error_code:mediaError});
          // 只对平台同次响应自带的 CDN 备选地址回退；限3个、共享180秒，不重试限流或完整性错误。
          if(!['MEDIA_HTTP_403','MEDIA_HTTP_404','MEDIA_HTTP_408','MEDIA_HTTP_500','MEDIA_HTTP_502','MEDIA_HTTP_503','MEDIA_HTTP_504','MEDIA_DOWNLOAD_FAILED'].includes(mediaError))break;
        }
      }
    }
    const limitations=['抖音视频尚未转写；抽样画面未处理','复用浏览器会话读取指定页面，未据此断言账号已登录'];
    if(mediaError)limitations.push(`媒体采集未完成：${mediaError}`);
    const artifact={schema_version:1,
      source:{url:metadata.source_url,original_url:original,platform:'douyin',title:metadata.title,author:metadata.author,published_at:metadata.published_at,captured_at:journal.captured_at},
      content:{type:'video',text:metadata.text,transcript:'',visual_notes:''},
      extraction:{status:'partial',text:'complete',transcript:'missing',visuals:'missing',limitations},
      knowledge:{summary:'',claims:[],insights:[],actions:[],related_topics:[]},
      provenance:{adapter:'agent-reach/OpenCLI-observed-douyin',model:'pending',steps:[...journal.steps],auth_scope:metadata.auth_scope,raw_note_sha256:hash(JSON.stringify(metadata)),media_files:files}};
    await write('artifact.json',artifact);
    Object.assign(journal,{status:'captured_partial',media:files,media_error:mediaError,media_attempts:attempts,
      next_action:mediaError?nextAction(mediaError):'对已下载视频完成本地转写与抽样画面检查，再整理要点并保存。'});
    return {status:'captured_partial',artifact:path.join(output,'artifact.json'),media:files,media_error:mediaError,media_attempts:attempts,
      source_id:metadata.source_id,source_url:metadata.source_url,platform:'douyin',next_action:journal.next_action};
  } catch(error) {
    Object.assign(journal,{status:'failed',error_code:errorCode(error),next_action:nextAction(errorCode(error))});throw error;
  } finally {await write('capture.json',journal);}
}

export async function captureSource(message, output, options={}) {
  const parsed=parseSourceUrl(extractUrl(message));
  return parsed.platform==='douyin'?captureDouyin(message,output,options):captureXhs(message,output,options);
}

// 不下载媒体、不写知识库；返回值只含能力状态，不暴露捕获正文/临时媒体 URL。
export async function probeSource(message, options={}) {
  const parsed=parseSourceUrl(extractUrl(message));
  if(parsed.platform!=='douyin')return{platform:parsed.platform,source_id:parsed.source_id,content_access:'not_probed',media_observed:false,auth_scope:'not_asserted',next_action:'使用 capture 验证指定小红书笔记的真实读取和媒体覆盖。'};
  const result=await readDouyinSource(message,options);
  return{platform:'douyin',source_id:result.source_id,content_access:'readable_metadata',media_observed:result.media_urls.length>0,auth_scope:result.auth_scope,download_verified:false};
}
