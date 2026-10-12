import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { packageSkill } from '../scripts/package-skill.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
async function temp(t) { const dir = await fs.mkdtemp(path.join(os.tmpdir(), 's2b-install-test-')); t.after(() => fs.rm(dir, {recursive:true, force:true})); return dir; }
async function exists(file) { return Boolean(await fs.stat(file).catch(() => null)); }
const run = (file, args, env = {}) => spawnSync(file, args, { cwd:root, encoding:'utf8', env:{...process.env,...env}, timeout:30000 });

test('完整 Skill 脱离源码可回读、再次打包，不携带视频和运行依赖', async t => {
  const dir=await temp(t), skill=await packageSkill({parent:dir});
  for (const rel of ['scripts/bootstrap-macos.sh','scripts/runtime-env.sh','scripts/configure-openclaw.py','scripts/install-asr.py','docs/installation.md','docs/wechat-recipe.md','references/asr/macos-arm64.lock.json','templates/workspace/AGENTS.md']) assert.ok(await exists(path.join(skill,rel)),rel);
  for (const rel of ['.local','video','node_modules','.git']) assert.equal(await exists(path.join(skill,rel)),false);
  const cli=spawnSync(process.execPath,[path.join(skill,'scripts/brain.mjs'),'--help'],{cwd:os.tmpdir(),encoding:'utf8'});
  assert.equal(cli.status,0,cli.stderr);
  const second=await temp(t); assert.ok(await exists(await packageSkill({root:skill,parent:second})));
});

test('分发拒绝失效安装引用、越界链接和符号链接', async t => {
  const dir=await temp(t), skill=await packageSkill({parent:dir});
  await fs.appendFile(path.join(skill,'README.md'),'\n[缺少](missing-install.md)\n');
  await assert.rejects(packageSkill({root:skill,parent:await temp(t)}),/ENOENT/);
  await fs.writeFile(path.join(skill,'README.md'),'[越界](../escape.md)\n');
  await fs.writeFile(path.join(dir,'escape.md'),'x');
  await assert.rejects(packageSkill({root:skill,parent:await temp(t)}),/分发路径/);
  await fs.writeFile(path.join(skill,'README.md'),'');
  await fs.symlink(path.join(dir,'escape.md'),path.join(skill,'templates','outside.md'));
  await assert.rejects(packageSkill({root:skill,parent:await temp(t)}),/符号链接/);
});

async function fakeRuntime(t) {
  const dir=await temp(t),bin=path.join(dir,'bin'),home=path.join(dir,'home'),log=path.join(dir,'calls.jsonl');await fs.mkdir(bin);
  await fs.writeFile(path.join(bin,'uname'),'#!/bin/bash\n[[ "$1" == -s ]] && echo Darwin || echo arm64\n',{mode:0o755});
  await fs.writeFile(path.join(bin,'npm'),'#!/bin/bash\necho unexpected-install >&2\nexit 91\n',{mode:0o755});
  const claw=path.join(bin,'fake-openclaw');
  await fs.writeFile(claw,`#!${process.execPath}
const fs=require('fs'),path=require('path');const args=process.argv.slice(2);
fs.appendFileSync(process.env.SOURCE2BRAIN_LOG,JSON.stringify(args)+'\\n');
if(args[0]==='--version'){console.log('OpenClaw 2026.9.6');process.exit(0)}
const profile=args[1],cmd=args.slice(2),state=path.join(process.env.HOME,'.openclaw-'+profile),workspace=process.env.SOURCE2BRAIN_WORKSPACE;
if(cmd[0]==='setup'){fs.mkdirSync(state,{recursive:true});fs.writeFileSync(path.join(state,'openclaw.json'),JSON.stringify({agents:{defaults:{workspace}}}));process.exit(0)}
if(cmd[0]==='config'&&cmd[1]==='get'){console.log(workspace);process.exit(0)}
if(cmd[0]==='skills'&&cmd[1]==='install'){const dest=path.join(workspace,'skills/source2brain');fs.mkdirSync(path.dirname(dest),{recursive:true});if(process.env.FAIL_SKILL){fs.rmSync(dest,{recursive:true,force:true});fs.mkdirSync(dest);fs.writeFileSync(path.join(dest,'broken'),'x');process.exit(1)}fs.rmSync(dest,{recursive:true,force:true});fs.cpSync(cmd[2],dest,{recursive:true});process.exit(0)}
if(cmd[0]==='config'&&cmd[1]==='patch'){let input='';process.stdin.on('data',x=>input+=x);process.stdin.on('end',()=>{fs.mkdirSync(state,{recursive:true});fs.writeFileSync(path.join(state,'openclaw.json'),input);process.exit(process.env.FAIL_PATCH?1:0)});}
`,{mode:0o755});
  return {dir,home,log,claw,env:{HOME:home,PATH:`${bin}:${process.env.PATH}`,SOURCE2BRAIN_NODE_BIN:process.execPath,SOURCE2BRAIN_OPENCLAW_BIN:claw,SOURCE2BRAIN_PROFILE:'isolated-test',SOURCE2BRAIN_WORKSPACE:path.join(dir,'workspace'),SOURCE2BRAIN_LOG:log}};
}

