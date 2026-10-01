import { spawn } from 'node:child_process';
import { BrainError } from './artifact.mjs';

// 使用参数数组，来源正文和 URL 永远不能变成 shell 代码。
export function run(command, args, { timeout = 120_000, maxBytes = 8_000_000, cwd, env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell: false, stdio: ['ignore', 'pipe', 'pipe'], cwd, env });
    let stdout = '', stderr = '', size = 0, failed = false;
    const fail = error => { if (failed) return; failed = true; child.kill('SIGKILL'); clearTimeout(timer); reject(error); };
    const timer = setTimeout(() => fail(new BrainError('COMMAND_TIMEOUT', `${command} 执行超时`)), timeout);
    for (const [stream, which] of [[child.stdout, 'out'], [child.stderr, 'err']]) stream.setEncoding('utf8').on('data', chunk => {
      size += Buffer.byteLength(chunk);
      if (size > maxBytes) return fail(new BrainError('OUTPUT_LIMIT', `${command} 输出超出上限`));
      if (which === 'out') stdout += chunk; else stderr += chunk;
    });
    child.on('error', e => fail(new BrainError(e.code === 'ENOENT' ? 'DEPENDENCY_MISSING' : 'COMMAND_ERROR', `${command} 无法启动：${e.code}`)));
    child.on('close', code => {
      clearTimeout(timer);
      if (failed) return;
      if (code !== 0) {
        const known = ['AUTH_REQUIRED', 'SECURITY_BLOCK', 'EMPTY_RESULT', 'SESSION', 'TIMEOUT'].find(s => stderr.includes(s) || stdout.includes(s));
        reject(new BrainError(known || 'COMMAND_FAILED', `${command} 退出码 ${code}；请直接运行对应工具诊断，避免把登录凭据写进日志`));
      } else resolve({ stdout, stderr });
    });
  });
}

export function parseJsonOutput(stdout) {
  // OpenCLI 的升级提示可能跟在 JSON 后面，只接受开头的一个完整 JSON 值。
  const s = stdout.trim();
  try { return JSON.parse(s); } catch {}
  if (!['{', '['].includes(s[0])) throw new BrainError('INVALID_TOOL_OUTPUT', '工具没有返回 JSON');
  let depth = 0, quoted = false, escaped = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) { if (escaped) escaped = false; else if (ch === '\\') escaped = true; else if (ch === '"') quoted = false; }
    else if (ch === '"') quoted = true;
    else if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') { if (--depth === 0) return JSON.parse(s.slice(0, i + 1)); }
  }
  throw new BrainError('INVALID_TOOL_OUTPUT', '工具 JSON 不完整');
}
