import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import { hash, requireValue, BrainError, extractUrl, parseSourceUrl, validateArtifact, contentHash } from './artifact.mjs';
import { initStore, expandHome, saveSource } from './store.mjs';
import { realDirectory, readRegular, validateEnhancement, checkFrameFiles, saveEnhancement } from './enhancement.mjs';
import { readSource } from './review.mjs';
import { captureJob, refreshCapture } from './job-capture.mjs';
import { enhanceVideo } from './media.mjs';
import { run } from './process.mjs';
import { atomicJson, fileDigest, verifyFile, withLock, failure, safeCode } from './reliability.mjs';
import { transcribeArtifact } from './transcribe.mjs';

const now = () => new Date().toISOString();
const jobId = id => requireValue(/^job-[a-f0-9]{24}$/.test(id), 'INVALID_JOB_ID', '任务号无效');
const steps = ['capture','download','transcribe','organize','save','frames','vision','enhancement','save_enhancement','index','prepare_reply','reply'];

async function location(store, create = false) {
  let root = expandHome(store);
  // 接受系统临时目录的 /var -> /private/var，知识库本身及内部不能是链接。
  if (create) ({ root } = await initStore(root));
  const stat = await fs.lstat(root); requireValue(stat.isDirectory() && !stat.isSymbolicLink(), 'UNSAFE_PATH', '知识库不能是符号链接');
  root = await fs.realpath(root);
  await realDirectory(path.join(root, '.source2brain'), create);
  const jobs = path.join(root, '.source2brain', 'jobs');
  if (create) await realDirectory(jobs, true);
  return { root, jobs };
}
function scopeKey(profile, scope) {
  requireValue(typeof profile === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(profile), 'INVALID_PROFILE', 'profile 无效');
  requireValue(typeof scope === 'string' && scope.length >= 1 && scope.length <= 512, 'SCOPE_REQUIRED', '需要当前可信会话的稳定 scope；不能使用来源正文');
  return hash(`${profile}\n${scope}`);
}
async function load(store, id, profile, scope) {
  jobId(id); const base = await location(store);
  const folder = path.join(base.jobs, id); await realDirectory(folder);
  let job;try {job=JSON.parse(await readRegular(path.join(folder, 'state.json')));}catch{throw new BrainError('INVALID_JOB','任务状态无法读取；保留证据等待修复');}
  requireValue(job.schema_version === 1 && job.kind === 'source_job' && job.id === id && job.store === base.root, 'INVALID_JOB', '任务记录不完整或不属于当前库');
  requireValue(job.scope_key === scopeKey(profile, scope) && job.profile === profile, 'JOB_SCOPE_MISMATCH', '任务不属于当前可信会话范围');
  requireValue(job.steps && job.outputs && job.units && job.delivery && typeof job.status==='string', 'INVALID_JOB', '任务缺少步骤、检查点或回复状态');
  return { ...base, folder, job };
}
async function persist(ctx) { ctx.job.updated_at = now(); await atomicJson(path.join(ctx.folder, 'state.json'), ctx.job); }
function view(ctx) {
  const { job, folder } = ctx;
  const saved = job.steps.save?.result;
  return { ok: !['blocked','interrupted'].includes(job.status), schema_version:1, task_id:job.id, status:job.status,
    source_id:job.source_id, source_url:job.canonical_url || null, requirements:job.requirements, current_step:job.current_step,
    steps:Object.fromEntries(Object.entries(job.steps).map(([name,s]) => [name,{status:s.status,attempts:s.attempts?.filter(a=>a.status==='running'||a.started_at||a.action_id).length || 0,...(s.result ? {result:s.result}: {})}])),
    error:job.error || null, preserved:Object.entries(job.outputs).map(([key,f]) => ({kind:key,path:f.path,sha256:f.sha256})),
    saved:saved || null, index_status:job.steps.index?.status || 'pending', delivery_status:job.delivery.status,
    next_action:job.action ? {...job.action,task_directory:folder} : job.error?.next_action || (job.status === 'completed' ? '任务完成；重发结果不会重新采集。' : '说“继续处理”以恢复。') };
}
async function observedView(ctx) {
  if(ctx.job.alias_of)return{...await statusJob({store:ctx.root,id:ctx.job.alias_of,profile:ctx.job.profile,scope:ctx.scope}),alias_task_id:ctx.job.id};
  const result=view(ctx);
  if(ctx.job.status==='running') {
    const lock=await fs.readFile(path.join(ctx.folder,'.run.lock'),'utf8').then(JSON.parse).catch(e=>{if(e.code==='ENOENT')return null;throw e;});
    let dead=!lock;
    if(lock?.host===os.hostname() && Number.isSafeInteger(lock.pid) && lock.pid>0)try{process.kill(lock.pid,0);}catch(e){dead=e.code==='ESRCH';}
    if(dead)return{...result,ok:false,status:'interrupted',next_action:'执行者已退出；说“继续处理”以检查并恢复已有结果。'};
  }
  return result;
}
async function outputsValid(ctx) {
  for (const f of Object.values(ctx.job.outputs)) await verifyFile(f, ctx.root);
  for (const f of Object.values(ctx.job.units)) await verifyFile(f.receipt, ctx.root);
  const captureState = await fs.readFile(path.join(ctx.folder,'capture/capture-state.json'),'utf8').then(JSON.parse).catch(e=>{if(e.code==='ENOENT')return null;throw e;});
  for (const f of captureState?.files || []) await verifyFile(f, ctx.folder);
  if (ctx.job.outputs.frames) {
    const a = JSON.parse(await readRegular(ctx.job.outputs.frames.path)); validateEnhancement(a); await checkFrameFiles(a, path.dirname(ctx.job.outputs.frames.path));
  }
  if (ctx.job.steps.save?.status === 'complete') {
    const result = await readSource(ctx.root, ctx.job.source_id);
    requireValue(result.ok, 'DAMAGED_SOURCE', '已存来源损坏，停止恢复');
  }
}
async function reconcile(ctx) {
  const {job}=ctx;
  // 子进程可能在父进程遭 SIGKILL 后仍运行；不冒险杀掉可能复用 PID 的进程，也不重复启动。
  const processFile=path.join(ctx.folder,'process.json');
  const child=await fs.readFile(processFile,'utf8').then(JSON.parse).catch(e=>{if(e.code==='ENOENT')return null;throw e;});
  if(child) {
    requireValue(Number.isSafeInteger(child.pid) && child.pid>0,'INVALID_JOB','子进程记录无效');
    let dead=false;try{process.kill(child.group?-child.pid:child.pid,0);}catch(e){dead=e.code==='ESRCH';}
    requireValue(dead,'COMMAND_STILL_RUNNING','上次子进程可能仍在运行；请等待或核实后停止，不能重复启动');
    await fs.unlink(processFile);
  }
  if(job.outputs.organized && job.steps.organize?.status!=='complete') {job.steps.organize.status='complete';if(job.action?.stage==='organize')job.action=null;}
  if(job.outputs.enhancement && job.steps.enhancement?.status!=='complete') {job.steps.enhancement.status='complete';if(job.action?.stage==='enhancement')job.action=null;}
  if(job.outputs.reply && job.steps.prepare_reply?.status!=='complete') {job.steps.prepare_reply.status='complete';if(job.action?.stage==='prepare_reply')job.action=null;}
  const pending=job.action;
  if(pending?.stage==='vision') {
    const target=path.join(ctx.folder,'units',`${pending.unit_id}.json`);
    const unit=await fs.readFile(target,'utf8').then(JSON.parse).catch(e=>{if(e.code==='ENOENT')return null;throw e;});
    if(unit){requireValue(unit.unit_id===pending.unit_id && unit.input_sha256===pending.input_sha256,'SOURCE_MISMATCH','孤立视觉结果与任务不匹配');reviewer(unit.vision);job.units[unit.unit_id]={receipt:await fileDigest(target,ctx.root)};job.action=null;}
  }
  await persist(ctx);
}
async function checkpoint(ctx, key, file) { ctx.job.outputs[key] = await fileDigest(file, ctx.root); await persist(ctx); }
async function pause(ctx, error, stage) {
  ctx.job.status = 'blocked'; ctx.job.current_step = stage; ctx.job.error = error.failure || failure(error, stage);
  ctx.job.action = null;
  const partial=ctx.job.outputs.transcribed || ctx.job.outputs.captured || ctx.job.outputs.partial_capture;
  if(partial && ctx.job.steps.save?.status!=='complete') {
    try {await verifyFile(partial,ctx.root);const a=JSON.parse(await readRegular(partial.path));if(a.extraction.status==='partial')ctx.job.pending=await saveSource(ctx.root,a);}
    catch(e){ctx.job.pending={status:'not_updated',code:safeCode(e)};}
  }
  await persist(ctx); return view(ctx);
}
async function automatic(ctx, stage, work) {
  ctx.job.current_step = stage; ctx.job.status = 'running'; ctx.job.steps[stage] ||= {status:'pending',attempts:[]};
  const attempt = {status:'running',started_at:now(),cycle:ctx.job.cycle};
  ctx.job.steps[stage].status='running';ctx.job.steps[stage].attempts.push(attempt);await persist(ctx);
  try { const result=await work();attempt.status='complete';attempt.finished_at=now();ctx.job.steps[stage].status='complete';if(result)ctx.job.steps[stage].result=result;await persist(ctx);return result; }
  catch(error){attempt.status='failed';attempt.code=safeCode(error);attempt.finished_at=now();ctx.job.steps[stage].status='failed';throw error;}
}
async function hostAction(ctx, stage, detail) {
  ctx.job.current_step=stage;ctx.job.status='waiting_for_host';ctx.job.error=null;
  ctx.job.steps[stage] ||= {status:'pending',attempts:[]};ctx.job.steps[stage].status='waiting_for_host';
  ctx.job.action={action_id:randomUUID(),stage,...detail};
  if(stage==='reply')ctx.job.delivery.status='in_flight';
  await persist(ctx);return view(ctx);
}
function reviewer(v) {
  const r=v?.reviewer;
  requireValue(v?.status==='complete' && typeof v.text==='string' && typeof v.description==='string'
    && r && typeof r.identity==='string' && r.identity.trim() && (r.model===null || typeof r.model==='string' && r.model.trim() && r.model!=='pending')
    && typeof r.tool==='string' && r.tool.trim() && r.visual_input_received===true && typeof r.reviewed_at==='string'
    && /^\d{4}-\d{2}-\d{2}T/.test(r.reviewed_at) && !Number.isNaN(Date.parse(r.reviewed_at)), 'VISION_NOT_REVIEWED','逐页/帧必须记录真实图像输入与执行者；空文字可保留');
}

