import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { run } from '../lib/process.mjs';
import { releaseFiles } from './release-files.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
const version = pkg.version;
if (!/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(version)) throw new Error('版本格式无效');
await run(process.execPath, [path.join(root, 'scripts/release-check.mjs')]);
const out = path.join(root, '.local', 'releases', `v${version}`);
await fs.mkdir(out, { recursive: true });
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 's2b-release-'));
let skillParent;
try {
  const sourceName = `Source2Brain-${version}`, source = path.join(temp, sourceName);
  const manifest = [];
  for (const rel of await releaseFiles(root)) {
    const dest = path.join(source, rel); await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.copyFile(path.join(root, rel), dest);
    manifest.push({ path: rel, sha256: createHash('sha256').update(await fs.readFile(dest)).digest('hex') });
  }
  const skill = (await run(process.execPath, [path.join(root, 'scripts/package-skill.mjs')])).stdout.trim();
  skillParent = path.dirname(skill);
  const sourceArchive = `Source2Brain-${version}.tar.gz`, skillArchive = `source2brain-skill-${version}.tar.gz`;
  await run('tar', ['-czf', path.join(out, sourceArchive), '-C', temp, sourceName], { env: { ...process.env, COPYFILE_DISABLE: '1' } });
  await run('tar', ['-czf', path.join(out, skillArchive), '-C', skillParent, 'source2brain'], { env: { ...process.env, COPYFILE_DISABLE: '1' } });
  await fs.writeFile(path.join(out, 'manifest.json'), `${JSON.stringify({ version, files: manifest }, null, 2)}\n`);
  const sums = [];
  for (const name of [sourceArchive, skillArchive, 'manifest.json']) sums.push(`${createHash('sha256').update(await fs.readFile(path.join(out, name))).digest('hex')}  ${name}`);
  await fs.writeFile(path.join(out, 'SHA256SUMS'), `${sums.join('\n')}\n`);
  console.log(JSON.stringify({ version, directory: out, assets: [sourceArchive, skillArchive, 'manifest.json', 'SHA256SUMS'], source_files: manifest.length }, null, 2));
} finally {
  await fs.rm(temp, { recursive: true, force: true });
  if (skillParent) await fs.rm(skillParent, { recursive: true, force: true });
}
