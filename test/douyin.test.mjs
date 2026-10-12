import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {downloadDouyinVideo, validateDouyinMediaUrl, projectDouyinDetail, readDouyinSource, DOUYIN_PAGE_PROBE} from '../lib/douyin.mjs';
import {captureSource, probeSource} from '../lib/capture.mjs';

const id='7000000000000000001';
const url='https://v-test.douyinvod.com/video/example.mp4?temporary=synthetic';
const observedHosts=new Set(['v-test.douyinvod.com']);
const mp4=Buffer.concat([Buffer.from([0,0,0,24]),Buffer.from('ftypisom'),Buffer.alloc(24)]);
async function setup(t) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'source2brain-douyin-test-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));return root;
}
const response=(body=mp4,headers={})=>new Response(body,{headers:{'content-type':'video/mp4',...headers}});
const source=`https://www.douyin.com/video/${id}`;
const networkUrl=`https://www.douyin.com/aweme/v1/web/aweme/detail/?aweme_id=${id}&observed_token=synthetic`;
const networkKey='GET www.douyin.com/aweme/v1/web/aweme/detail/#2';
const detail=()=>({key:networkKey,url:networkUrl,method:'GET',status:200,body:{status_code:0,aweme_detail:{aweme_id:id,desc:'合成测试配文，不是真实平台验收',author:{nickname:'合成作者'},create_time:1700000000,video:{play_addr:{url_list:[url]}}}}});
function browserFixture({page={href:source,login_wall:false,security_block:false},envelope=detail(),entries=[detail()],override}={}){
  const calls=[],waits=[];
  const runner=async(command,args,options)=>{
    calls.push({command,args,options});
    if(override){const value=await override(command,args,options);if(value!==undefined)return value;}
    const json=value=>({stdout:JSON.stringify(value)});
    if(command==='agent-reach')return json({});
    if(args[0]==='--version')return{stdout:'1.8.6'};
    assert.equal(args[0],'browser');
    if(args[2]==='open')return json({session:args[1],data:{url:args[3],page:'target-test-123'}});
    if(args[2]==='close')return json({closed:true});
    assert.deepEqual(args.slice(-2),['--tab','target-test-123']);
    if(args[2]==='eval'){assert.equal(args[3],DOUYIN_PAGE_PROBE);return json(page);}
    assert.equal(args[2],'network');
    if(args.includes('--detail'))return json(envelope);
    assert.deepEqual(args.slice(3,5),['--filter','aweme_detail']);return json({session:args[1],entries});
  };
  return{runner,calls,wait:async ms=>{waits.push(ms);},waits};
}

test('只投影已捕获单条响应：URL、请求方法、字符串 ID 和正文必须一致',()=>{
  const projected=projectDouyinDetail(detail(),id);
  assert.equal(projected.id,id);assert.equal(projected.author,'合成作者');assert.deepEqual(projected.media_urls,[url]);
  for(const mutate of [
    d=>{d.url=d.url.replace(id,'7000000000000000002');},
    d=>{d.url+='&aweme_id='+id;},
    d=>{d.url=d.url.replace('www.douyin.com','evil.test');},
    d=>{d.method='POST';},
    d=>{d.body_truncated=true;},
    d=>{d.body.aweme_detail.aweme_id='7000000000000000002';},
    d=>{d.body.aweme_detail.aweme_id=Number(id);},
  ]){const d=detail();mutate(d);assert.throws(()=>projectDouyinDetail(d,id),{code:'SOURCE_MISMATCH'});}
  const missing=detail();missing.body.aweme_detail.desc=' ';
  assert.throws(()=>projectDouyinDetail(missing,id),{code:'EMPTY_CONTENT'});
  const failed=detail();failed.body.status_code=9;
  assert.throws(()=>projectDouyinDetail(failed,id),{code:'EMPTY_RESULT'});
  const malformed=detail();malformed.body='{';
  assert.throws(()=>projectDouyinDetail(malformed,id),{code:'INVALID_TOOL_OUTPUT'});
});

