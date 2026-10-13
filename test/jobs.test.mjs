import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createJob, resumeJob, recordJob, statusJob, listJobs } from '../lib/jobs.mjs';
import { captureJob } from '../lib/job-capture.mjs';
import { withRetry, failure, atomicJson, fileDigest, withLock } from '../lib/reliability.mjs';
import { BrainError, hash, contentHash } from '../lib/artifact.mjs';
import { run } from '../lib/process.mjs';
import { verifyStore } from '../lib/store.mjs';
import { transcribeArtifact } from '../lib/transcribe.mjs';
import { main } from '../scripts/brain.mjs';

const url='https://www.xiaohongshu.com/explore/000000000000000000000001';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1kAAAAASUVORK5CYII=', 'base64');
const mp4=Buffer.concat([Buffer.from([0,0,0,24]),Buffer.from('ftypmp42'),Buffer.alloc(20)]);
const vision=()=>({status:'complete',text:'画面独有42',description:'合成画面',reviewer:{identity:'合成测试',model:'synthetic',tool:'synthetic-view',visual_input_received:true,reviewed_at:'2026-10-13T00:00:00Z'}});
const artifact=()=>({schema_version:1,source:{url,original_url:url,platform:'xiaohongshu',title:'合成视频',author:null,published_at:null,captured_at:'2026-10-13T00:00:00Z'},content:{type:'video',text:'合成配文',transcript:'',visual_notes:''},extraction:{status:'partial',text:'complete',transcript:'missing',visuals:'missing',limitations:['尚未处理']},knowledge:{summary:'',claims:[],insights:[],actions:[],related_topics:[]},provenance:{adapter:'synthetic',model:'pending',steps:['合成测试'],media_files:[]}});
async function fixture(t,requirements='video') {
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'s2b-job-'));const root=await fs.realpath(temp);t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const options={store:path.join(root,'store'),profile:'source2brain',scope:'synthetic-trusted-peer',message:url,requirements};const counts={capture:0,transcribe:0,frames:0};
  const services={capture:async(message,dir)=>{counts.capture++;await fs.mkdir(dir,{recursive:true});const a=artifact();const media=path.join(dir,'video.mp4');await fs.writeFile(media,mp4);a.provenance.media_files=[{...await fileDigest(media,dir),type:'video'}];const file=path.join(dir,'artifact.json');await atomicJson(file,a);return{artifact:file,source_id:'xhs-000000000000000000000001'};},
    transcribe:async(input,{out})=>{counts.transcribe++;const a=JSON.parse(await fs.readFile(input,'utf8'));a.content.transcript='真实口播的合成测试';a.extraction.transcript='complete';await atomicJson(out,a);return{artifact:out};},
    enhance:async(input,dir)=>{counts.frames++;await fs.mkdir(path.join(dir,'frames'),{recursive:true});const b=JSON.parse(await fs.readFile(input,'utf8'));
      const frames=[1,2].map(time=>{const sha=hash(png),id=`frame-${hash(`${sha}:${time}`).slice(0,20)}`;return{id,path:`frames/${id}.png`,sha256:sha,timestamp_seconds:time,vision:{status:'pending',text:'',description:'',reviewer:null}};});
      for(const f of frames)await fs.writeFile(path.join(dir,f.path),png);
      const a={schema_version:2,kind:'source_enhancement',pack:'media',source:{id:'xhs-000000000000000000000001',url,title:b.source.title,base_content_sha256:contentHash(b),media_sha256:hash(mp4)},processor:{adapter:'synthetic',summarize:'0.24.0',vision:'host-native',runtime_lock_sha256:hash('synthetic-runtime')},parameters:{max_frames:24,scene_threshold:.2,min_duration_seconds:2},coverage:{scope:'sampled_frames_vision',status:'partial',frames:'complete',vision:'pending',review:'pending',limitations:['仅抽样，未看图']},frames,knowledge:{summary:'',claims:[]},provenance:{model:'pending',created_at:'2026-10-13T00:00:00Z',steps:['合成测试']}};
      const file=path.join(dir,'enhancement.json');await atomicJson(file,a);return{artifact:file};}};
  const created=await createJob(options);options.id=created.task_id;
  return{root,options,services,counts,created};
}
async function record(x,state,data) {
  const a=state.next_action;
  const file=a.output||path.join(a.task_directory,`result-${a.action_id}.json`);await atomicJson(file,data);
  return recordJob({...x.options,actionId:a.action_id,resultFile:file},x.services);
}
async function answer(x,s) {
  const a=s.next_action;
  if(a.stage==='organize') {const b=JSON.parse(await fs.readFile(a.input,'utf8'));b.extraction.status='complete';b.extraction.limitations=['仅口播'];b.knowledge.summary='合成摘要';b.provenance.model='synthetic';return record(x,s,b);}
  if(a.stage==='vision')return record(x,s,{unit_id:a.unit_id,input_sha256:a.input_sha256,vision:vision()});
  if(a.stage==='enhancement') {const b=JSON.parse(await fs.readFile(a.input,'utf8'));b.coverage={...b.coverage,status:'complete',review:'complete'};b.knowledge={summary:'画面独有42',claims:[{text:'画面显示42',evidence:[{frame_id:b.frames[0].id,quote:'画面独有42'}]}]};b.provenance.model='synthetic';return record(x,s,b);}
  if(a.stage==='index')return record(x,s,{tool:'synthetic-search',query:'合成',matched_paths:[a.source_path],read_paths:[a.source_path]});
  if(a.stage==='prepare_reply')return record(x,s,{text:`合成摘要，来源 ${url}`});
  if(a.stage==='reply')return record(x,s,{status:'sent',tool:'synthetic-message'});
  throw new Error(`unexpected action ${a.stage}`);
}
async function finish(x,s) {for(let i=0;i<15 && s.status!=='completed';i++) {assert.equal(s.ok,true,JSON.stringify(s.error));s=await answer(x,s);}assert.equal(s.status,'completed');return s;}

