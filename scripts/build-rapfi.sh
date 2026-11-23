#!/usr/bin/env bash
set -euo pipefail

project_dir=$(cd -- "$(dirname -- "$0")/.." && pwd)
rapfi_revision=823096872da171a83ec889c99e6599427375aafb
build_dir=$(mktemp -d)
trap 'rm -rf -- "$build_dir"' EXIT

# 固定引擎源码及其权重子模块，由同一次构建生成 JS、WASM 和数据文件。
git init -q "$build_dir/rapfi"
git -C "$build_dir/rapfi" fetch -q --depth=1 https://github.com/dotb1ue/rapfi.git "$rapfi_revision"
git -C "$build_dir/rapfi" checkout -q --detach FETCH_HEAD
git -C "$build_dir/rapfi" submodule update --init --depth=1 Networks

# 只打包经典评估文件，减少移动端首次加载的体积。
printf '%s\n%s\n%s' \
  'config-example/gomocalc-classical210901.toml@classical210901.toml' \
  'config-example/gomocalc-classical220723.toml@classical220723.toml' \
  'classical@/' > "$build_dir/rapfi/Networks/wasm_preloads.txt"

emcmake cmake -S "$build_dir/rapfi/Rapfi" -B "$build_dir/wasm" \
  -DCMAKE_BUILD_TYPE=Release -DNO_COMMAND_MODULES=ON \
  -DNO_MULTI_THREADING=ON -DUSE_WASM_SIMD=ON -DUSE_WASM_SIMD_RELAXED=OFF
cmake --build "$build_dir/wasm" --parallel 2

assets="$project_dir/vendor/rapfi"
artifact="$build_dir/wasm/rapfi-single-simd128"
install -m 644 "$artifact.js" "$assets/rapfi-single.js"
install -m 644 "$artifact.wasm" "$assets/rapfi-single.wasm"
install -m 644 "$artifact.data" "$assets/rapfi.data"
