
FROM node:24-alpine AS builder
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@latest --activate


COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# 拷贝源码并构建
COPY . .
RUN pnpm run build


FROM node:24-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# 启用 corepack（用于在 runner 使用 pnpm）
RUN corepack enable && corepack prepare pnpm@latest --activate

# 创建非特权用户
RUN addgroup -S nodejs && adduser -S nextjs -G nodejs

# 先拷贝 package.json / lockfile，安装 production 依赖
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/pnpm-lock.yaml ./pnpm-lock.yaml
RUN pnpm install --prod --frozen-lockfile --reporter=silent

# 拷贝构建产物与 public
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public

# 归属权给非特权用户
RUN chown -R nextjs:nodejs /app

USER nextjs

EXPOSE 3000

# 使用 pnpm 启动（也可改为 npm run start）
CMD ["pnpm", "start"]