test('完整任务：逐帧登记、保存、索引与回复独立；重复与补发不重新处理',async t=>{
  const x=await fixture(t);let s=await resumeJob(x.options,x.services);assert.equal(s.next_action.stage,'organize');s=await finish(x,s);
  assert.deepEqual(x.counts,{capture:1,transcribe:1,frames:1});assert.equal(s.delivery_status,'sent');assert.equal(s.steps.reply.result.phone_receipt_verified,false);
  const note=s.saved.path;await fs.appendFile(note,'\n人工批注');const bytes=await fs.readFile(note);
  assert.equal((await createJob(x.options)).task_id,s.task_id);assert.equal((await resumeJob(x.options,x.services)).status,'completed');
  s=await resumeJob({...x.options,resend:true},x.services);assert.equal(s.next_action.stage,'reply');s=await answer(x,s);assert.equal(s.status,'completed');
  assert.deepEqual(x.counts,{capture:1,transcribe:1,frames:1});assert.deepEqual(await fs.readFile(note),bytes);assert.equal((await verifyStore(x.options.store)).ok,true);
});
test('新建音频任务复用已有来源，不再次下载、转写或覆盖人工内容',async t=>{
  const x=await fixture(t,'audio');let s=await resumeJob(x.options,x.services);s=await finish(x,s);
  const y={...x.options,scope:'synthetic-second-peer'};const j=await createJob(y);y.id=j.task_id;
  let r=await resumeJob(y,x.services);assert.equal(r.next_action.stage,'index');r=await finish({...x,options:y},r);assert.deepEqual(x.counts,{capture:1,transcribe:1,frames:0});
});
test('任务号不能跨 scope/profile/知识库；列表不泄漏其他会话',async t=>{
  const x=await fixture(t);await assert.rejects(statusJob({...x.options,scope:'other'}),{code:'JOB_SCOPE_MISMATCH'});
  assert.deepEqual((await listJobs({...x.options,scope:'other'})).tasks,[]);assert.equal((await listJobs(x.options)).tasks.length,1);
  await assert.rejects(createJob({...x.options,scope:undefined}),{code:'SCOPE_REQUIRED'});
  await assert.rejects(statusJob({...x.options,id:'../escape'}),{code:'INVALID_JOB_ID'});
});
test('宿主瞬时错误两次自动重试，耗尽暂停；迟到结果不能推进任务',async t=>{
  const x=await fixture(t);let s=await resumeJob(x.options,x.services);const old=s;
  for(let i=1;i<=3;i++){s=await record(x,s,{ok:false,code:'HTTP_503',message:'secret signed URL must not escape'});if(i<3){assert.equal(s.status,'waiting_for_host');assert.equal(s.next_action.retry_after_seconds,i===1?2:8);}else assert.equal(s.status,'blocked');}
  const file=path.join(x.root,'store/.source2brain/jobs',x.options.id,'late.json');await atomicJson(file,{ok:false,code:'HTTP_503'});
  await assert.rejects(recordJob({...x.options,actionId:old.next_action.action_id,resultFile:file}),{code:'STALE_ACTION'});
  assert.ok(!JSON.stringify(s).includes('secret'));s=await resumeJob(x.options,x.services);assert.equal(s.next_action.stage,'organize');
});
test('永久错误不自动重试；失败后继续复用已下载视频和转写',async t=>{
  const x=await fixture(t);let s=await resumeJob(x.options,x.services);s=await record(x,s,{ok:false,code:'AUTH_REQUIRED'});assert.equal(s.status,'blocked');assert.equal(s.error.retryable,false);
  s=await resumeJob(x.options,x.services);assert.equal(s.next_action.stage,'organize');assert.deepEqual(x.counts,{capture:1,transcribe:1,frames:0});
});
test('部分识读失败后只重读失败帧，已完成帧与音频成果保留',async t=>{
  const x=await fixture(t);let s=await resumeJob(x.options,x.services);s=await answer(x,s);assert.equal(s.next_action.stage,'vision');const first=s.next_action.unit_id;
  s=await answer(x,s);assert.notEqual(s.next_action.unit_id,first);const second=s.next_action.unit_id;
  s=await record(x,s,{ok:false,code:'VISION_UNAVAILABLE'});assert.equal(s.status,'blocked');assert.equal(s.saved.status,'saved');
  s=await resumeJob(x.options,x.services);assert.equal(s.next_action.unit_id,second);s=await finish(x,s);assert.deepEqual(x.counts,{capture:1,transcribe:1,frames:1});
});
test('回复状态不确定不自动再发；显式补发复用完全相同答复',async t=>{
  const x=await fixture(t,'audio');let s=await resumeJob(x.options,x.services);while(s.next_action.stage!=='reply')s=await answer(x,s);
  const reply=await fs.readFile(s.next_action.reply_file);s=await resumeJob(x.options,x.services);assert.equal(s.delivery_status,'uncertain');assert.equal(s.status,'blocked');
  assert.equal((await resumeJob(x.options,x.services)).delivery_status,'uncertain');s=await resumeJob({...x.options,resend:true},x.services);assert.deepEqual(await fs.readFile(s.next_action.reply_file),reply);
  s=await answer(x,s);assert.equal(s.status,'completed');assert.equal(x.counts.capture,1);
});
test('索引失败只补索引，不重做采集、模型整理或覆盖来源',async t=>{
  const x=await fixture(t,'audio');let s=await resumeJob(x.options,x.services);s=await answer(x,s);assert.equal(s.next_action.stage,'index');const bytes=await fs.readFile(s.saved.path);
  s=await record(x,s,{ok:false,code:'INDEX_UNAVAILABLE'});s=await resumeJob(x.options,x.services);assert.equal(s.next_action.stage,'index');assert.deepEqual(await fs.readFile(s.saved.path),bytes);assert.deepEqual(x.counts,{capture:1,transcribe:1,frames:0});
  s=await record(x,s,{tool:'synthetic',query:'合成',matched_paths:['/other/source.md'],read_paths:['/other/source.md']});assert.equal(s.error.code,'INDEX_NOT_VERIFIED');
});
test('损坏检查点、虚构引文和未实际看图不能推进；错误日志不回显正文',async t=>{
  const x=await fixture(t);let s=await resumeJob(x.options,x.services);const a=JSON.parse(await fs.readFile(s.next_action.input,'utf8'));a.knowledge.summary='摘要';a.knowledge.claims=[{text:'fake',evidence:[{field:'text',quote:'不存在'}]}];a.extraction.status='complete';a.provenance.model='synthetic';
  s=await record(x,s,a);assert.equal(s.error.code,'UNSUPPORTED_CLAIM');s=await resumeJob(x.options,x.services);s=await answer(x,s);
  const v=vision();v.reviewer.visual_input_received=false;s=await record(x,s,{unit_id:s.next_action.unit_id,input_sha256:s.next_action.input_sha256,vision:v});assert.equal(s.error.code,'VISION_NOT_REVIEWED');
  const checkpoint=s.preserved.find(p=>p.kind==='transcribed');await fs.appendFile(checkpoint.path,'broken');s=await resumeJob(x.options,x.services);assert.equal(s.error.code,'CHECKPOINT_CHANGED');assert.equal(x.counts.capture,1);
});
test('原子保存完成但任务未登记时，复跑仅识别 duplicate 并保护人工笔记',async t=>{
  const x=await fixture(t,'audio');let s=await resumeJob(x.options,x.services);s=await answer(x,s);const before=await fs.readFile(s.saved.path);const file=path.join(s.next_action.task_directory,'state.json');const j=JSON.parse(await fs.readFile(file,'utf8'));
  j.steps.save.status='running';delete j.steps.save.result;j.action=null;j.status='running';await atomicJson(file,j);
  s=await resumeJob(x.options,x.services);assert.equal(s.saved.status,'duplicate');assert.deepEqual(await fs.readFile(s.saved.path),before);assert.equal(x.counts.transcribe,1);
});
test('逐帧结果写盘但任务未登记时，恢复接管结果，不再次请求识读',async t=>{
  const x=await fixture(t);let s=await resumeJob(x.options,x.services);s=await answer(x,s);const a=s.next_action;
  const unit=path.join(a.task_directory,'units');await fs.mkdir(unit);await atomicJson(path.join(unit,`${a.unit_id}.json`),{unit_id:a.unit_id,input_sha256:a.input_sha256,vision:vision()});
  s=await resumeJob(x.options,x.services);assert.notEqual(s.next_action.unit_id,a.unit_id);assert.equal(s.next_action.stage,'vision');assert.equal(x.counts.frames,1);
});
test('锁不按年龄抢占；活持有者拒绝，已退出持有者可回收',async t=>{
  const x=await fixture(t);const file=path.join(x.root,'lock');await atomicJson(file,{pid:process.pid,host:os.hostname(),token:'live'});
  await assert.rejects(withLock(file,async()=>true),{code:'TASK_LOCKED'});
  await atomicJson(file,{pid:2147483647,host:os.hostname(),token:'dead'});assert.equal(await withLock(file,async()=>42),42);
  await atomicJson(file,{pid:2147483647,host:'other-machine',token:'unknown'});await assert.rejects(withLock(file,async()=>true),{code:'TASK_LOCKED'});
});
test('自动重试预算、退避与永久错误；不回显错误详情',async()=>{
  let calls=0;const waits=[];const result=await withRetry(async()=>{if(++calls<3)throw Object.assign(new BrainError('HTTP_429','secret'),{retry_after_seconds:999});return 42;},{stage:'download',wait:async ms=>waits.push(ms)});
  assert.equal(result,42);assert.equal(calls,3);assert.ok(waits.every(ms=>ms>=60000&&ms<60300));calls=0;
  await assert.rejects(withRetry(async()=>{calls++;throw new BrainError('AUTH_REQUIRED','secret');},{stage:'capture'}),{code:'AUTH_REQUIRED'});assert.equal(calls,1);assert.ok(!JSON.stringify(failure(new Error('secret'),'test')).includes('secret'));
});

