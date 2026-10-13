import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID, createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { BrainError, requireValue } from './artifact.mjs';

export const safeCode = (error, fallback = 'UNKNOWN_ERROR') => /^[A-Z][A-Z0-9_]{1,63}$/.test(error?.code) ? error.code : fallback;
export function retryAfter(value, clock=Date.now()) {
  const seconds = typeof value==='string' && !/^\d+(?:\.\d+)?$/.test(value.trim()) ? (Date.parse(value)-clock)/1000 : Number(value);
  return Number.isFinite(seconds) ? Math.min(60,Math.max(0,seconds)) : 0;
}
export function failure(error, stage, attempt = 1) {
  const code = safeCode(error);
  const transient = /^(?:MEDIA_)?HTTP_(408|429|5\d\d)$/.test(code) || ['NETWORK_ERROR', 'ECONNRESET', 'ECONNREFUSED', 'EAI_AGAIN', 'ENETUNREACH', 'ETIMEDOUT', 'MEDIA_DOWNLOAD_FAILED'].includes(code);
  const intervention = ['AUTH_REQUIRED', 'SECURITY_BLOCK', 'SIGNED_URL_REQUIRED', 'EACCES', 'EPERM'].includes(code);
  const reasons={AUTH_REQUIRED:'平台要求本人登录，尚未取得可用内容。',SECURITY_BLOCK:'平台要求安全验证，自动处理已停止。',SIGNED_URL_REQUIRED:'分享链接缺少当前有效的访问参数。',
    COMMAND_TIMEOUT:'工具执行超过时限，不能确认该步骤完成。',COMMAND_INTERRUPTED:'工具执行被中断，保留已完成检查点。',MEDIA_TIMEOUT:'媒体下载超过时限。',
    ASR_UNCONFIGURED:'尚未指定可用的本地转写 Python。',ASR_MODEL_MISSING:'转写运行端缺少所需本地模型。',ASR_FAILED:'本地转写未成功，需检查运行环境或媒体。',
    NO_AUDIO:'视频中没有可用音轨。',EMPTY_TRANSCRIPT:'转写没有返回有效正文与模型来源。',NO_VIDEO:'没有可复用的本地视频。',EMPTY_MEDIA:'当前来源未取得所需媒体。',
    MEDIA_DEPENDENCY_MISSING:'抽帧依赖未就绪。',FRAMES_INCOMPLETE:'抽帧未完成，不能进入视觉识读。',VISION_UNAVAILABLE:'实际图像识读工具不可用。',VISION_NOT_REVIEWED:'没有符合协议的实际图像输入与识读记录。',
    NO_VISUAL_FACT:'尚无可可靠引用的新增画面文字事实。',INCOMPLETE_SOURCE:'来源整理尚未达到完整条件，请检查覆盖状态、必要原文和模型身份。',
    INVALID_TOOL_OUTPUT:'工具没有返回预期的完整结构化结果。',SOURCE_CHANGED:'来源或已有结果发生变化，不能覆盖原知识。',SOURCE_MISMATCH:'当前结果不属于本次指定来源或图片。',
    CHECKPOINT_CHANGED:'检查点文件与已记录的哈希或大小不一致。',UNSUPPORTED_CLAIM:'观点或画面事实没有逐字匹配的原始引文。',UNSAFE_PATH:'结果路径越界或包含不允许的链接。',
    TASK_LOCKED:'另一个执行者仍持有任务锁，或无法证明它已退出。',COMMAND_STILL_RUNNING:'上次工具进程可能仍在运行，不能重复启动。',
    INDEX_UNAVAILABLE:'当前索引工具未能完成操作。',INDEX_NOT_VERIFIED:'尚未取得当前来源的真实检索与回读证据。',DELIVERY_UNCERTAIN:'答复已保留，但无法确认上一发送结果。',
    DAMAGED_SOURCE:'已保存来源或证据损坏，暂停继续引用。',STALE_ACTION:'本次操作令牌已过期，不能登记迟到结果。'};
  return { stage, code, reason:reasons[code] || (transient?'出现可有限重试的临时连接或服务故障。':'该步骤未成功；错误未被自动恢复策略识别，已安全暂停。'), retryable: transient, attempt, category: transient ? 'temporary' : intervention ? 'user_action' : 'paused',
    retry_after_seconds: Math.min(60, Math.max(0, Number(error?.retry_after_seconds) || 0)),
    next_action: code === 'AUTH_REQUIRED' ? '请本人在运行电脑登录平台，然后继续此任务。'
      : code === 'SECURITY_BLOCK' ? '请本人检查平台验证；停止自动请求，不绕过限制。'
      : ['NO_AUDIO', 'EMPTY_TRANSCRIPT'].includes(code) ? '没有可用口播；保留媒体与画面，核对来源或调整处理要求。'
      : code === 'DELIVERY_UNCERTAIN' ? '结果已保留，发送状态未确认；需要时说“重发结果”。'
      : transient ? '自动重试预算耗尽后保留检查点；网络恢复后继续此任务。'
      : '保留已有结果，按错误码修复后继续；不覆盖原知识。' };
}