export async function createJob({store,profile='source2brain',scope,message,requirements='video',...options}) {
  requireValue(['video','audio'].includes(requirements),'INVALID_ARGUMENTS','requirements 为 video（口播与抽样画面）或 audio');
  const key=scopeKey(profile,scope),url=extractUrl(message),parsed=parseSourceUrl(url),base=await location(store,true);
  return withLock(path.join(base.jobs,'.create.lock'),async()=>{
    for(const name of await fs.readdir(base.jobs)) {
      if(!/^job-[a-f0-9]{24}$/.test(name))continue;
      const ctx=await load(store,name,profile,scope).catch(e=>{if(['JOB_SCOPE_MISMATCH','INVALID_JOB'].includes(e.code))return null;throw e;});
      if(!ctx)continue;
      const j=ctx.job;
      if((parsed.source_id && j.source_id===parsed.source_id || j.original_url===url) && j.requirements===requirements) return {...view(ctx),reused:true};
    }
    const id=`job-${randomUUID().replaceAll('-','').slice(0,24)}`,folder=path.join(base.jobs,id);await realDirectory(folder,true);
    const job={schema_version:1,kind:'source_job',id,store:base.root,profile,scope_key:key,original_url:url,canonical_url:parsed.canonical,source_id:parsed.source_id,
      requirements,status:'ready',current_step:'capture',cycle:0,created_at:now(),updated_at:now(),steps:{},outputs:{},units:{},action:null,error:null,delivery:{status:'not_prepared'}};
    const ctx={...base,folder,job};await persist(ctx);
    // 已有知识先回读，不为重复链接启动采集，也不覆盖人工笔记。
    if(parsed.source_id) {
      const existing=await fs.lstat(path.join(base.root,'Sources',parsed.source_id)).catch(e=>{if(e.code==='ENOENT')return null;throw e;});
      if(existing) {
        try {
          const read=await readSource(base.root,parsed.source_id);requireValue(read.ok,'DAMAGED_SOURCE','已有知识损坏');
          const original=path.join(base.root,'Sources',parsed.source_id,'artifact.json'),a=JSON.parse(await readRegular(original));
          validateArtifact(a);await checkpoint(ctx,'organized',original);
          job.steps.save={status:'complete',attempts:[],result:{status:'duplicate',source_id:parsed.source_id,path:path.join(path.dirname(original),'source.md'),indexed:false}};
          job.steps.organize={status:'complete',attempts:[]};job.steps.capture={status:'complete',attempts:[]};job.steps.download={status:'complete',attempts:[]};job.steps.transcribe={status:'complete',attempts:[]};
          const completeVisual=read.enhancements?.some(e=>e.schema_version===2);
          if(a.content.type==='post' || requirements==='audio' || completeVisual) {
            for(const step of ['frames','vision','enhancement','save_enhancement'])job.steps[step]={status:'not_applicable',attempts:[]};
          }
          await persist(ctx);
        }catch(error){return pause(ctx,error,'capture');}
      }
    }
    return view(ctx);
  });
}

