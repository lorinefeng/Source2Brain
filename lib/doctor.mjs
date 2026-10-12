import fs from 'node:fs/promises';
import path from 'node:path';
import { constants } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { run, parseJsonOutput } from './process.mjs';
import { expandHome } from './store.mjs';
import { requireValue, extractUrl, parseSourceUrl } from './artifact.mjs';
import { probeSource } from './capture.mjs';

const resultCode = error => ({ status: 'missing_or_failed', code: error.code || 'CHECK_FAILED' });
const firstVersion = text => text.match(/\b\d{1,4}\.\d{1,2}\.\d+(?:[-.][A-Za-z0-9.-]+)?\b/)?.[0] || null;
// 只保留诊断字段，不能把工具日志、账号资料或完整 provider 配置透传到报告。
export function bridgeStatus(stdout) {
  const extension = stdout.match(/^\[OK\] Extension: connected(?: \(v([\d.]+)\))?/m);
  const live = /^\[OK\] (?:Browser|Connectivity|Live)/m.test(stdout);
  return { status: extension && live ? 'ready' : extension ? 'connected_not_verified' : 'unavailable', extension_version: extension?.[1] || null, live_probe: live };
}

export async function doctor({ store = '~/SecondBrain', profile = process.env.SOURCE2BRAIN_PROFILE || 'source2brain', message, runner = run, prober = probeSource, env = process.env } = {}) {
  requireValue(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(profile), 'INVALID_PROFILE', 'profile 只允许字母、数字、短横线与下划线');
  const checks = {};
  const versions = await Promise.allSettled(['node', 'opencli', 'openclaw', 'hermes'].map(async name => {
    const { stdout } = await runner(name, ['--version'], { timeout: 20_000 });
    return [name, { status: 'ok', version: firstVersion(stdout), required_for_capture: ['node', 'opencli'].includes(name) }];
  }));
  versions.forEach((r, i) => { const name = ['node', 'opencli', 'openclaw', 'hermes'][i]; checks[name] = r.status === 'fulfilled' ? r.value[1] : { ...resultCode(r.reason), required_for_capture: ['node', 'opencli'].includes(name) }; });
  let openclawCommand = 'openclaw';
  let openclawPrefix = ['--profile', profile];
  let openclawOptions = {};
  if (checks.openclaw.status !== 'ok') {
    // SSH PATH 可能缺少本项目隔离安装；复用同一入口，不扫描用户目录。
    const wrapper = fileURLToPath(new URL('../scripts/openclaw.sh', import.meta.url));
    try {
      const options = { env: { ...env, SOURCE2BRAIN_PROFILE: profile }, timeout: 20_000 };
      const { stdout } = await runner('bash', [wrapper, '--version'], options);
      checks.openclaw = { status: 'ok', version: firstVersion(stdout), required_for_capture: false, entrypoint: 'project_wrapper' };
      openclawCommand = 'bash'; openclawPrefix = [wrapper]; openclawOptions = { env: options.env };
    } catch { /* 可选宿主确实缺失时保留原诊断，不安装。 */ }
  }
  try {
    const reach = parseJsonOutput((await runner('agent-reach', ['doctor', '--json'], { timeout: 120_000 })).stdout);
    const xhs = reach.xiaohongshu || {};
    checks['agent-reach'] = { status: ['ok', 'warn', 'error', 'disabled'].includes(xhs.status) ? xhs.status : 'unknown', xiaohongshu_backend: xhs.active_backend === 'OpenCLI' ? 'OpenCLI' : null, opencli_candidate: Array.isArray(xhs.backends) && xhs.backends.includes('OpenCLI') };
  } catch (e) { checks['agent-reach'] = resultCode(e); }
  let browser_bridge;
  try { browser_bridge = bridgeStatus((await runner('opencli', ['doctor'], { timeout: 30_000 })).stdout); }
  catch (e) { browser_bridge = resultCode(e); }
  // OpenCLI douyin 的快速 auth 探针检查 creator.douyin.com；不能据此判断公开视频域登录。
  const platform_access = {
    xiaohongshu: { status: 'not_probed', login_verified: false, content_verified: false, next: '用一条授权链接执行 capture；可读配文也不等于媒体完整' },
    douyin: { status: 'not_probed', login_verified: false, content_verified: false, next: '在当前 OpenCLI 连接的浏览器打开 www.douyin.com；使用指定视频 capture，勿以创作者域会话作证明' }
  };
  if (message) {
    const target = parseSourceUrl(extractUrl(message));
    try {
      const result = await prober(message, { runner });
      platform_access[target.platform] = { status: result.content_access, source_id: result.source_id,
        login_verified: false, content_verified: false, metadata_verified: result.content_access === 'readable_metadata',
        media_observed: result.media_observed === true, download_verified: false,
        next: '单条元数据可读不等于登录有效或媒体完整；继续 capture 核对实际附件' };
    } catch (error) {
      platform_access[target.platform] = { status: 'failed', code: error.code || 'CHECK_FAILED', login_verified: false, content_verified: false,
        next: '保留当前登录态，按错误码处理登录或访问问题；不要绕过平台验证' };
    }
  }
  let asr;
  try {
    const args = [fileURLToPath(new URL('../scripts/install-asr.py', import.meta.url)), '--check'];
    if (env.SOURCE2BRAIN_ASR_PYTHON) args.push('--reuse-python', expandHome(env.SOURCE2BRAIN_ASR_PYTHON));
    if (env.SOURCE2BRAIN_ASR_MODEL_ROOT) args.push('--model-root', expandHome(env.SOURCE2BRAIN_ASR_MODEL_ROOT));
    asr = parseJsonOutput((await runner('python3', args, { timeout: 180_000, allowedExitCodes: [0, 1] })).stdout);
  } catch (e) { asr = { ...resultCode(e), next: '按 references/asr/README.md 检测或显式安装本地转写；基础安装不下载模型', transcription_verified: false }; }
  const root = expandHome(store);
  let knowledge;
  try {
    const stat = await fs.lstat(root);
    if (!stat.isDirectory() || stat.isSymbolicLink()) knowledge = { status: 'unsafe_path', path: root };
    else {
      const writable = await fs.access(root, constants.R_OK | constants.W_OK).then(() => true, () => false);
      const sources = await fs.lstat(path.join(root, 'Sources')).catch(() => null);
      knowledge = { status: writable ? 'accessible' : 'permission_denied', path: root, initialized: Boolean(sources?.isDirectory() && !sources?.isSymbolicLink()), write_probe_performed: false };
    }
  } catch (e) { knowledge = { status: e.code === 'ENOENT' ? 'not_initialized' : 'unavailable', path: root, code: e.code }; }
  let wechat;
  if (checks.openclaw.status !== 'ok') wechat = { status: 'not_installed_optional', profile, message_delivery_verified: false };
  else {
    try {
      const raw = parseJsonOutput((await runner(openclawCommand, [...openclawPrefix, 'channels', 'status', '--json'], { ...openclawOptions, timeout: 30_000 })).stdout);
      const channel = raw.channels?.['openclaw-weixin'] || raw.channels?.weixin || raw.channels?.wechat;
      const accounts = raw.channelAccounts?.['openclaw-weixin'] || raw.channelAccounts?.weixin || [];
      wechat = { status: channel?.running === true || accounts.some(a => a.running === true) ? 'running' : 'not_confirmed', profile,
        configured: channel?.configured === true || accounts.some(a => a.configured === true), message_delivery_verified: false };
    } catch (e) { wechat = { ...resultCode(e), profile, message_delivery_verified: false }; }
  }
  return { ok: true, checks, browser_bridge, platform_access, asr, knowledge, wechat,
    capture_tools_ready: checks.node.status === 'ok' && checks.opencli.status === 'ok' && ['ok', 'warn'].includes(checks['agent-reach'].status),
    capture_ready: false, e2e_verified: false,
    scope: '只读检测；不安装、不扫码、不写知识库。浏览器桥接不代表平台登录或内容完整，微信服务运行不代表消息送达。' };
}
