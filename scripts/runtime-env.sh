#!/bin/bash
# 仅解析 runtime/profile，不创建文件或安装依赖。由引导脚本和 wrapper 共用。
SOURCE2BRAIN_NODE_VERSION=26.8.2
SOURCE2BRAIN_OPENCLAW_VERSION=2026.9.6
SOURCE2BRAIN_RUNTIME="${SOURCE2BRAIN_RUNTIME:-$HOME/.local/share/source2brain/runtime}"
SOURCE2BRAIN_PROFILE="${SOURCE2BRAIN_PROFILE:-source2brain}"
[[ "$SOURCE2BRAIN_PROFILE" =~ ^[a-zA-Z0-9][a-zA-Z0-9-]*$ ]] || { echo 'profile 只允许字母、数字、连字符。' >&2; return 1; }
SOURCE2BRAIN_ARCH="$(uname -m)"
[[ "$SOURCE2BRAIN_ARCH" == x86_64 ]] && SOURCE2BRAIN_ARCH=x64
SOURCE2BRAIN_NODE_NAME="node-v${SOURCE2BRAIN_NODE_VERSION}-darwin-${SOURCE2BRAIN_ARCH}"
SOURCE2BRAIN_WORKSPACE="${SOURCE2BRAIN_WORKSPACE:-$HOME/.local/share/source2brain/workspace}"
if [[ "$SOURCE2BRAIN_PROFILE" != source2brain && "$SOURCE2BRAIN_WORKSPACE" == "$HOME/.local/share/source2brain/workspace" ]]; then
  SOURCE2BRAIN_WORKSPACE="$HOME/.local/share/source2brain/workspaces/$SOURCE2BRAIN_PROFILE"
fi
source2brain_node_ok() { [[ -x "$1" ]] && "$1" -e 'process.exit(Number(process.versions.node.split(".")[0])>=24?0:1)' >/dev/null 2>&1; }
source2brain_select_runtime() {
  SOURCE2BRAIN_SELECTED_NODE=''
  SOURCE2BRAIN_SELECTED_OPENCLAW=''
  local candidate
  if [[ -n "${SOURCE2BRAIN_NODE_BIN:-}" ]]; then
    source2brain_node_ok "$SOURCE2BRAIN_NODE_BIN" || { echo '指定 Node 不可用；需要 Node 24+。' >&2; return 1; }
    SOURCE2BRAIN_SELECTED_NODE="$SOURCE2BRAIN_NODE_BIN"
  else
    for candidate in "$(command -v node || true)" "$SOURCE2BRAIN_RUNTIME/$SOURCE2BRAIN_NODE_NAME/bin/node"; do
      if [[ -n "$candidate" ]] && source2brain_node_ok "$candidate"; then SOURCE2BRAIN_SELECTED_NODE="$candidate"; break; fi
    done
  fi
  [[ -z "$SOURCE2BRAIN_SELECTED_NODE" ]] || export PATH="$(dirname "$SOURCE2BRAIN_SELECTED_NODE"):$PATH"
  if [[ -n "${SOURCE2BRAIN_OPENCLAW_BIN:-}" ]]; then
    [[ -x "$SOURCE2BRAIN_OPENCLAW_BIN" ]] || { echo '指定 OpenClaw 路径不可执行。' >&2; return 1; }
    SOURCE2BRAIN_SELECTED_OPENCLAW="$SOURCE2BRAIN_OPENCLAW_BIN"
  else
    for candidate in "$(command -v openclaw || true)" "$SOURCE2BRAIN_RUNTIME/openclaw/node_modules/.bin/openclaw"; do
      if [[ -n "$candidate" && -x "$candidate" && -n "$SOURCE2BRAIN_SELECTED_NODE" ]] && [[ "$("$candidate" --version 2>/dev/null)" == *"$SOURCE2BRAIN_OPENCLAW_VERSION"* ]]; then SOURCE2BRAIN_SELECTED_OPENCLAW="$candidate"; break; fi
    done
  fi
}