export async function listJobs({store,profile='source2brain',scope}) {
  scopeKey(profile,scope);
  let base;try{base=await location(store);}catch(e){if(e.code==='ENOENT')return{ok:true,tasks:[]};throw e;}
  const names=await fs.readdir(base.jobs).catch(e=>{if(e.code==='ENOENT')return[];throw e;});const tasks=[];let unreadable=false;
  for(const name of names.filter(n=>/^job-[a-f0-9]{24}$/.test(n))) {
    const ctx=await load(store,name,profile,scope).catch(e=>{if(e.code==='JOB_SCOPE_MISMATCH')return null;if(e.code==='INVALID_JOB'){unreadable=true;return null;}throw e;});if(ctx && !ctx.job.alias_of)tasks.push(await observedView({...ctx,scope}));
  }
  return{ok:true,tasks,...(unreadable?{warning:'部分任务记录不可读，已保留；不显示无法确认归属的任务。'}:{})};
}
export async function statusJob({store,id,profile='source2brain',scope}) {
  const ctx=await load(store,id,profile,scope);
  try {await outputsValid(ctx);return observedView({...ctx,scope});}catch(error){return{...view(ctx),ok:false,error:failure(error,ctx.job.current_step),next_action:'检查点损坏，停止复用；修复原文件后继续。'};}
}

