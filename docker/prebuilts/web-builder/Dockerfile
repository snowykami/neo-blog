# 前端构建期预制品基础镜像：预装 pnpm 并根据当前 web/pnpm-lock.yaml 预热离线 store
# 构建上下文须为 ./web（例如：docker build -f docker/prebuilts/web-builder/Dockerfile ./web）
ARG BUN_IMAGE=oven/bun:1.4.4-alpine

FROM ${BUN_IMAGE}

WORKDIR /app

ARG PNPM_VERSION=10.23.0
ARG NPM_REGISTRY=https://registry.npmmirror.com

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN if [ -n "${NPM_REGISTRY}" ]; then \
    BUN_CONFIG_REGISTRY="${NPM_REGISTRY%/}" bun add -g pnpm@${PNPM_VERSION}; \
  else \
    bun add -g pnpm@${PNPM_VERSION}; \
  fi

COPY package.json pnpm-lock.yaml ./

RUN if [ -n "${NPM_REGISTRY}" ]; then \
    npm_config_registry="${NPM_REGISTRY%/}" pnpm fetch --frozen-lockfile; \
  else \
    pnpm fetch --frozen-lockfile; \
  fi \
  && rm -f package.json pnpm-lock.yaml