async function xhsFixture(t,type='video',count=1) {
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'s2b-resume-capture-'));const dir=await fs.realpath(temp);t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  let downloads=0,metadata=0;
  const runner=async(command,args)=>{
    if(command==='agent-reach')return{stdout:'{}'};
    if(args[0]==='browser') {
      if(args[2]==='get')return{stdout:args[3]==='url'?`${url}?xsec_token=synthetic`:'合成 - 小红书'};
      if(args[2]==='eval')return{stdout:JSON.stringify({href:`${url}?xsec_token=synthetic`,media:Array.from({length:count},(_,i)=>({type,urls:[`https://sns-video.xhscdn.com/${i}.mp4`]}))})};
      return{stdout:'{}'};
    }
    metadata++;return{stdout:JSON.stringify([{field:'content',value:'合成配文'}])};
  };
  const fetcher=async()=>{downloads++;return new Response(type==='video'?mp4:png,{headers:{'content-type':type==='video'?'video/mp4':'image/png'}});};
  return{dir,runner,fetcher,get downloads(){return downloads;},get metadata(){return metadata;}};
}
test('下载失败后恢复只做未完成附件；已下载图片哈希与调用次数保持',async t=>{
  const x=await xhsFixture(t,'image',2);let block=true;
  await assert.rejects(captureJob(url,x.dir,{runner:x.runner,fetcher:x.fetcher,beforeDownload:async({index})=>{if(index===2&&block)throw new BrainError('AUTH_REQUIRED','合成故障');}}),{code:'AUTH_REQUIRED'});
  const state=JSON.parse(await fs.readFile(path.join(x.dir,'capture-state.json'),'utf8'));assert.equal(state.files.length,1);block=false;
  const r=await captureJob(url,x.dir,{runner:x.runner,fetcher:x.fetcher});assert.equal(r.media.length,2);assert.equal(x.downloads,2);assert.equal(r.media[0].sha256,state.files[0].sha256);
});
test('下载候选与网络故障共用三次预算，受控503后成功',async t=>{
  const x=await xhsFixture(t);let calls=0;
  const r=await captureJob(url,x.dir,{runner:x.runner,fetcher:async(...args)=>++calls<3?new Response('',{status:503}):x.fetcher(...args),wait:async()=>{}});
  assert.equal(calls,3);assert.equal(r.media.length,1);const j=JSON.parse(await fs.readFile(path.join(x.dir,'capture-state.json'),'utf8'));assert.equal(j.attempts.filter(a=>a.stage==='download:1'&&a.status==='running').length,3);
});
test('下载预算耗尽、媒体清单变化及损坏文件不会被当成成功',async t=>{
  const x=await xhsFixture(t);let calls=0;
  await assert.rejects(captureJob(url,x.dir,{runner:x.runner,fetcher:async()=>{calls++;return new Response('',{status:503});},wait:async()=>{}}),{code:'MEDIA_HTTP_503'});assert.equal(calls,3);
  const r=await captureJob(url,x.dir,{runner:x.runner,fetcher:x.fetcher});await fs.appendFile(r.media[0].path,'bad');await assert.rejects(captureJob(url,x.dir,{runner:x.runner,fetcher:x.fetcher}),{code:'CHECKPOINT_CHANGED'});
});
test('转写已落盘但artifact未生成时复用，不重复执行ASR；媒体哈希不匹配拒绝',async t=>{
  const x=await xhsFixture(t);const captured=await captureJob(url,x.dir,{runner:x.runner,fetcher:x.fetcher});const a=JSON.parse(await fs.readFile(captured.artifact,'utf8'));
  await atomicJson(path.join(x.dir,'transcript-local.json'),{text:'合成转写',model:'synthetic',media_sha256:a.provenance.media_files[0].sha256});let called=0;
  const out=await transcribeArtifact(captured.artifact,{env:{SOURCE2BRAIN_ASR_PYTHON:'synthetic'},runner:async()=>{called++;}});assert.equal(called,0);assert.equal(out.characters,4);
  await fs.appendFile(a.provenance.media_files[0].path,'broken');await assert.rejects(transcribeArtifact(captured.artifact,{env:{}}),{code:'CHECKPOINT_CHANGED'});
});
test('CLI job接口可分发且兼容旧命令，参数和原始错误不泄露',async t=>{
  const x=await fixture(t);const s=await main(['job','status','--id',x.options.id,'--store',x.options.store,'--scope',x.options.scope]);assert.equal(s.task_id,x.options.id);
  await assert.rejects(main(['job','record','--id',x.options.id]),{code:'INVALID_ARGUMENTS'});assert.equal((await main(['verify','--store',x.options.store])).ok,true);
});
test('超时清理子进程组；避免转写/抽帧后代继续执行',async t=>{
  if(process.platform==='win32')return t.skip('POSIX参考运行端');const x=await fixture(t);const marker=path.join(x.root,'orphan-marker');
  const script=`const {spawn}=require('node:child_process');spawn(process.execPath,['-e',${JSON.stringify(`setTimeout(()=>require('node:fs').writeFileSync(${JSON.stringify(marker)},'orphan'),450)`)}],{stdio:'ignore'});setInterval(()=>{},1000);`;
  await assert.rejects(run(process.execPath,['-e',script],{timeout:150}),{code:'COMMAND_TIMEOUT'});await new Promise(r=>setTimeout(r,600));await assert.rejects(fs.stat(marker),{code:'ENOENT'});
});

