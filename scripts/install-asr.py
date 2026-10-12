#!/usr/bin/env python3
"""本地 FunASR 配方。默认只检查；显式 --install 才下载，绝不修改共享 Python。"""
import argparse
import datetime
import hashlib
import json
import os
import pathlib
import platform
import subprocess
import sys
import tempfile
import urllib.parse
import urllib.request
import uuid

RECIPE = pathlib.Path(__file__).resolve().parents[1] / 'references/asr/macos-arm64.lock.json'
DEFAULT_ROOT = pathlib.Path.home() / '.local/share/source2brain/asr/funasr'
IMPORTS = {'funasr': 'funasr', 'torch': 'torch', 'torchaudio': 'torchaudio', 'av': 'av', 'modelscope': 'modelscope'}


def digest(path):
    hasher = hashlib.sha256()
    with path.open('rb') as file:
        for block in iter(lambda: file.read(1024 * 1024), b''): hasher.update(block)
    return hasher.hexdigest()


def execute(args, timeout=600):
    return subprocess.run([str(x) for x in args], text=True, capture_output=True, timeout=timeout,
                          env={**os.environ, 'MODELSCOPE_OFFLINE': '1', 'HF_HUB_OFFLINE': '1'})


def pinned(recipe):
    return (recipe.get('status') == 'pinned' and bool(recipe.get('packages')) and
            all(isinstance(v, str) and v for v in recipe['packages'].values()) and
            all(isinstance(m.get('revision'), str) and m['revision'] not in ('master', 'main', 'latest')
                and m.get('sha256') for m in recipe['models']))


def inspect(python, model_root, recipe):
    checks = {'python': {'status': 'missing'}, 'imports': {'status': 'missing'},
              'models': {'status': 'missing', 'items': []},
              'sample': {'status': 'not_run', 'transcription_verified': False}}
    actual = {}
    if python and pathlib.Path(python).expanduser().is_file():
        try:
            probe = execute([python, '-c', '''import contextlib, importlib, importlib.metadata, json, sys
names=json.loads(sys.argv[1]);result={"python":sys.version.split()[0],"packages":{},"errors":[]}
for name,module in names.items():
 try:
  with contextlib.redirect_stdout(sys.stderr): importlib.import_module(module)
 except Exception as error: result["errors"].append({"package":name,"error":type(error).__name__})
for name in json.loads(sys.argv[2]):
 try: result["packages"][name]=importlib.metadata.version(name)
 except Exception: pass
print(json.dumps(result))''', json.dumps(IMPORTS), json.dumps(list(recipe['packages']))], timeout=180)
            actual = json.loads(probe.stdout) if probe.returncode == 0 else {}
            checks['python'] = {'status': 'ready' if actual else 'failed', 'version': actual.get('python')}
            checks['imports'] = {'status': 'ready' if actual and not actual.get('errors') else 'failed', 'packages': actual.get('packages', {}), 'errors': actual.get('errors', [])}
        except (OSError, ValueError, subprocess.TimeoutExpired) as error:
            checks['imports'] = {'status': 'failed', 'error': type(error).__name__}
    for model in recipe['models']:
        directory = model_root / model['id'].split('/', 1)[1]
        missing = [name for name in model['required_files'] if not (directory / name).is_file()]
        mismatched = []
        if not missing:
            for name, expected in model.get('sha256', {}).items():
                file = directory / name
                if not file.is_file() or digest(file) != expected: mismatched.append(name)
        checks['models']['items'].append({'id': model['id'], 'status': 'ready' if not missing and not mismatched else 'missing_or_mismatched', 'missing': missing, 'hash_mismatches': mismatched, 'revision': model.get('revision')})
    checks['models']['status'] = 'ready' if all(x['status'] == 'ready' for x in checks['models']['items']) else 'missing_or_mismatched'
    ready = checks['imports']['status'] == 'ready' and checks['models']['status'] == 'ready'
    # 共享环境是否可复用由核心导入和模型完整性决定；发行锁的辅助依赖另作版本比较。
    differences = [{'package': name, 'expected': version, 'actual': actual.get('packages', {}).get(name)}
                   for name, version in recipe['packages'].items() if actual.get('packages', {}).get(name) != version]
    versions_match = bool(actual) and not differences
    return {'status': 'ready' if ready else 'missing', 'ready': ready, 'checks': checks,
            'python': str(python) if python else None, 'model_root': str(model_root),
            'recipe_fixed': pinned(recipe), 'versions_match_recipe': versions_match, 'recipe_differences': differences,
            'transcription_verified': False, 'limitations': ['仅检测包导入与模型文件；需另以真实样本完成转写验收']}


