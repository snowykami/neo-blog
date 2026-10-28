# -----------------------------------------------------------------------------
# This Dockerfile is specifically configured for projects using Node and pnpm
# For Bun or yarn, refer to the Dockerfile.bun instead
# -----------------------------------------------------------------------------

# Use official Node image and pnpm
FROM node:24-alpine AS builder
WORKDIR /app
ARG PNPM_VERSION=10.23.0

# enable corepack and activate pnpm
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate

# copy lock & package then install (dev deps needed for build)
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

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
FROM node:24-alpine AS runner
WORKDIR /app
ARG PNPM_VERSION=10.23.0

ENV NODE_ENV=production \
  PORT=3000 \
  HOSTNAME="0.0.0.0"

# enable corepack for pnpm in runner
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate

# create non-root user
RUN addgroup -S nodejs && adduser -S nextjs -G nodejs

# copy public and standalone output from builder
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# (optional) install production deps if standalone didn't include them
# COPY --from=builder /app/package.json ./package.json
# COPY --from=builder /app/pnpm-lock.yaml ./pnpm-lock.yaml
# RUN pnpm install --prod --frozen-lockfile --reporter=silent

USER nextjs

EXPOSE 3000

# run with node (standalone/server.js)
CMD ["node", "server.js"]