test('短链解析到已有任务时在下载前复用；列表只保留主任务',async t=>{
 const x=await fixture(t,'audio');let s=await resumeJob(x.options,x.services);s=await finish(x,s);
 const y={...x.options,message:'https://xhslink.cn/o/synthetic-alias'};const j=await createJob(y);y.id=j.task_id;
 const metadata={source_id:'xhs-000000000000000000000001',source_url:url,text:'合成配文'};
 const r=await resumeJob(y,{capture:async(message,dir,options)=>options.onMetadata(metadata)});assert.equal(r.task_id,x.options.id);assert.equal(r.reused,true);assert.equal((await listJobs(y)).tasks.length,1);
 assert.equal((await resumeJob(y)).task_id,x.options.id);
});
test('不同处理要求复用已有来源，新增画面不再次转写',async t=>{
 const x=await fixture(t,'audio');let s=await resumeJob(x.options,x.services);s=await finish(x,s);
 const y={...x.options,requirements:'video'};const j=await createJob(y);y.id=j.task_id;
 s=await resumeJob(y,x.services);assert.equal(s.next_action.stage,'vision');assert.deepEqual(x.counts,{capture:1,transcribe:1,frames:1});
});
test('运行记录无持有者时报告中断，未知机器锁不声称已退出',async t=>{
 const x=await fixture(t);const folder=path.join(x.options.store,'.source2brain/jobs',x.options.id),file=path.join(folder,'state.json');const j=JSON.parse(await fs.readFile(file,'utf8'));j.status='running';await atomicJson(file,j);
 assert.equal((await statusJob(x.options)).status,'interrupted');
 await atomicJson(path.join(folder,'.run.lock'),{pid:2147483647,host:'unknown',token:'unknown'});assert.equal((await statusJob(x.options)).status,'running');
});
test('已完成抽帧写盘但任务状态缺失，恢复接管旧帧，不再次调用抽帧',async t=>{
 const x=await fixture(t);let s=await resumeJob(x.options,x.services);s=await answer(x,s);const file=path.join(s.next_action.task_directory,'state.json'),j=JSON.parse(await fs.readFile(file,'utf8'));
 delete j.outputs.frames;j.steps.frames.status='running';j.action=null;j.status='running';await atomicJson(file,j);
 s=await resumeJob(x.options,x.services);assert.equal(s.next_action.stage,'vision');assert.equal(x.counts.frames,1);
});
test('保存后的原始artifact损坏应暂停，人工Markdown变动不视为损坏',async t=>{
 const x=await fixture(t,'audio');let s=await resumeJob(x.options,x.services);s=await answer(x,s);await fs.appendFile(s.saved.path,'\n人工修改');assert.equal((await statusJob(x.options)).ok,true);
 const file=path.join(path.dirname(s.saved.path),'artifact.json');await fs.appendFile(file,'bad');s=await resumeJob(x.options,x.services);assert.equal(s.status,'blocked');assert.equal(x.counts.capture,1);
});
test('宿主结果不能从任务目录外读取，也不能以索引布尔值冒充命中',async t=>{
 const x=await fixture(t,'audio');const s=await resumeJob(x.options,x.services),file=path.join(x.root,'outside.json');await atomicJson(file,{ok:false,code:'HTTP_503'});
 await assert.rejects(recordJob({...x.options,actionId:s.next_action.action_id,resultFile:file}),{code:'UNSAFE_PATH'});
});
test('自动重试不用于工具超时和未知故障',async()=>{
 for(const code of ['COMMAND_TIMEOUT','ASR_FAILED','UNKNOWN_ERROR','CHECKPOINT_CHANGED']) {let attempts=0;await assert.rejects(withRetry(async()=>{attempts++;throw new BrainError(code,'私有错误');},{stage:'test'}),{code});assert.equal(attempts,1);}
});

