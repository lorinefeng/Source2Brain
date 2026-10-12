#!/usr/bin/env python3
"""在运行主机配置独立 profile；密钥不出现在参数或 stdout。"""
import argparse
import datetime
import json
import os
import pathlib
import secrets
import shutil
import subprocess
import sys
import tempfile


def main():
    parser = argparse.ArgumentParser(description="配置 Source2Brain 的 OpenClaw profile")
    parser.add_argument("--from-hermes", type=pathlib.Path, help="明确指定要导入的 Hermes config.yaml")
    parser.add_argument("--provider", required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--base-url")
    parser.add_argument("--key-env", default="SOURCE2BRAIN_API_KEY")
    parser.add_argument("--store", type=pathlib.Path, default=pathlib.Path.home() / "SecondBrain")
    parser.add_argument("--profile", default=os.environ.get("SOURCE2BRAIN_PROFILE", "source2brain"))
    parser.add_argument("--openclaw-bin", type=pathlib.Path, help="明确指定现有 OpenClaw 可执行文件；默认使用本包 wrapper")
    parser.add_argument("--workspace", type=pathlib.Path, default=None)
    parser.add_argument("--port", type=int, default=19291)
    args = parser.parse_args()
    if not args.profile.replace("-", "").isalnum():
        raise ValueError("profile 只能包含字母、数字和连字符")
    base_url, api_key = args.base_url, os.environ.get(args.key_env)
    if args.from_hermes:
        import yaml
        cfg = yaml.safe_load(args.from_hermes.expanduser().read_text())
        providers = cfg.get("custom_providers", [])
        if not isinstance(providers, list):
            raise ValueError("当前导入器仅支持 Hermes custom_providers 数组格式")
        provider = next(p for p in providers if p.get("name") == args.provider)
        base_url, api_key = provider["base_url"], provider["api_key"]
    if not base_url or not api_key or any(c in api_key for c in "\r\n"):
        raise ValueError("缺少可用的 API 地址或密钥")
    root = pathlib.Path.home() / f".openclaw-{args.profile}"
    root.mkdir(mode=0o700, exist_ok=True)
    config_path, env_path = root / "openclaw.json", root / ".env"
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    backup = root / "backups" / stamp
    backup.mkdir(parents=True, mode=0o700)
    for file in (config_path, env_path):
        if file.exists():
            shutil.copy2(file, backup / file.name)
            (backup / file.name).chmod(0o600)
    config = json.loads(config_path.read_text()) if config_path.exists() else {}
    default_workspace = pathlib.Path.home() / ".local/share/source2brain" / ("workspace" if args.profile == "source2brain" else f"workspaces/{args.profile}")
    workspace = (args.workspace or pathlib.Path(os.environ.get("SOURCE2BRAIN_WORKSPACE", default_workspace))).expanduser().resolve()
    store = args.store.expanduser().resolve()
    (store / "Sources").mkdir(parents=True, mode=0o700, exist_ok=True)
    workspace.mkdir(parents=True, mode=0o700, exist_ok=True)
    config.setdefault("models", {}).setdefault("providers", {})[args.provider] = {
        "baseUrl": base_url, "apiKey": "${SOURCE2BRAIN_API_KEY}", "api": "openai-completions",
        "models": [{"id": args.model, "name": args.model, "input": ["text"], "contextWindow": 128000, "maxTokens": 8192}]
    }
    defaults = config.setdefault("agents", {}).setdefault("defaults", {})
    defaults["workspace"] = str(workspace)
    defaults["model"] = {"primary": f"{args.provider}/{args.model}"}
    memory = config.setdefault("memory", {}).setdefault("search", {})
    memory.setdefault("provider", "none")
    paths = memory.get("extraPaths", [])
    sources = str(store / "Sources")
    if not any(p == sources or (isinstance(p, dict) and p.get("path") == sources) for p in paths):
        paths = [*paths, sources]
    memory["extraPaths"] = paths
    memory["sources"] = ["memory"]
    memory["rememberAcrossConversations"] = False
    config.setdefault("session", {})["dmScope"] = "per-account-channel-peer"
    config["gateway"] = {**config.get("gateway", {}), "mode": "local", "bind": "loopback", "port": args.port}
    config["gateway"].setdefault("auth", {"mode": "token", "token": secrets.token_urlsafe(32)})
    config.setdefault("tools", {})["profile"] = "coding"
    lines = env_path.read_text().splitlines() if env_path.exists() else []
    lines = [line for line in lines if not line.startswith(("SOURCE2BRAIN_API_KEY=", "SOURCE2BRAIN_STORE="))]
    lines.extend([f"SOURCE2BRAIN_API_KEY={api_key}", f"SOURCE2BRAIN_STORE={store}"])
    # 使用官方 config patch 校验并写入；stdout 不含配置内容。
    patch = {
        "models": {"providers": {args.provider: config["models"]["providers"][args.provider]}},
        "agents": {"defaults": {"workspace": str(workspace), "model": defaults["model"]}},
        "memory": {"search": memory}, "session": {"dmScope": "per-account-channel-peer"},
        "gateway": config["gateway"], "tools": {"profile": "coding"}
    }
    command = ([str(args.openclaw_bin.expanduser()), "--profile", args.profile] if args.openclaw_bin else
               ["bash", str(pathlib.Path(__file__).resolve().with_name("openclaw.sh"))])
    child_env = {**os.environ, "SOURCE2BRAIN_PROFILE": args.profile}
    def restore_configuration():
        for current in (env_path, config_path):
            if (backup / current.name).exists():
                shutil.copy2(backup / current.name, current)
                current.chmod(0o600)
            else:
                current.unlink(missing_ok=True)

    temporary = None
    try:
        # 同目录暂存并原子替换，避免写入中断留下截断的 .env。
        with tempfile.NamedTemporaryFile(mode="w", dir=root, prefix=".env-", delete=False) as file:
            temporary = pathlib.Path(file.name)
            file.write("\n".join(lines) + "\n")
        temporary.chmod(0o600)
        temporary.replace(env_path)
        temporary = None
        result = subprocess.run([*command, "config", "patch", "--stdin"], input=json.dumps(patch), text=True,
                                capture_output=True, env=child_env, timeout=120)
        if result.returncode:
            diagnostic = result.stderr.replace(api_key, '[REDACTED]')
            gateway_token = config.get('gateway', {}).get('auth', {}).get('token', '')
            if gateway_token:
                diagnostic = diagnostic.replace(gateway_token, '[REDACTED]')
            print(diagnostic[-2500:], file=sys.stderr)
            raise RuntimeError("OpenClaw 配置校验失败")
        config_path.chmod(0o600)
    except BaseException:
        restore_configuration()
        raise
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
    print(json.dumps({"status": "configured", "profile": args.profile, "model": f"{args.provider}/{args.model}", "store": str(store), "backup": str(backup)}, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        # 配置解析库或远程响应可能把敏感输入写进异常，只打印错误类型。
        print(json.dumps({"ok": False, "error": type(exc).__name__, "message": "配置未完成；检查参数和运行端依赖。"}, ensure_ascii=False), file=sys.stderr)
        sys.exit(1)