def receipt(root, data):
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    target = root / ('install-receipt-' + datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ') + '.json')
    target.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')
    target.chmod(0o600)
    return str(target)


class ModelRedirects(urllib.request.HTTPRedirectHandler):
    max_redirections = 5
    max_repeats = 2

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        parsed = urllib.parse.urlparse(newurl)
        host = parsed.hostname or ''
        allowed = any(host == suffix or host.endswith('.' + suffix) for suffix in ('modelscope.cn', 'modelscope.ai', 'aliyuncs.com'))
        if parsed.scheme != 'https' or parsed.username or parsed.password or not allowed:
            raise RuntimeError('ASR_DOWNLOAD_REDIRECT_REJECTED')
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def download_models(root, recipe, opener=None):
    opener = opener or urllib.request.build_opener(ModelRedirects())
    for model in recipe['models']:
        for name, expected in model['sha256'].items():
            directory = root / model['id'].split('/', 1)[1]
            target = directory / name
            if not target.resolve().is_relative_to(root.resolve()): raise RuntimeError('ASR_DOWNLOAD_PATH_REJECTED')
            if target.is_file() and digest(target) == expected: continue
            target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            part = target.with_name(target.name + '.' + uuid.uuid4().hex + '.part')
            url = 'https://modelscope.cn/api/v1/models/' + model['id'] + '/repo?' + urllib.parse.urlencode({'Revision': model['revision'], 'FilePath': name})
            expected_size = model['files'][name]['bytes']
            try:
                hasher = hashlib.sha256(); size = 0
                request = urllib.request.Request(url, headers={'User-Agent': 'Source2Brain-ASR/0.2', 'Accept-Encoding': 'identity'})
                with opener.open(request, timeout=120) as response, part.open('xb') as file:
                    while True:
                        chunk = response.read(1024 * 1024)
                        if not chunk: break
                        size += len(chunk)
                        if size > expected_size: raise RuntimeError('ASR_DOWNLOAD_SIZE_MISMATCH')
                        hasher.update(chunk); file.write(chunk)
                if size != expected_size or hasher.hexdigest() != expected: raise RuntimeError('ASR_DOWNLOAD_HASH_MISMATCH')
                part.chmod(0o600)
                if target.exists(): target.rename(target.with_name(target.name + '.invalid-' + uuid.uuid4().hex[:8]))
                part.replace(target)
            finally:
                part.unlink(missing_ok=True)


def install(args, recipe):
    root = args.root.expanduser().resolve()
    if args.reuse_python:
        result = inspect(args.reuse_python.expanduser(), args.model_root.expanduser(), recipe)
        if not result['ready']: raise RuntimeError('ASR_REUSE_NOT_READY')
        result['status'] = 'reused'
        result['receipt'] = receipt(root, {**result, 'mutated_shared_environment': False})
        return result
    if not pinned(recipe): raise RuntimeError('ASR_RECIPE_UNPINNED')
    requirements = RECIPE.parent / recipe['requirements_file']
    if digest(requirements) != recipe['requirements_sha256']: raise RuntimeError('ASR_REQUIREMENTS_HASH_MISMATCH')
    build_requirements = RECIPE.parent / recipe['build_requirements_file']
    if digest(build_requirements) != recipe['build_requirements_sha256']: raise RuntimeError('ASR_BUILD_LOCK_HASH_MISMATCH')
    if sys.platform != recipe['platform'] or platform.machine() != recipe['machine']:
        raise RuntimeError('ASR_PLATFORM_NOT_VERIFIED')
    if '.'.join(platform.python_version_tuple()[:2]) != recipe['python_minor']:
        raise RuntimeError('ASR_PYTHON_MINOR_MISMATCH')
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    lock = root / '.install-lock'
    lock.mkdir(mode=0o700)
    try:
        key = digest(RECIPE)[:16]
        environment = root / 'envs' / key
        python = environment / 'bin/python'
        models = root / 'models' / 'iic'
        result = inspect(python, models, recipe)
        if result['ready'] and result['versions_match_recipe']:
            result['status'] = 'reused'
            result['receipt'] = receipt(root, result)
            return result
        # 虚拟环境直接建立在版本目录，避免搬迁后 shebang 仍引用暂存路径。
        if not python.is_file():
            created = execute([sys.executable, '-m', 'venv', environment])
            if created.returncode: raise RuntimeError('ASR_VENV_FAILED')
        pip_report = root / f'pip-report-{key}.json'
        process = execute([python, '-m', 'pip', 'install', '--disable-pip-version-check', '--require-hashes', '--no-deps', '-r', build_requirements], timeout=900)
        if process.returncode: raise RuntimeError('ASR_BUILD_TOOLS_FAILED')
        process = execute([python, '-m', 'pip', 'install', '--disable-pip-version-check', '--require-hashes', '--no-build-isolation', '--report', pip_report, '-r', requirements], timeout=1800)
        if process.returncode: raise RuntimeError('ASR_PACKAGES_FAILED')
        process = execute([python, '-m', 'pip', 'check'])
        if process.returncode: raise RuntimeError('ASR_PACKAGE_CONFLICT')
        # 固定版本的 SDK 只接受分支/tag；官方文件 API 可按 commit 获取。
        # 不退回 master；每个文件下载到 .part，SHA256/大小通过后再原子发布。
        download_models(models, recipe)
        result = inspect(python, models, recipe)
        if not result['ready'] or not result['versions_match_recipe']: raise RuntimeError('ASR_INSTALL_VERIFY_FAILED')
        result.update(status='installed', recipe_sha256=digest(RECIPE), pip_report=str(pip_report))
        result['receipt'] = receipt(root, result)
        return result
    finally:
        lock.rmdir()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--check', action='store_true')
    mode.add_argument('--install', action='store_true')
    parser.add_argument('--root', type=pathlib.Path, default=DEFAULT_ROOT)
    parser.add_argument('--reuse-python', type=pathlib.Path)
    parser.add_argument('--model-root', type=pathlib.Path, default=pathlib.Path(os.environ.get('SOURCE2BRAIN_ASR_MODEL_ROOT', str(pathlib.Path.home()/'.cache/modelscope/hub/models/iic'))))
    args = parser.parse_args()
    recipe = json.loads(RECIPE.read_text())
    python = args.reuse_python or os.environ.get('SOURCE2BRAIN_ASR_PYTHON')
    if not python:
        candidate = args.root.expanduser() / 'envs' / digest(RECIPE)[:16] / 'bin/python'
        if candidate.is_file():
            python = candidate
            if 'SOURCE2BRAIN_ASR_MODEL_ROOT' not in os.environ and '--model-root' not in sys.argv:
                args.model_root = args.root.expanduser() / 'models/iic'
    try:
        result = install(args, recipe) if args.install else inspect(python, args.model_root.expanduser(), recipe)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0 if result['ready'] else 1
    except Exception as error:
        code = str(error) if isinstance(error, RuntimeError) else type(error).__name__
        result = {'status': 'failed', 'ready': False, 'code': code, 'checks': {}, 'transcription_verified': False,
                  'message': '安装未完成；共享 Python、模型和原配置均未改动。检查固定配方、Python 版本及网络后重试。'}
        if args.install: result['receipt'] = receipt(args.root.expanduser(), result)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 1


if __name__ == '__main__': sys.exit(main())