test('Retry-After 支持 HTTP 日期与秒数，统一限制等待上限',async()=>{
 const {retryAfter}=await import('../lib/reliability.mjs');const clock=Date.parse('2026-10-13T00:00:00Z');assert.equal(retryAfter('Tue, 13 Oct 2026 00:00:15 GMT',clock),15);assert.equal(retryAfter('999'),60);assert.equal(retryAfter('invalid'),0);
});
test('并发恢复不重复执行采集，任务锁同时只允许一个调用',async t=>{
 const x=await fixture(t);let entered;const ready=new Promise(r=>entered=r);let release;const hold=new Promise(r=>release=r);const capture=x.services.capture;
 const first=resumeJob(x.options,{...x.services,capture:async(...args)=>{entered();await hold;return capture(...args);}});await ready;
 await assert.rejects(resumeJob(x.options,x.services),{code:'TASK_LOCKED'});release();const result=await first;assert.equal(result.next_action.stage,'organize');assert.equal(x.counts.capture,1);
});
test('真实 SIGKILL 遗留的任务锁可以安全回收，原子状态仍完整',async t=>{
 if(process.platform==='win32')return t.skip('POSIX参考运行端');const x=await fixture(t);const marker=path.join(x.root,'ready'),file=path.join(x.root,'kill-lock'),state=path.join(x.root,'atomic-state.json');
 const {spawn}=await import('node:child_process');const module=new URL('../lib/reliability.mjs',import.meta.url).href;
 const source=`import{withLock,atomicJson}from ${JSON.stringify(module)};import fs from 'node:fs/promises';await withLock(${JSON.stringify(file)},async()=>{await atomicJson(${JSON.stringify(state)},{complete:true});await fs.writeFile(${JSON.stringify(marker)},'ready');setInterval(()=>{},1000);await new Promise(()=>{});});`;
 const child=spawn(process.execPath,['--input-type=module','-e',source],{stdio:'ignore'});t.after(()=>{try{child.kill('SIGKILL');}catch{}});
 for(let i=0;i<100&&!await fs.stat(marker).catch(()=>null);i++)await new Promise(r=>setTimeout(r,10));assert.ok(await fs.stat(marker));
 const closed=new Promise(r=>child.once('exit',r));child.kill('SIGKILL');await closed;assert.deepEqual(JSON.parse(await fs.readFile(state,'utf8')),{complete:true});assert.equal(await withLock(file,async()=>42),42);
});

