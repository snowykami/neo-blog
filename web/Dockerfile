# -----------------------------------------------------------------------------
# This Dockerfile is configured for Next.js built and executed with Bun
# Dependencies are installed via pnpm using pnpm-lock.yaml
# -----------------------------------------------------------------------------

# 基础镜像（构建与运行两个阶段共用，需 >= 1.4.4 以兼容 Next.js 16 Turbopack）。
# 默认是 Docker Hub 官方镜像；拉取 docker.io 慢或失败时，可通过构建参数换成镜像站，
# 例如 --build-arg BUN_IMAGE=docker.m.daocloud.io/oven/bun:1.4.4-alpine
ARG BUN_IMAGE=oven/bun:1.4.4-alpine

FROM ${BUN_IMAGE} AS builder
WORKDIR /app
ARG PNPM_VERSION=10.23.0
# npm 镜像源（可选）。默认留空走官方源 https://registry.npmjs.org；拉取慢或失败时可通过构建参数切换，
# 例如 --build-arg NPM_REGISTRY=https://registry.npmmirror.com
ARG NPM_REGISTRY=""

# 使用 pnpm-lock.yaml 严格锁定依赖版本
RUN if [ -n "${NPM_REGISTRY}" ]; then \
    npm_config_registry="${NPM_REGISTRY%/}" bun add -g pnpm@${PNPM_VERSION}; \
  else \
    bun add -g pnpm@${PNPM_VERSION}; \
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
# 走 Next 图片优化的本站图床 / 对象存储域名，逗号分隔（构建期默认值）；生产运行容器可直接通过运行时环境变量 IMAGE_OPTIMIZE_HOSTS 动态配置或覆盖，无需重新构建镜像
ARG IMAGE_OPTIMIZE_HOSTS=""
ENV NEXT_PUBLIC_IMAGE_OPTIMIZE_HOSTS=${IMAGE_OPTIMIZE_HOSTS}
# 前端静态资源 CDN 前缀（如 https://cdn.example.com 或 https://cdn.example.com/neo-blog）；未传入时保持同源加载
ARG ASSET_PREFIX=""
ENV NEXT_PUBLIC_ASSET_PREFIX=${ASSET_PREFIX}
# 这里用 lint 而不是 lint:fix：格式不合规应当直接失败，避免 CI 静默重排代码导致镜像内容与仓库不一致
RUN bun --bun run lint && bun run build

# production image
# 运行时只执行 standalone 产物里的 bun server.js，依赖已打包进 .next/standalone，不需要 pnpm
FROM ${BUN_IMAGE} AS runner
WORKDIR /app

ENV NODE_ENV=production \
  PORT=3000 \
  HOSTNAME="0.0.0.0"

# create non-root user
RUN addgroup -S bunjs && adduser -S nextjs -G bunjs

# copy public and standalone output from builder
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:bunjs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:bunjs /app/.next/static ./.next/static
# 浏览器代码的 source map（不在公开目录里），错误报告据此还原调用栈
COPY --from=builder --chown=nextjs:bunjs /app/.next/sourcemaps ./.next/sourcemaps

USER nextjs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD ["bun", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

# run with bun (standalone/server.js)
CMD ["bun", "server.js"]