async function advance(ctx,services={}) {
  services={...services,runner:services.runner || ((command,args,options={})=>run(command,args,{...options,processReceipt:path.join(ctx.folder,'process.json')}))};
  const {job}=ctx, done=s=>['complete','not_applicable'].includes(job.steps[s]?.status);
  if(!done('capture') || !done('download')) {
    const result=await automatic(ctx,'download',()=> (services.capture||captureJob)(job.original_url,path.join(ctx.folder,'capture'),{
      ...services,onMetadata:async metadata=>{
        // 短链身份只能打开后得知：在下载前按平台 ID 查重。
        for(const name of (await fs.readdir(ctx.jobs)).filter(n=>/^job-[a-f0-9]{24}$/.test(n)&&n!==job.id)) {
          const prior=await load(ctx.root,name,job.profile,services.scope).catch(e=>{if(['JOB_SCOPE_MISMATCH','INVALID_JOB'].includes(e.code))return null;throw e;});
          if(prior && prior.job.source_id===metadata.source_id && prior.job.requirements===job.requirements && !prior.job.alias_of && `${prior.job.created_at}:${prior.job.id}`<`${job.created_at}:${job.id}`) {
            await outputsValid(prior);return{alias_task_id:prior.job.id,source_id:metadata.source_id};
          }
        }
        const original=path.join(ctx.root,'Sources',metadata.source_id,'artifact.json');
        if(await fs.lstat(original).catch(e=>{if(e.code==='ENOENT')return null;throw e;})) {
          const read=await readSource(ctx.root,metadata.source_id);requireValue(read.ok,'DAMAGED_SOURCE','已有来源损坏');
          requireValue(read.source.artifact.content.text===metadata.text,'SOURCE_CHANGED','来源配文变化，保留旧知识等待审阅');
          return{artifact:original,source_id:metadata.source_id,adopted_source:true};
        }
      },checkpoint:async state=>{
        if(state.metadata){job.source_id=state.metadata.source_id;job.canonical_url=state.metadata.source_url;job.steps.capture={status:'complete',attempts:state.attempts.filter(a=>a.stage==='capture')};}
        if(state.partial_artifact)job.outputs.partial_capture=await fileDigest(state.partial_artifact,ctx.root);
        job.steps.download.attempts=state.attempts.filter(a=>a.stage.startsWith('download:'));await persist(ctx);
      }}));
    if(result.alias_task_id) {
      job.alias_of=result.alias_task_id;job.status='aliased';job.current_step=null;await persist(ctx);
      const prior=await load(ctx.root,result.alias_task_id,job.profile,services.scope);return{...view(prior),reused:true,alias_task_id:job.id};
    }
    job.source_id=result.source_id;job.steps.capture ||= {status:'complete',attempts:[]};job.steps.capture.status='complete';
    await checkpoint(ctx,'captured',result.artifact);
    if(result.adopted_source) {
      await checkpoint(ctx,'organized',result.artifact);job.steps.organize={status:'complete',attempts:[]};job.steps.transcribe={status:'complete',attempts:[]};
      const read=await readSource(ctx.root,job.source_id),a=read.source.artifact;
      if(a.content.type==='post'||job.requirements==='audio'||read.enhancements.some(e=>e.schema_version===2))for(const stage of ['frames','vision','enhancement','save_enhancement'])job.steps[stage]={status:'not_applicable',attempts:[]};
      await persist(ctx);
    }
  }
  let sourcePath=job.outputs.organized?.path || job.outputs.transcribed?.path || job.outputs.captured?.path;
  let source=JSON.parse(await readRegular(sourcePath));validateArtifact(source);
  requireValue(validateArtifact(source).id===job.source_id,'SOURCE_MISMATCH','任务与来源不一致');
  const video=source.content.type==='video';
  if(video && !done('transcribe')) {
    await automatic(ctx,'transcribe',async()=>{
      const result=await (services.transcribe||transcribeArtifact)(sourcePath,{out:path.join(ctx.folder,'artifact-transcribed.json'),runner:services.runner||run});
      await checkpoint(ctx,'transcribed',result.artifact);return result;
    });
    sourcePath=job.outputs.transcribed.path;source=JSON.parse(await readRegular(sourcePath));
  } else if(!video && !job.steps.transcribe) {job.steps.transcribe={status:'not_applicable',attempts:[]};await persist(ctx);}
  // 图文先读图，视频先存好音频来源，再处理独立画面增强。
  if(!video && !done('vision')) {
    const images=source.provenance.media_files.filter(f=>f.type==='image');requireValue(images.length>0,'EMPTY_MEDIA','没有可读取图片');
    for(const [i,f]of images.entries()) {
      const key=`page-${i+1}`;
      if(job.units[key])continue;
      await verifyFile(f,ctx.folder);
      return hostAction(ctx,'vision',{unit_id:key,input:f.path,input_sha256:f.sha256,source_artifact:sourcePath,output:path.join(ctx.folder,`${key}-result.json`),instruction:'实际查看本页图片，逐字识读；不确定不猜测。记录 vision 与真实 reviewer。'});
    }
    job.steps.vision={...(job.steps.vision||{attempts:[]}),status:'complete'};await persist(ctx);
  }
  if(!done('organize')) return hostAction(ctx,'organize',{input:sourcePath,visual_results:Object.values(job.units).map(u=>u.receipt.path),output:path.join(ctx.folder,`organized-${randomUUID()}.json`),instruction:'保留来源正文和真实转写，按 SourceArtifact v1 整理；图文须使用逐页真实识读结果。'});
  sourcePath=job.outputs.organized.path;source=JSON.parse(await readRegular(sourcePath));
  if(!done('save')) await automatic(ctx,'save',()=>saveSource(ctx.root,source));
  if(video && job.requirements==='video' && !done('frames')) {
    await automatic(ctx,'frames',async()=>{
      let dir=path.join(ctx.folder,`frames-${job.steps.frames.attempts.length}`);
      for(const name of (await fs.readdir(ctx.folder)).filter(n=>/^frames-\d+$/.test(n)).sort().reverse()) {
        const prior=path.join(ctx.folder,name,'enhancement.json');
        const value=await fs.readFile(prior,'utf8').then(JSON.parse).catch(e=>{if(e.code==='ENOENT')return null;throw e;});
        if(value?.coverage?.frames==='complete' && value.source.base_content_sha256===contentHash(source)) {dir=path.dirname(prior);break;}
      }
      // 完整抽帧产物写盘但步骤未登记时接管，不重新抽帧。
      let result;
      const target=path.join(dir,'enhancement.json');
      if(await fs.lstat(target).catch(e=>{if(e.code==='ENOENT')return null;throw e;}))result={artifact:target};
      else result=await(services.enhance||enhanceVideo)(sourcePath,dir,{runner:services.runner||run});
      const a=JSON.parse(await readRegular(result.artifact));validateEnhancement(a);await checkFrameFiles(a,path.dirname(result.artifact));
      requireValue(a.coverage.frames==='complete','FRAMES_INCOMPLETE','抽帧未完成，保留证据后暂停');
      await checkpoint(ctx,'frames',result.artifact);return{artifact:result.artifact,frames:a.frames.length};
    });
  }
  if(video && job.requirements==='video' && !done('vision')) {
    const a=JSON.parse(await readRegular(job.outputs.frames.path));
    for(const frame of a.frames) {
      if(job.units[frame.id])continue;
      return hostAction(ctx,'vision',{unit_id:frame.id,input:path.join(path.dirname(job.outputs.frames.path),frame.path),input_sha256:frame.sha256,timestamp_seconds:frame.timestamp_seconds,source_artifact:sourcePath,
        output:path.join(ctx.folder,`${frame.id}-result.json`),instruction:'实际查看此帧，逐字识读，空文字可记录；不要猜测。保存 vision 和真实 reviewer。'});
    }
    job.steps.vision={...(job.steps.vision||{attempts:[]}),status:'complete'};await persist(ctx);
  }
  if(video && job.requirements==='video' && !done('enhancement')) {
    const a=JSON.parse(await readRegular(job.outputs.frames.path));
    for(const frame of a.frames)frame.vision=JSON.parse(await readRegular(job.units[frame.id].receipt.path)).vision;
    a.coverage.vision='complete';a.coverage.status='partial';a.coverage.review='pending';
    const input=path.join(path.dirname(job.outputs.frames.path),'vision-reviewed.json');await atomicJson(input,a);
    return hostAction(ctx,'enhancement',{input,source_artifact:sourcePath,output:path.join(path.dirname(input),`enhancement-reviewed-${randomUUID()}.json`),instruction:'与口播对照，整理有逐字帧引文的增强；没有可靠新增文字事实则保留 partial，不能伪造完成。'});
  }
  if(video && job.requirements==='video' && !done('save_enhancement')) await automatic(ctx,'save_enhancement',()=>saveEnhancement(ctx.root,job.outputs.enhancement.path));
  if(!video || job.requirements==='audio')for(const stage of ['frames','enhancement','save_enhancement',...(video?['vision']:[])])if(!job.steps[stage])job.steps[stage]={status:'not_applicable',attempts:[]};
  if(!done('index'))return hostAction(ctx,'index',{source_id:job.source_id,source_path:job.steps.save.result.path,instruction:'按当前宿主更新/查询当前库索引并读取此次来源；返回工具、query、matched_paths、read_paths。文件检索不称语义检索。'});
  if(!done('prepare_reply'))return hostAction(ctx,'prepare_reply',{source_id:job.source_id,source_path:job.steps.save.result.path,output:path.join(ctx.folder,`reply-${randomUUID()}.json`),instruction:'准备中文答复 text，包含原链接、要点、保存和检索状态、覆盖与缺口；此步不发送。'});
  if(!done('reply'))return hostAction(ctx,'reply',{reply_file:job.outputs.reply.path,instruction:'只在当前可信会话按宿主规则发送已有 text；随后登记 sent 或 uncertain，不代表手机已收件。'});
  job.status='completed';job.current_step=null;job.action=null;job.error=null;await persist(ctx);return view(ctx);
}

