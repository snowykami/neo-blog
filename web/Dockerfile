# -----------------------------------------------------------------------------
# This Dockerfile is specifically configured for projects using Node and pnpm
# For Bun or yarn, refer to the Dockerfile.bun instead
# -----------------------------------------------------------------------------

# 基础镜像（构建与运行两个阶段共用）。默认是 Docker Hub 官方镜像；拉取 docker.io 慢或失败时，可以通过构建参数换成
# 镜像站或私有仓库里的同一镜像，例如 --build-arg NODE_IMAGE=docker.m.daocloud.io/library/node:24-alpine
ARG NODE_IMAGE=node:24-alpine

# Use official Node image and pnpm
FROM ${NODE_IMAGE} AS builder
WORKDIR /app
ARG PNPM_VERSION=10.23.0
# npm 镜像源（可选）。默认留空走官方源 https://registry.npmjs.org；拉取慢或失败时可通过构建参数切换，
# 例如 --build-arg NPM_REGISTRY=https://registry.npmmirror.com（同时作用于 corepack 下载 pnpm 与 pnpm install）
ARG NPM_REGISTRY=""
# 让 Node 24 内置 fetch（corepack 使用）在构建期遵循 Docker 预定义的 HTTP_PROXY / HTTPS_PROXY；未配置代理时无影响
ARG NODE_USE_ENV_PROXY=1

# enable corepack and activate pnpm
RUN corepack enable && \
  if [ -n "${NPM_REGISTRY}" ]; then \
    NODE_USE_ENV_PROXY="${NODE_USE_ENV_PROXY}" COREPACK_NPM_REGISTRY="${NPM_REGISTRY%/}" corepack prepare pnpm@${PNPM_VERSION} --activate; \
  else \
    NODE_USE_ENV_PROXY="${NODE_USE_ENV_PROXY}" corepack prepare pnpm@${PNPM_VERSION} --activate; \
  fi

# copy lock & package then install (dev deps needed for build)
COPY package.json pnpm-lock.yaml ./
RUN if [ -n "${NPM_REGISTRY}" ]; then \
    npm_config_registry="${NPM_REGISTRY%/}" pnpm install --frozen-lockfile; \
  else \
    pnpm install --frozen-lockfile; \
  fi

# copy source and build
COPY . .
# 构建版本（CI 传入 commit），写入前端代码，供已打开的页面检测新版本；未传入时不启用更新提醒
ARG APP_VERSION=""
ENV NEXT_PUBLIC_APP_VERSION=${APP_VERSION}
# 走 Next 图片优化的本站图床 / 对象存储域名，逗号分隔；未传入时只优化站内相对路径，其余外链由浏览器直连
ARG IMAGE_OPTIMIZE_HOSTS=""
ENV NEXT_PUBLIC_IMAGE_OPTIMIZE_HOSTS=${IMAGE_OPTIMIZE_HOSTS}
# 这里用 lint 而不是 lint:fix：格式不合规应当直接失败，避免 CI 静默重排代码导致镜像内容与仓库不一致
RUN pnpm run lint && pnpm run build

# production image
# 运行时只执行 standalone 产物里的 node server.js，依赖已打包进 .next/standalone，不需要 pnpm
FROM ${NODE_IMAGE} AS runner
WORKDIR /app

ENV NODE_ENV=production \
  PORT=3000 \
  HOSTNAME="0.0.0.0"

# create non-root user
RUN addgroup -S nodejs && adduser -S nextjs -G nodejs

# copy public and standalone output from builder
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
# 浏览器代码的 source map（不在公开目录里），错误报告据此还原调用栈
COPY --from=builder --chown=nextjs:nodejs /app/.next/sourcemaps ./.next/sourcemaps

USER nextjs

EXPOSE 3000

# run with node (standalone/server.js)
CMD ["node", "server.js"]