test('浏览器读取只选指定 ID 已捕获响应，用真实返回 tab 并最终关闭自有 session',async()=>{
  const unrelated={...detail(),url:networkUrl.replace(id,'7000000000000000002'),key:'unrelated'};
  const fixture=browserFixture({entries:[unrelated,detail()]});
  const result=await readDouyinSource(source,fixture);
  assert.equal(result.source_id,`dy-${id}`);assert.equal(result.auth_scope,'reused-browser; login-not-asserted');
  assert.equal(fixture.waits.length,0);
  const browserCalls=fixture.calls.filter(c=>c.args[0]==='browser');
  assert.equal(new Set(browserCalls.map(c=>c.args[1])).size,1);
  assert.match(browserCalls[0].args[1],/^source2brain-dy-/);
  assert.equal(browserCalls.at(-1).args[2],'close');
  assert.deepEqual(browserCalls.find(c=>c.args.includes('--detail')).args.slice(3,7),['--detail',networkKey,'--max-body','2000000']);
  assert.ok(fixture.calls.every(c=>Number.isFinite(c.options.timeout)&&Number.isFinite(c.options.maxBytes)));
  assert.ok(!fixture.calls.some(c=>['videos','user-videos','fetch','cookies'].some(v=>c.args.includes(v))));
});

test('登录、无响应和短链跳转都有界等待，不调用猜测的 API',async()=>{
  for(const [page,code] of [
    [{href:source,login_wall:true},'AUTH_REQUIRED'],
    [{href:source},'EMPTY_RESULT'],
    [{href:'https://v.douyin.com/synthetic/'},'SHORT_URL_UNRESOLVED'],
  ]){
    const fixture=browserFixture({page,entries:[]});
    await assert.rejects(readDouyinSource(source.replace(/https:\/\/www.*/,page.href),fixture),{code});
    assert.equal(fixture.waits.length,3);assert.equal(fixture.calls.filter(c=>c.args[2]==='eval').length,4);
    assert.equal(fixture.calls.at(-1).args[2],'close');
  }
  const fixture=browserFixture();
  const resolved=await readDouyinSource('https://v.douyin.com/synthetic/',fixture);
  assert.equal(resolved.source_id,`dy-${id}`);
});

test('风控、目标跳转和不完整响应立即失败，打开失败也尝试关闭自有 session',async()=>{
  for(const [fixture,code] of [
    [browserFixture({page:{href:'https://verify.example.test/',security_block:true}}),'SECURITY_BLOCK'],
    [browserFixture({page:{href:source.replace(id,'7000000000000000002')}}),'SOURCE_MISMATCH'],
    [browserFixture({envelope:{...detail(),body_truncated:true}}),'SOURCE_MISMATCH'],
    [browserFixture({override:(_,args)=>args[2]==='open'?{stdout:'{}'}:undefined}),'INVALID_TOOL_OUTPUT'],
  ]){
    await assert.rejects(readDouyinSource(source,fixture),{code});
    assert.equal(fixture.waits.length,0);assert.equal(fixture.calls.at(-1).args[2],'close');
  }
});

test('路由采集按真实媒体落盘生成 partial；临时媒体 URL 只在私有原始记录',async t=>{
  const root=await setup(t),output=path.join(root,'capture'),fixture=browserFixture();
  const result=await captureSource('收藏 '+source,output,{...fixture,fetcher:async()=>response()});
  assert.equal(result.status,'captured_partial');assert.equal(result.source_id,`dy-${id}`);assert.equal(result.media_error,null);
  assert.equal(result.media[0].size,mp4.length);assert.equal(result.media[0].sha256,createHash('sha256').update(mp4).digest('hex'));
  const artifact=JSON.parse(await fs.readFile(result.artifact,'utf8'));
  const journal=JSON.parse(await fs.readFile(path.join(output,'capture.json'),'utf8'));
  assert.equal(artifact.content.type,'video');assert.equal(artifact.extraction.status,'partial');assert.equal(artifact.extraction.transcript,'missing');
  assert.equal(journal.platform,'douyin');assert.equal(journal.source_id,`dy-${id}`);
  assert.ok(!JSON.stringify({result,artifact,journal}).includes('temporary=synthetic'));
  assert.ok((await fs.readFile(path.join(output,'raw-note.json'),'utf8')).includes('temporary=synthetic'));
  assert.equal((await fs.stat(output)).mode&0o777,0o700);
  for(const name of ['capture.json','artifact.json','raw-note.json'])assert.equal((await fs.stat(path.join(output,name))).mode&0o777,0o600);
  let calls=0;
  await assert.rejects(captureSource(source,output,{runner:()=>{calls++;}}),{code:'EEXIST'});assert.equal(calls,0);
});