export async function resumeJob({store,id,profile='source2brain',scope,resend=false}, services={}) {
  const ctx=await load(store,id,profile,scope);
  if(ctx.job.alias_of)return resumeJob({store,id:ctx.job.alias_of,profile,scope,resend},services);
  return withLock(path.join(ctx.folder,'.run.lock'),async()=>{
    // 取得锁后重读，避免并发等待期间使用旧状态。
    ctx.job=(await load(store,id,profile,scope)).job;
    try {
      await outputsValid(ctx);
      await reconcile(ctx);
      if(resend) {
        requireValue(ctx.job.outputs.reply,'NO_REPLY','尚未准备最终答复');
        ctx.job.steps.reply={...(ctx.job.steps.reply||{attempts:[]}),status:'pending'};
        return hostAction(ctx,'reply',{reply_file:ctx.job.outputs.reply.path,resend:true,instruction:'用户要求补发；只发送已保存 text，不采集、不整理。可能重复送达。'});
      }
      if(ctx.job.action) {
        if(ctx.job.action.stage==='reply') {ctx.job.delivery.status='uncertain';return pause(ctx,new BrainError('DELIVERY_UNCERTAIN','不能确定上一发送是否完成'),'reply');}
        return view(ctx);
      }
      if(ctx.job.delivery.status==='uncertain' || ctx.job.current_step==='reply' && ctx.job.status==='blocked')return view(ctx);
      if(ctx.job.status==='completed')return view(ctx);
      ctx.job.cycle++;ctx.job.error=null;
      await refreshCapture(path.join(ctx.folder,'capture'));
      return await advance(ctx,{...services,scope});
    } catch(error){return pause(ctx,error,ctx.job.current_step||'resume');}
  });
}

