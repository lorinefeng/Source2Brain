import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { captureXhs } from '../lib/capture.mjs';
import { BrainError } from '../lib/artifact.mjs';

const signed = 'https://www.xiaohongshu.com/explore/000000000000000000000002?xsec_token=synthetic';
async function setup(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'source2brain-capture-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const calls = [];
  const runner = async (command, args) => {
    calls.push([command, args]);
    if (command === 'agent-reach') return { stdout: JSON.stringify({ xiaohongshu: { status: 'warn', active_backend: null, backends: ['OpenCLI'] } }) };
    if (args[0] === '--version') return { stdout: '1.8.6' };
    if (args[0] === 'browser') {
      if (args[2] === 'get') return { stdout: args[3] === 'url' ? signed : '合成来源标题 - 小红书' };
      return { stdout: '{}' };
    }
    if (args[1] === 'note') return { stdout: JSON.stringify([{ field: 'title', value: '手机号登录' }, { field: 'author', value: '测试作者' }, { field: 'content', value: '真实配文的合成测试' }]) };
    if (args[1] === 'download') {
      const dir = path.join(args[args.indexOf('--output')+1], '000000000000000000000002');
      await fs.mkdir(dir, {recursive:true});
      await fs.writeFile(path.join(dir,'000000000000000000000002_1.mp4'),'synthetic media fixture');
      return { stdout: JSON.stringify([{ index: 1, type: 'video', status: 'success', size: '1 MB' }]) };
    }
    throw new Error('意外命令');
  };
  return { root, calls, runner };
}

test('新版体检 warn 以真实命令验证，并使用页面标题避开登录弹窗标题', async t => {
  const { root, calls, runner } = await setup(t);
  const result = await captureXhs('收藏 https://xhslink.cn/o/test', path.join(root, 'capture'), { runner });
  const artifact = JSON.parse(await fs.readFile(result.artifact, 'utf8'));
  assert.equal(artifact.source.title, '合成来源标题');
  assert.equal(artifact.content.type, 'video');
  assert.equal(artifact.extraction.status, 'partial');
  assert.equal(result.source_id, 'xhs-000000000000000000000002');
  assert.equal(result.media[0].size, 23);
  assert.match(result.media[0].sha256, /^[a-f0-9]{64}$/);
  assert.ok(calls.find(([cmd, args]) => cmd === 'opencli' && args[1] === 'note')[1].includes('ephemeral'));
  assert.equal(calls.at(-1)[1][2], 'close');
});

test('登录失败保留失败回执并释放自己打开的 tab，不生成成功 artifact', async t => {
  const { root, calls, runner } = await setup(t);
  const output = path.join(root, 'capture');
  await assert.rejects(captureXhs('https://xhslink.cn/o/test', output, { runner: async (cmd, args) => {
    if (args[1] === 'note') throw new BrainError('AUTH_REQUIRED', '需要登录');
    return runner(cmd, args);
  } }), { code: 'AUTH_REQUIRED' });
  const journal = JSON.parse(await fs.readFile(path.join(output, 'capture.json'), 'utf8'));
  assert.equal(journal.status, 'failed');
  await assert.rejects(fs.stat(path.join(output, 'artifact.json')), { code: 'ENOENT' });
  assert.equal(calls.at(-1)[1][2], 'close');
});

test('媒体失败仅生成 partial，不把只有配文的来源标记完整', async t => {
  const { root, runner } = await setup(t);
  const result = await captureXhs('https://xhslink.cn/o/test', path.join(root, 'capture'), { runner: async (cmd, args) => {
    if (args[1] === 'download') throw new BrainError('MEDIA_FAILED', '测试失败');
    return runner(cmd, args);
  } });
  assert.equal(result.media_error, 'MEDIA_FAILED');
  const artifact = JSON.parse(await fs.readFile(result.artifact, 'utf8'));
  assert.equal(artifact.extraction.status, 'partial');
  assert.equal(artifact.extraction.visuals, 'missing');
  assert.match(artifact.extraction.limitations.join(' '), /类型尚未核对/);
});

test('小红书原始与跳转后的目标 ID 不一致则停止并关闭本次 session', async t => {
  const {root,calls,runner}=await setup(t);
  await assert.rejects(captureXhs(signed.replace(/000002/g,'000001'),path.join(root,'capture'),{runner}),{code:'SOURCE_MISMATCH'});
  assert.equal(calls.at(-1)[1][2],'close');
  const r=JSON.parse(await fs.readFile(path.join(root,'capture/capture.json'),'utf8'));
  assert.equal(r.error_code,'SOURCE_MISMATCH');assert.match(r.next_action,/核对/);
});

test('多图部分失败、虚报成功或越界顺序均记录缺失，不宣称媒体完整', async t => {
  const {root,runner}=await setup(t);
  const result=await captureXhs('https://xhslink.cn/o/test',path.join(root,'capture'),{runner:async(cmd,args)=>{
    if(args[1]==='download')return{stdout:JSON.stringify([
      {index:1,type:'image',status:'failed'},
      {index:2,type:'image',status:'success'},
      {index:'../../outside',type:'image',status:'success'},
    ])};
    return runner(cmd,args);
  }});
  assert.equal(result.media_error,'MEDIA_PARTIAL');assert.deepEqual(result.media,[]);
  const a=JSON.parse(await fs.readFile(result.artifact,'utf8'));
  assert.equal(a.extraction.status,'partial');assert.equal(a.extraction.visuals,'missing');
  assert.match(a.extraction.limitations.join(' '),/第 1 个媒体下载失败/);
  assert.match(a.extraction.limitations.join(' '),/第 2 个媒体未通过附件校验/);
  assert.match(a.extraction.limitations.join(' '),/顺序字段无效/);
});

test('旧 captureXhs API 拒绝抖音输入且不先打开浏览器或创建目录', async t => {
  const {root,calls,runner}=await setup(t);
  await assert.rejects(captureXhs('https://www.douyin.com/video/7000000000000000001',path.join(root,'capture'),{runner}),{code:'UNSUPPORTED_HOST'});
  assert.equal(calls.length,0);await assert.rejects(fs.stat(path.join(root,'capture')),{code:'ENOENT'});
});
