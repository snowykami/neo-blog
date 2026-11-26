# 前端运行时预制品基础镜像：固化 bun 环境与非 root 运行用户
# 构建上下文：docker/prebuilts/web-runner
ARG BUN_IMAGE=oven/bun:1.4.4-alpine

FROM ${BUN_IMAGE}

WORKDIR /app

ENV NODE_ENV=production \
  PORT=3000 \
  HOSTNAME="0.0.0.0"

RUN addgroup -S bunjs && adduser -S nextjs -G bunjs