test('多图按原页序登记，失败页不冒充已读，visual_notes 必须匹配真实逐页原文',async t=>{
 const x=await fixture(t);x.services.capture=async(message,dir)=>{await fs.mkdir(dir,{recursive:true});const a=artifact();a.content.type='post';a.extraction.transcript='not_applicable';a.provenance.media_files=[];
 for(let i=1;i<=2;i++){const file=path.join(dir,`page-${i}.png`);await fs.writeFile(file,png);a.provenance.media_files.push({...await fileDigest(file,dir),type:'image'});}const file=path.join(dir,'artifact.json');await atomicJson(file,a);return{artifact:file,source_id:'xhs-000000000000000000000001'};};
 let s=await resumeJob(x.options,x.services);assert.equal(s.next_action.unit_id,'page-1');s=await answer(x,s);assert.equal(s.next_action.unit_id,'page-2');s=await record(x,s,{ok:false,code:'VISION_UNAVAILABLE'});s=await resumeJob(x.options,x.services);assert.equal(s.next_action.unit_id,'page-2');s=await answer(x,s);assert.equal(s.next_action.stage,'organize');
 const a=JSON.parse(await fs.readFile(s.next_action.input,'utf8'));a.extraction={...a.extraction,status:'complete',visuals:'complete'};a.content.visual_notes='[page-1]\n画面独有42\n\n[page-2]\n画面独有42';a.knowledge.summary='逐页图文摘要';a.provenance.model='synthetic';s=await record(x,s,a);assert.equal(s.next_action.stage,'index');s=await finish(x,s);assert.equal(x.counts.transcribe,0);assert.equal(x.counts.frames,0);
});
test('没有新增文字事实时保留Pending增强，音频来源不撤销',async t=>{
 const x=await fixture(t);let s=await resumeJob(x.options,x.services);s=await answer(x,s);s=await answer(x,s);s=await answer(x,s);assert.equal(s.next_action.stage,'enhancement');
 const a=JSON.parse(await fs.readFile(s.next_action.input,'utf8'));a.provenance.model='synthetic';a.knowledge={summary:'没有可靠新增文字',claims:[]};s=await record(x,s,a);assert.equal(s.error.code,'NO_VISUAL_FACT');assert.equal(s.saved.status,'saved');assert.equal((await verifyStore(x.options.store)).ok,true);const files=await fs.readdir(path.join(x.options.store,'Pending',s.source_id,'enhancements'));assert.equal(files.length,1);
});

