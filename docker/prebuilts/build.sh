#!/usr/bin/env bash
set -euo pipefail

# 一键构建（并可选推送）neo-blog 前后端预制品基础镜像
# 用法：
#   ./docker/prebuilts/build.sh
#   ./docker/prebuilts/build.sh --push
#   REGISTRY=reg.liteyuki.org/snowykami ./docker/prebuilts/build.sh --push

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${ROOT_DIR}"

REGISTRY="${REGISTRY:-reg.liteyuki.org/snowykami}"
GO_VERSION="${GO_VERSION:-1.26.10}"
ALPINE_VERSION="${ALPINE_VERSION:-3.24}"
FFMPEG_VERSION="${FFMPEG_VERSION:-7.1.1}"
BUN_VERSION="${BUN_VERSION:-1.4.4}"
PNPM_VERSION="${PNPM_VERSION:-10.23.0}"
NPM_REGISTRY="${NPM_REGISTRY:-https://registry.npmmirror.com}"
PUSH=false

for arg in "$@"; do
  case "${arg}" in
    --push) PUSH=true ;;
    *)
      echo "未知参数: ${arg}" >&2
      echo "用法: $0 [--push]" >&2
      exit 1
      ;;
  esac
done

GO_BUILDER_TAG="${REGISTRY}/neo-blog-go-builder:${GO_VERSION}-alpine${ALPINE_VERSION}"
BACKEND_RUNTIME_TAG="${REGISTRY}/neo-blog-runtime:alpine${ALPINE_VERSION}-ffmpeg${FFMPEG_VERSION}"
WEB_BUILDER_TAG="${REGISTRY}/neo-blog-web-builder:bun${BUN_VERSION}-pnpm${PNPM_VERSION}"
WEB_RUNNER_TAG="${REGISTRY}/neo-blog-web-runner:bun${BUN_VERSION}-alpine"

build_and_maybe_push() {
  local tag="$1"
  shift
  echo "==> Building ${tag}"
  docker build -t "${tag}" "$@"
  if [ "${PUSH}" = true ]; then
    echo "==> Pushing ${tag}"
    docker push "${tag}"
  fi
}

build_and_maybe_push "${GO_BUILDER_TAG}" \
  --build-arg "GO_IMAGE=golang:${GO_VERSION}-alpine${ALPINE_VERSION}" \
  -f docker/prebuilts/backend-builder/Dockerfile \
  docker/prebuilts/backend-builder

build_and_maybe_push "${BACKEND_RUNTIME_TAG}" \
  --build-arg "ALPINE_IMAGE=alpine:${ALPINE_VERSION}" \
  --build-arg "FFMPEG_VERSION=${FFMPEG_VERSION}" \
  -f docker/prebuilts/backend-runtime/Dockerfile \
  docker/prebuilts/backend-runtime

build_and_maybe_push "${WEB_BUILDER_TAG}" \
  --build-arg "BUN_IMAGE=oven/bun:${BUN_VERSION}-alpine" \
  --build-arg "PNPM_VERSION=${PNPM_VERSION}" \
  --build-arg "NPM_REGISTRY=${NPM_REGISTRY}" \
  -f docker/prebuilts/web-builder/Dockerfile \
  ./web

build_and_maybe_push "${WEB_RUNNER_TAG}" \
  --build-arg "BUN_IMAGE=oven/bun:${BUN_VERSION}-alpine" \
  -f docker/prebuilts/web-runner/Dockerfile \
  docker/prebuilts/web-runner

echo "全部完成。"