test('媒体无法下载只留 partial；平台无法读取则只留失败回执',async t=>{
  const root=await setup(t);
  const fixture=browserFixture();
  const result=await captureSource(source,path.join(root,'partial'),{...fixture,fetcher:async()=>new Response(null,{status:403})});
  assert.equal(result.media_error,'MEDIA_HTTP_403');assert.deepEqual(result.media,[]);
  const artifact=JSON.parse(await fs.readFile(result.artifact,'utf8'));
  assert.equal(artifact.extraction.status,'partial');assert.match(artifact.extraction.limitations.join(' '),/MEDIA_HTTP_403/);
  const failure=browserFixture({page:{href:source,login_wall:true},entries:[]});
  await assert.rejects(captureSource(source,path.join(root,'failure'),failure),{code:'AUTH_REQUIRED'});
  const journal=JSON.parse(await fs.readFile(path.join(root,'failure/capture.json'),'utf8'));
  assert.equal(journal.status,'failed');assert.equal(journal.error_code,'AUTH_REQUIRED');assert.match(journal.next_action,/本人/);
  assert.equal(journal.source_id,`dy-${id}`);assert.deepEqual(await fs.readdir(path.join(root,'failure')),['capture.json']);
});

test('probe 只返回真实页面能力状态，不下载、不返回配文或临时地址',async()=>{
  const fixture=browserFixture();
  const result=await probeSource(source,{...fixture,fetcher:()=>assert.fail('probe 不得下载')});
  assert.deepEqual(result,{platform:'douyin',source_id:`dy-${id}`,content_access:'readable_metadata',media_observed:true,auth_scope:'reused-browser; login-not-asserted',download_verified:false});
  const xhs=await probeSource('https://www.xiaohongshu.com/explore/000000000000000000000001',{runner:()=>assert.fail('小红书 probe 不冒充实际探测')});
  assert.equal(xhs.content_access,'not_probed');
});

test('媒体只对同次响应已有的官方候选有限回退，共享时间预算且隐藏签名地址',async t=>{
  const root=await setup(t),envelope=detail();
  envelope.body.aweme_detail.video.play_addr.url_list=[url,url.replace('example.mp4','alternative.mp4'),url.replace('example.mp4','third.mp4'),url.replace('example.mp4','fourth.mp4')];
  let requests=[];
  const result=await captureSource(source,path.join(root,'fallback'),{...browserFixture({envelope}),fetcher:async u=>{
    requests.push(u);return requests.length===1?new Response(null,{status:403}):response();
  }});
  assert.equal(requests.length,2);assert.equal(result.media_error,null);assert.equal(result.media.length,1);
  assert.deepEqual(result.media_attempts.map(a=>a.status),['failed','downloaded']);
  assert.equal(result.media_attempts[0].error_code,'MEDIA_HTTP_403');assert.ok(!JSON.stringify(result).includes('temporary='));
  requests=[];
  const failed=await captureSource(source,path.join(root,'all-failed'),{...browserFixture({envelope}),fetcher:async u=>{requests.push(u);return new Response(null,{status:403});}});
  assert.equal(requests.length,3);assert.equal(failed.media_error,'MEDIA_HTTP_403');assert.equal(failed.media.length,0);
  requests=[];
  const limited=await captureSource(source,path.join(root,'rate-limited'),{...browserFixture({envelope}),fetcher:async u=>{requests.push(u);return new Response(null,{status:429});}});
  assert.equal(requests.length,1);assert.equal(limited.media_error,'MEDIA_HTTP_429');
});

test('带有效 MP4 文件头的分段响应也不能冒充完整媒体',async t=>{
  const root=await setup(t), fixture=browserFixture();
  const fetcher=async()=>new Response(mp4,{status:206,headers:{'content-type':'video/mp4','content-length':String(mp4.length),'content-range':`bytes 0-${mp4.length-1}/1000000`}});
  await assert.rejects(downloadDouyinVideo(url,root,id,{observedHosts,fetcher}),{code:'MEDIA_PARTIAL_RESPONSE'});
  assert.deepEqual(await fs.readdir(root),[]);
  const captured=await captureSource(source,path.join(root,'partial'),{...fixture,fetcher});
  assert.equal(captured.media_error,'MEDIA_PARTIAL_RESPONSE');
  assert.deepEqual(captured.media,[]);
  assert.equal(JSON.parse(await fs.readFile(captured.artifact,'utf8')).extraction.status,'partial');
});