test('空库查询进度返回空列表；单个损坏任务不阻断其他任务或泄漏其ID',async t=>{
 const x=await fixture(t);assert.deepEqual((await listJobs({...x.options,store:path.join(x.root,'missing')})).tasks,[]);
 const corrupt='job-111111111111111111111111',folder=path.join(x.options.store,'.source2brain/jobs',corrupt);await fs.mkdir(folder);await fs.writeFile(path.join(folder,'state.json'),'{broken');
 const list=await listJobs(x.options);assert.equal(list.tasks.length,1);assert.ok(list.warning);assert.ok(!JSON.stringify(list).includes(corrupt));await assert.rejects(statusJob({...x.options,id:corrupt}),{code:'INVALID_JOB'});
});

test('宿主已写结果但尚未record时，resume校验接管，不重复要求识图或整理',async t=>{
 const x=await fixture(t);let s=await resumeJob(x.options,x.services),action=s.next_action;
 const a=JSON.parse(await fs.readFile(action.input,'utf8'));a.extraction.status='complete';a.knowledge.summary='合成摘要';a.provenance.model='synthetic';await atomicJson(action.output,a);
 s=await resumeJob(x.options,x.services);assert.equal(s.next_action.stage,'vision');action=s.next_action;
 await atomicJson(action.output,{unit_id:action.unit_id,input_sha256:action.input_sha256,vision:vision()});s=await resumeJob(x.options,x.services);assert.notEqual(s.next_action.unit_id,action.unit_id);assert.equal(s.next_action.stage,'vision');assert.deepEqual(x.counts,{capture:1,transcribe:1,frames:1});
});
