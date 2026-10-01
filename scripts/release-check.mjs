import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { releaseFiles } from './release-files.mjs';

const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const files = await releaseFiles(root), issues = [];
for (const file of files) {
  const text = await fs.readFile(path.join(root, file), 'utf8');
  // 只报告文件与规则名，不在终端回显疑似密钥。
  for (const [name, pattern] of [
    ['绝对个人路径', /\/Users\/[A-Za-z][\w.-]*\//],
    ['疑似私钥', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
    ['疑似服务令牌', /\b(?:sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/],
    ['疑似 Tailscale 地址', /\b100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3}\b/],
  ]) if (pattern.test(text)) issues.push({ file, issue: name });
  if (!file.endsWith('.md')) continue;
  for (const m of text.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    const ref = m[1].split('#')[0];
    if (!ref || /^(https?:|mailto:|#)/.test(ref)) continue;
    const dest = path.resolve(root, path.dirname(file), decodeURIComponent(ref));
    if (!(dest === root || dest.startsWith(`${root}${path.sep}`)) || !await fs.stat(dest).catch(() => null)) issues.push({ file, issue: `本地链接无效：${ref}` });
  }
}
console.log(JSON.stringify({ ok: issues.length === 0, public_files: files.length, checks: ['公开文件白名单', '私有路径与常见凭据模式', 'Markdown 相对链接'], limitations: ['模式扫描不替代人工审阅；不验证远程链接或真实宿主兼容'], issues }, null, 2));
if (issues.length) process.exitCode = 1;