test('抖音媒体只接受实际观察过的官方 HTTPS CDN，不接受凭据、端口、伪后缀或IP',()=>{
  assert.equal(validateDouyinMediaUrl(url,observedHosts).hostname,'v-test.douyinvod.com');
  for(const input of ['http://v-test.douyinvod.com/x','https://v-test.douyinvod.com.evil.test/x','https://user:pass@v-test.douyinvod.com/x','https://v-test.douyinvod.com:444/x','https://127.0.0.1/x','file:///tmp/x','https://other.douyinvod.com/x']){
    assert.throws(()=>validateDouyinMediaUrl(input,observedHosts),{code:'MEDIA_URL_REJECTED'});
  }
});
test('抖音媒体真实落盘后才返回字节数和哈希，不携带浏览器 Cookie',async t=>{
  const root=await setup(t);let request;
  const result=await downloadDouyinVideo(url,root,id,{observedHosts,fetcher:async(u,o)=>{request={u,o};return response(mp4,{'content-length':String(mp4.length)})}});
  assert.equal(result.size,mp4.length);assert.equal(result.sha256,createHash('sha256').update(mp4).digest('hex'));
  assert.equal(path.basename(result.path),`dy-${id}.mp4`);assert.deepEqual(await fs.readFile(result.path),mp4);
  assert.equal(request.o.redirect,'manual');assert.equal(Object.keys(request.o.headers).length,1);assert.ok(request.o.headers.Accept);
  assert.equal((await fs.stat(result.path)).mode&0o777,0o600);
});
test('未观察到的跳转主机不会发起请求，失败清除本次部分文件',async t=>{
  const root=await setup(t);let calls=0;
  await assert.rejects(downloadDouyinVideo(url,root,id,{observedHosts,fetcher:async()=>{calls++;return new Response(null,{status:302,headers:{location:'https://other.douyinvod.com/x'}})}}),{code:'MEDIA_URL_REJECTED'});
  assert.equal(calls,1);assert.deepEqual(await fs.readdir(root),[]);
});
test('同一已观察主机可有界跳转；第四跳被拒绝',async t=>{
  const root=await setup(t);let calls=0;
  await assert.rejects(downloadDouyinVideo(url,root,id,{observedHosts,fetcher:async()=>{calls++;return new Response(null,{status:302,headers:{location:'/loop'}})}}),{code:'MEDIA_REDIRECT_LIMIT'});
  assert.equal(calls,4);assert.deepEqual(await fs.readdir(root),[]);
});
test('假 MP4、HTML响应、截断和超大媒体不保留为成功证据',async t=>{
  const root=await setup(t);
  for(const [fetcher,options,code] of [
    [async()=>response(Buffer.alloc(32)),{},'INVALID_MEDIA_FILE'],
    [async()=>new Response('<html>login</html>',{headers:{'content-type':'text/html'}}),{},'INVALID_MEDIA_TYPE'],
    [async()=>response(mp4,{'content-length':'100'}),{},'MEDIA_TRUNCATED'],
    [async()=>response(mp4),{maxBytes:20},'MEDIA_SIZE_LIMIT'],
    [async()=>response(mp4,{'content-length':'300000000'}),{},'MEDIA_SIZE_LIMIT'],
    [async()=>response(mp4,{'content-length':'not-a-number'}),{},'MEDIA_SIZE_LIMIT'],
  ]){
    await assert.rejects(downloadDouyinVideo(url,root,id,{observedHosts,fetcher,...options}),{code});
    assert.deepEqual(await fs.readdir(root),[]);
  }
});
test('下载故障和超时清理部分文件；ID不能越出输出目录',async t=>{
  const root=await setup(t);
  await assert.rejects(downloadDouyinVideo(url,root,'../../outside',{observedHosts}),{code:'INVALID_MEDIA_ID'});
  await assert.rejects(downloadDouyinVideo(url,root,id,{observedHosts,fetcher:async()=>{throw new Error('contains signed URL but do not expose')}}),e=>e.code==='MEDIA_DOWNLOAD_FAILED'&&!e.message.includes('signed'));
  await assert.rejects(downloadDouyinVideo(url,root,id,{observedHosts,timeoutMs:10,fetcher:async(_,o)=>new Promise((_,reject)=>o.signal.addEventListener('abort',()=>reject(new Error('aborted'))))}),{code:'MEDIA_TIMEOUT'});
  assert.deepEqual(await fs.readdir(root),[]);
});
test('重复和并发下载不能覆盖已保存媒体，临时文件最终清除',async t=>{
  const root=await setup(t);const options={observedHosts,fetcher:async()=>response()};
  const results=await Promise.allSettled([downloadDouyinVideo(url,root,id,options),downloadDouyinVideo(url,root,id,options)]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(results.find(r=>r.status==='rejected').reason.code,'MEDIA_EXISTS');
  assert.deepEqual(await fs.readdir(root),[`dy-${id}.mp4`]);assert.deepEqual(await fs.readFile(path.join(root,`dy-${id}.mp4`)),mp4);
});
