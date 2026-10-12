import fs from 'node:fs/promises';
import path from 'node:path';

export const releaseRoots = ['AGENTS.md', 'README.md', 'SKILL.md', 'LICENSE', 'CHANGELOG.md', 'CONTRIBUTING.md', 'SECURITY.md', 'THIRD_PARTY_NOTICES.md', '.gitignore', 'package.json', 'integrations.yaml', 'lib', 'scripts', 'references', 'templates', 'test', 'docs', '.github'];
export async function releaseFiles(root) {
  const files = [];
  const visit = async rel => {
    // 创作工程与私有取材记录独立交付；用户运行包只含知识处理和安装配方。
    if (['docs/video-production.md', 'docs/video-validation.md'].includes(rel)) return;
    if (/(^|\/)(\.local|\.git|node_modules|__pycache__|\.DS_Store)(\/|$)|\.(pyc|tgz)$/.test(rel)) return;
    const stat = await fs.lstat(path.join(root, rel));
    if (stat.isSymbolicLink()) throw new Error(`公开包不允许符号链接：${rel}`);
    if (stat.isDirectory()) for (const name of (await fs.readdir(path.join(root, rel))).sort()) await visit(`${rel}/${name}`);
    else if (stat.isFile()) files.push(rel);
    else throw new Error(`非普通文件：${rel}`);
  };
  for (const name of releaseRoots) await visit(name);
  return files.sort();
}