export async function recordJob({store,id,profile='source2brain',scope,actionId,resultFile},services={}) {
  const ctx=await load(store,id,profile,scope);
  if(ctx.job.alias_of)return recordJob({store,id:ctx.job.alias_of,profile,scope,actionId,resultFile},services);
  return withLock(path.join(ctx.folder,'.run.lock'),async()=>{
    ctx.job=(await load(store,id,profile,scope)).job;const {job}=ctx,action=job.action;
    requireValue(action && action.action_id===actionId,'STALE_ACTION','操作已过期或不属于当前步骤，不能登记迟到结果');
    await outputsValid(ctx);
    const input=path.resolve(expandHome(resultFile));await fileDigest(input,ctx.folder);
    const data=JSON.parse(await readRegular(input));const stage=action.stage;
    job.steps[stage].attempts ||= [];
    const attempt={cycle:job.cycle,action_id:actionId,unit_id:action.unit_id||null,finished_at:now()};job.steps[stage].attempts.push(attempt);
    if(data.ok===false) {
      const info=failure(data,stage,job.steps[stage].attempts.filter(a=>a.cycle===job.cycle && a.unit_id===attempt.unit_id).length);
      Object.assign(attempt,{status:'failed',code:info.code});job.action=null;
      if(stage==='reply'){job.delivery.status=data.code==='DELIVERY_UNCERTAIN'?'uncertain':'failed';return pause(ctx,new BrainError(info.code,'回复未完成'),stage);}
      job.error=info;
      if(info.retryable && info.attempt<3) {
        job.status='waiting_for_host';job.action={...action,action_id:randomUUID(),retry_after_seconds:Math.max(info.attempt===1?2:8,info.retry_after_seconds)};await persist(ctx);return view(ctx);
      }
      return pause(ctx,Object.assign(new BrainError(info.code,'宿主步骤暂停'),{failure:info}),stage);
    }
    try {
      if(stage==='vision') {
        requireValue(data.unit_id===action.unit_id && data.input_sha256===action.input_sha256,'SOURCE_MISMATCH','视觉结果与当前图片不一致');reviewer(data.vision);
        await verifyFile({path:action.input,sha256:action.input_sha256,size:(await fs.stat(action.input)).size},ctx.root);
        const dest=path.join(ctx.folder,'units');await realDirectory(dest,true);
        const target=path.join(dest,`${action.unit_id}.json`);
        await atomicJson(target,{unit_id:data.unit_id,input_sha256:data.input_sha256,vision:data.vision});
        job.units[action.unit_id]={receipt:await fileDigest(target,ctx.root)};
        job.steps.vision.status='partial';
      } else if(stage==='organize') {
        const a=data.artifact || data;validateArtifact(a);const original=JSON.parse(await readRegular(action.input));
        requireValue(validateArtifact(a).id===job.source_id && JSON.stringify(a.source)===JSON.stringify(original.source)
          && JSON.stringify(a.provenance.media_files)===JSON.stringify(original.provenance.media_files)
          && a.content.type===original.content.type && a.content.text===original.content.text && a.content.transcript===original.content.transcript,'SOURCE_CHANGED','整理不得修改来源身份、媒体回执、正文、类型或转写');
        if(a.content.type==='post') {
          const expected=[];
          for(const [key,value]of Object.entries(job.units))expected.push(`[${key}]\n${JSON.parse(await readRegular(value.receipt.path)).vision.text}`);
          requireValue(a.content.visual_notes===expected.join('\n\n'),'UNSUPPORTED_CLAIM','图文 visual_notes 必须使用逐页已登记识读原文');
          requireValue(a.extraction.visuals==='complete','INCOMPLETE_SOURCE','多图真实识读完成后才能标记完整');
        } else {
          requireValue(a.content.visual_notes===original.content.visual_notes && a.extraction.visuals===original.extraction.visuals,'VISION_NOT_REVIEWED','音频整理不能伪造画面覆盖');
        }
        requireValue(a.extraction.status==='complete' && a.provenance.model!=='pending','INCOMPLETE_SOURCE','整理仍不完整，保留 Pending');
        const target=path.join(ctx.folder,`organized-${actionId}.json`);await atomicJson(target,a);await checkpoint(ctx,'organized',target);job.steps.organize.status='complete';
      } else if(stage==='enhancement') {
        const a=data.artifact||data;validateEnhancement(a);await checkFrameFiles(a,path.dirname(input));
        const original=JSON.parse(await readRegular(action.input));
        requireValue(JSON.stringify(a.source)===JSON.stringify(original.source) && JSON.stringify(a.parameters)===JSON.stringify(original.parameters)
          && JSON.stringify(a.frames)===JSON.stringify(original.frames),'SOURCE_CHANGED','增强不得更改来源、抽样参数或已登记识读');
        if(a.coverage.status!=='complete') {
          job.pending_enhancement=await saveEnhancement(ctx.root,input);
          throw new BrainError('NO_VISUAL_FACT','没有可靠新增文字事实；音频成果保留，增强待审阅');
        }
        await checkpoint(ctx,'enhancement',input);job.steps.enhancement.status='complete';
      } else if(stage==='index') {
        requireValue(typeof data.tool==='string' && data.tool.trim() && typeof data.query==='string' && data.query.trim()
          && Array.isArray(data.matched_paths) && Array.isArray(data.read_paths),'INDEX_NOT_VERIFIED','需要真实查询与回读证据');
        const sourceDir=path.join(ctx.root,'Sources',job.source_id);
        const sourceMatch=p=>typeof p==='string' && (path.resolve(p)===path.join(sourceDir,'source.md') || path.resolve(p).startsWith(`${sourceDir}${path.sep}`));
        requireValue(data.matched_paths.some(sourceMatch) && data.read_paths.some(sourceMatch),'INDEX_NOT_VERIFIED','索引没有命中并读取当前来源');
        const matched=data.matched_paths.filter(sourceMatch),read=data.read_paths.filter(sourceMatch);
        for(const file of [...matched,...read])await fileDigest(path.resolve(file),sourceDir);
        job.steps.index.status='complete';job.steps.index.result={tool:data.tool,query:data.query,matched_paths:matched,read_paths:read};
      } else if(stage==='prepare_reply') {
        requireValue(typeof data.text==='string' && data.text.trim() && data.text.includes(job.canonical_url),'INVALID_REPLY','答复需包含原链接');
        const target=path.join(ctx.folder,`reply-${actionId}.json`);await atomicJson(target,{text:data.text,source_id:job.source_id});await checkpoint(ctx,'reply',target);
        job.delivery.status='prepared';job.steps.prepare_reply.status='complete';
      } else if(stage==='reply') {
        requireValue(['sent','uncertain'].includes(data.status) && typeof data.tool==='string' && data.tool.trim(),'INVALID_DELIVERY','需要宿主真实发送状态和工具名称');
        job.delivery.status=data.status;job.delivery.phone_receipt_verified=false;job.steps.reply.result={status:data.status,tool:data.tool,recorded_at:now(),phone_receipt_verified:false};
        if(data.status==='uncertain'){job.action=null;return pause(ctx,new BrainError('DELIVERY_UNCERTAIN','发送状态未确认'),stage);}
        job.steps.reply.status='complete';
      } else throw new BrainError('INVALID_STAGE','当前步骤不能由宿主登记');
      attempt.status='complete';job.action=null;job.error=null;await persist(ctx);
      return await advance(ctx,{...services,scope});
    }catch(error){if(attempt.status!=='complete'){attempt.status='failed';attempt.code=safeCode(error);}return pause(ctx,error,job.current_step||stage);}
  });
}
