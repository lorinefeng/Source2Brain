#!/bin/bash
# 默认仅检测；--install 才安装独立运行时和 Skill，不登录、不启动微信服务。
set -euo pipefail
SOURCE2BRAIN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="$HOME/.local/bin:/usr/local/bin:/opt/homebrew/bin:$PATH"
source "$SOURCE2BRAIN_ROOT/scripts/runtime-env.sh"
SOURCE2BRAIN_ACTION="${1:---check}"
case "$SOURCE2BRAIN_ACTION" in --check|--install) ;; *) echo '用法：bootstrap-macos.sh [--check|--install]'; exit 2;; esac
[[ "$(uname -s)" == Darwin ]] || { echo '此固定配方仅支持 macOS；其他系统使用已有宿主。' >&2; exit 1; }
case "$SOURCE2BRAIN_ARCH" in arm64|x64) ;; *) echo '不支持的架构。' >&2; exit 1;; esac
source2brain_select_runtime
if [[ "$SOURCE2BRAIN_ACTION" == --check ]]; then
  printf 'profile=%s\nworkspace=%s\nnode=%s\nopenclaw=%s\n' "$SOURCE2BRAIN_PROFILE" "$SOURCE2BRAIN_WORKSPACE" "${SOURCE2BRAIN_SELECTED_NODE:-missing}" "${SOURCE2BRAIN_SELECTED_OPENCLAW:-missing}"
  [[ -n "$SOURCE2BRAIN_SELECTED_NODE" && -n "$SOURCE2BRAIN_SELECTED_OPENCLAW" ]]
  exit
fi
SOURCE2BRAIN_DOWNLOAD=''
SOURCE2BRAIN_SKILL=''
cleanup() {
  [[ -z "$SOURCE2BRAIN_DOWNLOAD" ]] || rm -rf "$SOURCE2BRAIN_DOWNLOAD"
  [[ -z "$SOURCE2BRAIN_SKILL" ]] || rm -rf "$(dirname "$SOURCE2BRAIN_SKILL")"
}
trap cleanup EXIT
mkdir -p "$SOURCE2BRAIN_RUNTIME"
if [[ -z "$SOURCE2BRAIN_SELECTED_NODE" ]]; then
  SOURCE2BRAIN_DOWNLOAD="$(mktemp -d)"
  curl --fail --location --retry 2 --max-time 240 "https://nodejs.org/dist/v${SOURCE2BRAIN_NODE_VERSION}/${SOURCE2BRAIN_NODE_NAME}.tar.xz" -o "$SOURCE2BRAIN_DOWNLOAD/$SOURCE2BRAIN_NODE_NAME.tar.xz"
  curl --fail --location --retry 2 --max-time 60 "https://nodejs.org/dist/v${SOURCE2BRAIN_NODE_VERSION}/SHASUMS256.txt" -o "$SOURCE2BRAIN_DOWNLOAD/SHASUMS256.txt"
  (cd "$SOURCE2BRAIN_DOWNLOAD" && awk -v name="$SOURCE2BRAIN_NODE_NAME.tar.xz" '$2 == name { print }' SHASUMS256.txt > CHECKSUM && test -s CHECKSUM && shasum -a 256 -c CHECKSUM)
  tar -xJf "$SOURCE2BRAIN_DOWNLOAD/$SOURCE2BRAIN_NODE_NAME.tar.xz" -C "$SOURCE2BRAIN_RUNTIME"
  SOURCE2BRAIN_SELECTED_NODE="$SOURCE2BRAIN_RUNTIME/$SOURCE2BRAIN_NODE_NAME/bin/node"
  export PATH="$(dirname "$SOURCE2BRAIN_SELECTED_NODE"):$PATH"
fi
if [[ -z "$SOURCE2BRAIN_SELECTED_OPENCLAW" ]]; then
  npm install --prefix "$SOURCE2BRAIN_RUNTIME/openclaw" "openclaw@$SOURCE2BRAIN_OPENCLAW_VERSION" --no-audit --no-fund
  SOURCE2BRAIN_SELECTED_OPENCLAW="$SOURCE2BRAIN_RUNTIME/openclaw/node_modules/.bin/openclaw"
