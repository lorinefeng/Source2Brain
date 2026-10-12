#!/bin/bash
set -euo pipefail
SOURCE2BRAIN_SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
export PATH="$HOME/.local/bin:/usr/local/bin:/opt/homebrew/bin:$PATH"
source "$SOURCE2BRAIN_SCRIPT_DIR/runtime-env.sh"
source2brain_select_runtime
[[ -n "$SOURCE2BRAIN_SELECTED_NODE" && -n "$SOURCE2BRAIN_SELECTED_OPENCLAW" ]] || { echo '未找到可用运行时；先运行 bootstrap-macos.sh --check，再按需 --install。' >&2; exit 1; }
exec "$SOURCE2BRAIN_SELECTED_OPENCLAW" --profile "$SOURCE2BRAIN_PROFILE" "$@"