export async function withRetry(operation, { stage, onAttempt = async () => {}, wait = ms => new Promise(r => setTimeout(r, ms)), maxAttempts = 3 } = {}) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await onAttempt({ stage, attempt, status: 'running' });
    try {
      const result = await operation(attempt);
      await onAttempt({ stage, attempt, status: 'complete' });
      return result;
    } catch (error) {
      const info = failure(error, stage, attempt);
      await onAttempt({ ...info, status: 'failed' });
      if (!info.retryable || attempt === maxAttempts) throw Object.assign(new BrainError(info.code, '处理暂停；详细原因与下一步见任务回执'), { failure: info });
      const seconds = Math.max(attempt === 1 ? 2 : 8, info.retry_after_seconds);
      await wait(Math.min(60_000,Math.round(seconds * 1000 + Math.random() * 200)));
    }
  }
}

// 同目录 rename 发布；任何时刻 state.json 都是完整的旧版本或新版本。
export async function atomicJson(file, value) {
  const temp = path.join(path.dirname(file), `.${path.basename(file)}-${randomUUID()}.tmp`);
  let handle;
  try {
    handle = await fs.open(temp, 'wx', 0o600);
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`); await handle.sync(); await handle.close(); handle = null;
    await fs.rename(temp, file);
  } finally { await handle?.close().catch(() => {}); await fs.unlink(temp).catch(() => {}); }
}

export async function fileDigest(file, root) {
  const stat = await fs.lstat(file);
  requireValue(stat.isFile() && !stat.isSymbolicLink(), 'UNSAFE_PATH', '检查点需要普通文件');
  const actual = await fs.realpath(file), base = await fs.realpath(root);
  requireValue(actual.startsWith(`${base}${path.sep}`), 'UNSAFE_PATH', '检查点不能越出当前任务或知识库');
  const digest = createHash('sha256'); for await (const chunk of createReadStream(actual)) digest.update(chunk);
  return { path: actual, sha256: digest.digest('hex'), size: stat.size };
}
export async function verifyFile(receipt, root) {
  requireValue(receipt && typeof receipt.path === 'string', 'CHECKPOINT_INVALID', '检查点缺少文件路径');
  const actual = await fileDigest(receipt.path, root);
  requireValue(actual.sha256 === receipt.sha256 && actual.size === receipt.size, 'CHECKPOINT_CHANGED', '检查点文件与记录不一致，停止复用');
  return actual;
}

// 锁文件先完整写入，再以硬链接排他发布；不会留下“无持有者信息”的半把锁。
export async function withLock(file, action) {
  const owner = { pid: process.pid, host: os.hostname(), token: randomUUID() };
  const temp = `${file}.${owner.token}`;
  await fs.writeFile(temp, JSON.stringify(owner), { mode: 0o600, flag: 'wx' });
  let acquired = false;
  try {
    for (let i = 0; i < 2; i++) {
      try { await fs.link(temp, file); acquired = true; break; }
      catch (e) {
        if (e.code !== 'EEXIST') throw e;
        let prior;
        try { prior = JSON.parse(await fs.readFile(file, 'utf8')); } catch { throw new BrainError('TASK_LOCKED', '锁状态无法确认，保持暂停'); }
        let dead = false;
        if (prior.host === owner.host && Number.isSafeInteger(prior.pid) && prior.pid > 0) {
          try { process.kill(prior.pid, 0); } catch (e) { dead = e.code === 'ESRCH'; }
        }
        requireValue(dead, 'TASK_LOCKED', '任务仍被执行或锁持有者无法确认');
        // 回收者也需要排他锁，防止两个恢复进程互相删除新锁。
        const recovery = `${file}.recovery`;
        await fs.link(temp, recovery).catch(() => { throw new BrainError('TASK_LOCKED', '另一个进程正在回收锁'); });
        try {
          const current = JSON.parse(await fs.readFile(file, 'utf8'));
          requireValue(current.token === prior.token, 'TASK_LOCKED', '锁已更换，停止回收');
          await fs.unlink(file);
        } finally { await fs.unlink(recovery).catch(() => {}); }
      }
    }
    requireValue(acquired, 'TASK_LOCKED', '任务锁尚未取得');
    return await action();
  } finally {
    await fs.unlink(temp).catch(() => {});
    if (acquired) {
      const current = await fs.readFile(file, 'utf8').then(JSON.parse).catch(() => null);
      if (current?.token === owner.token) await fs.unlink(file);
    }
  }
}
