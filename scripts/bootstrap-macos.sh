#!/bin/bash
# 第一阶段运行时引导。平台账号登录及模型服务选择仍由用户完成。
set -euo pipefail

if [[ "$(uname -s)" != Darwin ]]; then
  echo '本脚本目前只验证了 macOS。' >&2
  exit 1
fi
SOURCE2BRAIN_NODE_VERSION=26.8.2
SOURCE2BRAIN_OPENCLAW_VERSION=2026.9.6
SOURCE2BRAIN_ARCH="$(uname -m)"
[[ "$SOURCE2BRAIN_ARCH" == x86_64 ]] && SOURCE2BRAIN_ARCH=x64
case "$SOURCE2BRAIN_ARCH" in arm64|x64) ;; *) echo '不支持的架构' >&2; exit 1;; esac
SOURCE2BRAIN_RUNTIME="${SOURCE2BRAIN_RUNTIME:-$HOME/.local/share/source2brain/runtime}"
SOURCE2BRAIN_NODE_NAME="node-v${SOURCE2BRAIN_NODE_VERSION}-darwin-${SOURCE2BRAIN_ARCH}"
mkdir -p "$SOURCE2BRAIN_RUNTIME"
if [[ ! -x "$SOURCE2BRAIN_RUNTIME/$SOURCE2BRAIN_NODE_NAME/bin/node" ]]; then
  SOURCE2BRAIN_DOWNLOAD="$(mktemp -d)"
  trap 'rm -rf "$SOURCE2BRAIN_DOWNLOAD"' EXIT
  curl --fail --location --retry 2 --max-time 240 "https://nodejs.org/dist/v${SOURCE2BRAIN_NODE_VERSION}/${SOURCE2BRAIN_NODE_NAME}.tar.xz" -o "$SOURCE2BRAIN_DOWNLOAD/$SOURCE2BRAIN_NODE_NAME.tar.xz"
  curl --fail --location --retry 2 --max-time 60 "https://nodejs.org/dist/v${SOURCE2BRAIN_NODE_VERSION}/SHASUMS256.txt" -o "$SOURCE2BRAIN_DOWNLOAD/SHASUMS256.txt"
  (cd "$SOURCE2BRAIN_DOWNLOAD" && awk -v name="$SOURCE2BRAIN_NODE_NAME.tar.xz" '$2 == name { print }' SHASUMS256.txt > CHECKSUM && test -s CHECKSUM && shasum -a 256 -c CHECKSUM)
  tar -xJf "$SOURCE2BRAIN_DOWNLOAD/$SOURCE2BRAIN_NODE_NAME.tar.xz" -C "$SOURCE2BRAIN_RUNTIME"
fi
export PATH="$SOURCE2BRAIN_RUNTIME/$SOURCE2BRAIN_NODE_NAME/bin:$SOURCE2BRAIN_RUNTIME/openclaw/node_modules/.bin:$HOME/.local/bin:/usr/local/bin:$PATH"
if [[ ! -f "$SOURCE2BRAIN_RUNTIME/openclaw/node_modules/openclaw/package.json" ]] || [[ "$(node -p "JSON.parse(require('fs').readFileSync(process.argv[1])).version" "$SOURCE2BRAIN_RUNTIME/openclaw/node_modules/openclaw/package.json")" != "$SOURCE2BRAIN_OPENCLAW_VERSION" ]]; then
  npm install --prefix "$SOURCE2BRAIN_RUNTIME/openclaw" "openclaw@$SOURCE2BRAIN_OPENCLAW_VERSION" --no-audit --no-fund
fi
openclaw --profile source2brain setup --baseline --workspace "$HOME/.local/share/source2brain/workspace"
SOURCE2BRAIN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SOURCE2BRAIN_SKILL="$(node "$SOURCE2BRAIN_ROOT/scripts/package-skill.mjs")"
SOURCE2BRAIN_INSTALLED="$HOME/.local/share/source2brain/workspace/skills/source2brain"
if [[ -d "$SOURCE2BRAIN_INSTALLED" ]]; then
  SOURCE2BRAIN_BACKUP="$HOME/.openclaw-source2brain/backups/skill-$(date +%Y%m%d-%H%M%S)-$$"
  mkdir -p "$SOURCE2BRAIN_BACKUP"
  cp -R "$SOURCE2BRAIN_INSTALLED" "$SOURCE2BRAIN_BACKUP/"
  openclaw --profile source2brain skills install "$SOURCE2BRAIN_SKILL" --as source2brain --force
else
  openclaw --profile source2brain skills install "$SOURCE2BRAIN_SKILL" --as source2brain
fi
echo '运行时和 Skill 已就绪。下一步见 docs/installation.md：配置模型、浏览器和微信。'