fi
SOURCE2BRAIN_STATE="$HOME/.openclaw-$SOURCE2BRAIN_PROFILE"
SOURCE2BRAIN_BACKUP="$SOURCE2BRAIN_STATE/backups/install-$(date +%Y%m%d-%H%M%S)-$$"
mkdir -p "$SOURCE2BRAIN_BACKUP"
chmod 700 "$SOURCE2BRAIN_STATE" "$SOURCE2BRAIN_BACKUP"
for SOURCE2BRAIN_FILE in openclaw.json .env; do
  [[ ! -f "$SOURCE2BRAIN_STATE/$SOURCE2BRAIN_FILE" ]] || cp -p "$SOURCE2BRAIN_STATE/$SOURCE2BRAIN_FILE" "$SOURCE2BRAIN_BACKUP/"
done
if [[ ! -f "$SOURCE2BRAIN_STATE/openclaw.json" ]]; then
  "$SOURCE2BRAIN_SELECTED_OPENCLAW" --profile "$SOURCE2BRAIN_PROFILE" setup --baseline --workspace "$SOURCE2BRAIN_WORKSPACE"
fi
SOURCE2BRAIN_SKILL="$("$SOURCE2BRAIN_SELECTED_NODE" "$SOURCE2BRAIN_ROOT/scripts/package-skill.mjs")"
SOURCE2BRAIN_INSTALLED="$SOURCE2BRAIN_WORKSPACE/skills/source2brain"
if [[ -d "$SOURCE2BRAIN_INSTALLED" ]]; then
  cp -Rp "$SOURCE2BRAIN_INSTALLED" "$SOURCE2BRAIN_BACKUP/skill"
fi
# 目标 workspace 一旦已有配置，以配置器/宿主解析结果为准；先确认，防止装到别的目录。
SOURCE2BRAIN_ACTUAL_WORKSPACE="$("$SOURCE2BRAIN_SELECTED_OPENCLAW" --profile "$SOURCE2BRAIN_PROFILE" config get agents.defaults.workspace 2>/dev/null)"
SOURCE2BRAIN_ACTUAL_WORKSPACE="${SOURCE2BRAIN_ACTUAL_WORKSPACE#\"}"
SOURCE2BRAIN_ACTUAL_WORKSPACE="${SOURCE2BRAIN_ACTUAL_WORKSPACE%\"}"
if [[ "$SOURCE2BRAIN_ACTUAL_WORKSPACE" != "$SOURCE2BRAIN_WORKSPACE" ]]; then
  echo '已有 profile 的 workspace 与目标不一致；设置 SOURCE2BRAIN_WORKSPACE 为实际目录后重试，未改原配置。' >&2
  exit 1
fi
if ! "$SOURCE2BRAIN_SELECTED_OPENCLAW" --profile "$SOURCE2BRAIN_PROFILE" skills install "$SOURCE2BRAIN_SKILL" --as source2brain --force; then
  # 失败候选移出加载目录；首次失败也不能留下半个 Skill。
  [[ ! -e "$SOURCE2BRAIN_INSTALLED" ]] || mv "$SOURCE2BRAIN_INSTALLED" "$SOURCE2BRAIN_BACKUP/failed-skill"
  if [[ -d "$SOURCE2BRAIN_BACKUP/skill" ]]; then
    cp -Rp "$SOURCE2BRAIN_BACKUP/skill" "$SOURCE2BRAIN_INSTALLED"
    echo 'Skill 安装失败；已有 Skill 已从备份恢复。' >&2
  else
    echo '首次 Skill 安装失败；失败候选保留在备份目录，未启用。' >&2
  fi
  exit 1
fi
"$SOURCE2BRAIN_SELECTED_NODE" --input-type=module - "$SOURCE2BRAIN_BACKUP/install-receipt.json" "$SOURCE2BRAIN_PROFILE" "$SOURCE2BRAIN_WORKSPACE" "$SOURCE2BRAIN_SELECTED_NODE" "$SOURCE2BRAIN_SELECTED_OPENCLAW" <<'JS'
import fs from 'node:fs'; import {execFileSync} from 'node:child_process';
const [file,profile,workspace,node,openclaw]=process.argv.slice(2);
fs.writeFileSync(file,JSON.stringify({schema_version:1,status:'skill_installed',installed_at:new Date().toISOString(),profile,workspace,node:{path:node,version:process.versions.node},openclaw:{path:openclaw,version:execFileSync(openclaw,['--version'],{encoding:'utf8'}).trim()},boundaries:{model_configured:false,wechat_bound:false,media_installed:false,asr_installed:false}},null,2)+'\n',{mode:0o600});
JS
printf '已安装 Skill，profile=%s；备份=%s\n下一步：docs/installation.md。平台登录与微信扫码仍需本人完成。\n' "$SOURCE2BRAIN_PROFILE" "$SOURCE2BRAIN_BACKUP"