test('bootstrap 默认只检查；已存在依赖复用且 profile 一致，失败恢复旧 Skill', async t => {
  const x=await fakeRuntime(t);
  let p=run('bash',['scripts/bootstrap-macos.sh'],x.env);assert.equal(p.status,0,p.stderr);assert.equal(await exists(x.home),false);
  p=run('bash',['scripts/bootstrap-macos.sh','--install'],x.env);assert.equal(p.status,0,p.stderr);
  const marker=path.join(x.env.SOURCE2BRAIN_WORKSPACE,'skills/source2brain/manual-marker');await fs.writeFile(marker,'保留');
  p=run('bash',['scripts/bootstrap-macos.sh','--install'],{...x.env,FAIL_SKILL:'1'});assert.equal(p.status,1);assert.equal(await fs.readFile(marker,'utf8'),'保留');
  const calls=(await fs.readFile(x.log,'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(calls.filter(a=>a.includes('setup')).length,1);
  assert.ok(calls.filter(a=>a[0]!=='--version').every(a=>a[1]==='isolated-test'));
  assert.equal(await exists(path.join(x.home,'.openclaw')),false);
});

test('配置器失败恢复 config 和 env，不把密钥打印到回执', async t => {
  const x=await fakeRuntime(t),state=path.join(x.home,'.openclaw-isolated-test');await fs.mkdir(state,{recursive:true});
  const cfg=path.join(state,'openclaw.json'),env=path.join(state,'.env');
  await fs.writeFile(cfg,'{"manual":"keep"}\n');await fs.writeFile(env,'ORIGINAL=keep\n');
  const p=run('python3',['scripts/configure-openclaw.py','--provider','synthetic','--model','synthetic-model','--base-url','https://example.invalid/v1','--store',path.join(x.dir,'store'),'--openclaw-bin',x.claw],{...x.env,SOURCE2BRAIN_API_KEY:'synthetic-secret-do-not-print',FAIL_PATCH:'1'});
  assert.equal(p.status,1);assert.equal(await fs.readFile(cfg,'utf8'),'{"manual":"keep"}\n');assert.equal(await fs.readFile(env,'utf8'),'ORIGINAL=keep\n');assert.ok(!(p.stdout+p.stderr).includes('synthetic-secret-do-not-print'));
});

test('ASR 只读检测缺失模型，不安装且不伪造转写验证', async t => {
  const dir=await temp(t),target=path.join(dir,'not-created');
  const p=run('python3',['scripts/install-asr.py','--check','--root',target,'--model-root',path.join(dir,'missing-models')],{SOURCE2BRAIN_ASR_PYTHON:'',SOURCE2BRAIN_ASR_MODEL_ROOT:''});
  assert.equal(p.status,1,p.stderr);const result=JSON.parse(p.stdout);assert.equal(result.status,'missing');assert.equal(result.transcription_verified,false);assert.equal(result.checks.sample.status,'not_run');assert.equal(await exists(target),false);
});

test('ASR 固定清单拒绝漂移，缺依赖与哈希损坏分别报告', async () => {
  const code=`import importlib.util,json,tempfile,pathlib,hashlib
s=importlib.util.spec_from_file_location('asr','scripts/install-asr.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
r=json.loads(m.RECIPE.read_text());assert m.pinned(r);r['models'][0]['revision']='master';assert not m.pinned(r)
with tempfile.TemporaryDirectory() as t:
 root=pathlib.Path(t);d=root/'tiny';d.mkdir();(d/'model.pt').write_text('broken')
 sample={'packages':{},'models':[{'id':'test/tiny','required_files':['model.pt'],'sha256':{'model.pt':hashlib.sha256(b'expected').hexdigest()},'revision':'fixed'}]}
 out=m.inspect(None,root,sample);assert out['checks']['imports']['status']=='missing';assert out['checks']['models']['items'][0]['hash_mismatches']==['model.pt'];assert not out['ready']
print('ok')`;
  const p=run('python3',['-c',code]);assert.equal(p.status,0,p.stderr);
});

test('ASR 复用只写本项目回执，版本和模型完整性不偷换成转写通过', async () => {
  const code=`import importlib.util,json,tempfile,pathlib,hashlib,types,sys
s=importlib.util.spec_from_file_location('asr','scripts/install-asr.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
with tempfile.TemporaryDirectory() as t:
 root=pathlib.Path(t);models=root/'shared-models';d=models/'tiny';d.mkdir(parents=True);(d/'model.pt').write_text('model');shared=root/'shared';shared.mkdir();(shared/'keep').write_text('untouched')
 python=shared/'python';payload=json.dumps({'python':'3.11.16','packages':{'funasr':'1.4.16'},'errors':[]});python.write_text('#!'+sys.executable+'\\nprint('+repr(payload)+')\\n');python.chmod(0o755)
 recipe={'status':'pinned','packages':{'funasr':'1.4.16'},'models':[{'id':'test/tiny','required_files':['model.pt'],'sha256':{'model.pt':hashlib.sha256(b'model').hexdigest()},'revision':'0123456789abcdef'}]}
 args=types.SimpleNamespace(root=root/'private',reuse_python=python,model_root=models)
 out=m.install(args,recipe);assert out['status']=='reused';assert not out['transcription_verified'];assert pathlib.Path(out['receipt']).is_file();assert (shared/'keep').read_text()=='untouched';assert sorted(p.name for p in shared.iterdir())==['keep','python']
print('ok')`;
  const p=run('python3',['-c',code]);assert.equal(p.status,0,p.stderr);
});

test('ASR 复用区分核心导入与发行锁 metadata：辅助包缺失可复用，核心缺失不可用', async () => {
  const code=`import importlib.util,tempfile,pathlib,hashlib,subprocess,sys
s=importlib.util.spec_from_file_location('asr','scripts/install-asr.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
def execute(args,**kwargs):
 prefix='import importlib.metadata\\ndef version(name):\\n if name == "synthetic-core": return "1.0"\\n raise importlib.metadata.PackageNotFoundError(name)\\nimportlib.metadata.version=version\\n'
 return subprocess.run([sys.executable,'-c',prefix+args[2],*args[3:]],text=True,capture_output=True,check=True)
m.execute=execute
with tempfile.TemporaryDirectory() as t:
 root=pathlib.Path(t);d=root/'tiny';d.mkdir();(d/'model.pt').write_text('model')
 recipe={'packages':{'synthetic-core':'1.0','synthetic-extra':'2.0'},'models':[{'id':'test/tiny','required_files':['model.pt'],'sha256':{'model.pt':hashlib.sha256(b'model').hexdigest()},'revision':'fixed'}]}
 m.IMPORTS={'synthetic-core':'json'}
 out=m.inspect(sys.executable,root,recipe)
 assert out['ready'] and out['checks']['imports']['status']=='ready';assert not out['versions_match_recipe'];assert out['recipe_differences']==[{'package':'synthetic-extra','expected':'2.0','actual':None}];assert not out['transcription_verified']
 m.IMPORTS={'synthetic-core':'source2brain_synthetic_missing_core'}
 out=m.inspect(sys.executable,root,recipe)
 assert not out['ready'] and out['checks']['imports']['status']=='failed';assert out['checks']['imports']['errors'][0]['package']=='synthetic-core'
print('ok')`;
  const p=run('python3',['-c',code]);assert.equal(p.status,0,p.stderr);
});

test('ASR 下载拒绝错误内容、清理 part、已验证文件复用且拒绝越域重定向', async () => {
  const code=`import importlib.util,tempfile,pathlib,hashlib,io,urllib.request
s=importlib.util.spec_from_file_location('asr','scripts/install-asr.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
class Fake:
 def __init__(self,data):self.data=data;self.calls=0
 def open(self,*a,**kw):self.calls+=1;return io.BytesIO(self.data)
with tempfile.TemporaryDirectory() as t:
 root=pathlib.Path(t);recipe={'models':[{'id':'test/tiny','revision':'fixed','sha256':{'model.pt':hashlib.sha256(b'good').hexdigest()},'files':{'model.pt':{'bytes':4}}}]}
 bad=Fake(b'evil')
 try:m.download_models(root,recipe,bad);raise AssertionError('accepted corrupt')
 except RuntimeError as e:assert str(e)=='ASR_DOWNLOAD_HASH_MISMATCH'
 assert not list(root.rglob('*.part'));assert not (root/'tiny/model.pt').exists()
 good=Fake(b'good');m.download_models(root,recipe,good);m.download_models(root,recipe,good);assert good.calls==1
 assert (root/'tiny/model.pt').read_bytes()==b'good'
try:m.ModelRedirects().redirect_request(urllib.request.Request('https://modelscope.cn/test'),None,302,'',{},'https://example.invalid/model');raise AssertionError('accepted redirect')
except RuntimeError as e:assert str(e)=='ASR_DOWNLOAD_REDIRECT_REJECTED'
print('ok')`;
  const p=run('python3',['-c',code]);assert.equal(p.status,0,p.stderr);
});

test('配置器 CLI 无法启动也恢复两份原配置', async t => {
  const x=await fakeRuntime(t),state=path.join(x.home,'.openclaw-isolated-test');await fs.mkdir(state,{recursive:true});
  const cfg=path.join(state,'openclaw.json'),env=path.join(state,'.env');await fs.writeFile(cfg,'{"manual":"keep"}\n');await fs.writeFile(env,'ORIGINAL=keep\n');
  const p=run('python3',['scripts/configure-openclaw.py','--provider','synthetic','--model','synthetic-model','--base-url','https://example.invalid/v1','--store',path.join(x.dir,'store'),'--openclaw-bin',path.join(x.dir,'missing-cli')],{...x.env,SOURCE2BRAIN_API_KEY:'synthetic-secret-do-not-print'});
  assert.equal(p.status,1);assert.equal(await fs.readFile(cfg,'utf8'),'{"manual":"keep"}\n');assert.equal(await fs.readFile(env,'utf8'),'ORIGINAL=keep\n');assert.equal((await fs.readdir(state)).filter(x=>x.startsWith('.env-')).length,0);
});

test('首次 Skill 安装失败移出加载目录，不留下不完整技能', async t => {
  const x=await fakeRuntime(t),p=run('bash',['scripts/bootstrap-macos.sh','--install'],{...x.env,FAIL_SKILL:'1'});
  assert.equal(p.status,1);assert.equal(await exists(path.join(x.env.SOURCE2BRAIN_WORKSPACE,'skills/source2brain')),false);
  const backups=await fs.readdir(path.join(x.home,'.openclaw-isolated-test/backups'));
  assert.ok(await exists(path.join(x.home,'.openclaw-isolated-test/backups',backups[0],'failed-skill/broken')));
});

test('ASR 复用前拒绝损坏的依赖锁，不安装也不创建运行目录', async () => {
  const code=`import importlib.util,json,tempfile,pathlib,types
s=importlib.util.spec_from_file_location('asr','scripts/install-asr.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
r=json.loads(m.RECIPE.read_text());r['requirements_sha256']='0'*64
with tempfile.TemporaryDirectory() as t:
 root=pathlib.Path(t)/'not-created';args=types.SimpleNamespace(root=root,reuse_python=None)
 try:m.install(args,r);raise AssertionError('accepted damaged lock')
 except RuntimeError as e:assert str(e)=='ASR_REQUIREMENTS_HASH_MISMATCH'
 assert not root.exists()
print('ok')`;
  const p=run('python3',['-c',code]);assert.equal(p.status,0,p.stderr);
});
