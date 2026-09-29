#!/bin/bash
set -euo pipefail
SOURCE2BRAIN_RUNTIME="${SOURCE2BRAIN_RUNTIME:-$HOME/.local/share/source2brain/runtime}"
SOURCE2BRAIN_ARCH="$(uname -m)"
[[ "$SOURCE2BRAIN_ARCH" == x86_64 ]] && SOURCE2BRAIN_ARCH=x64
export PATH="$SOURCE2BRAIN_RUNTIME/node-v26.8.2-darwin-$SOURCE2BRAIN_ARCH/bin:$SOURCE2BRAIN_RUNTIME/openclaw/node_modules/.bin:$HOME/.local/bin:/usr/local/bin:$PATH"
exec openclaw --profile source2brain "$@"
