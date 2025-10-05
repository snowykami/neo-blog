# -----------------------------------------------------------------------------
# This Dockerfile is specifically configured for projects using Node and pnpm
# For Bun or yarn, refer to the Dockerfile.bun instead
# -----------------------------------------------------------------------------

# Use official Node image and pnpm
FROM node:22-alpine AS builder
WORKDIR /app

# enable corepack and activate pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# copy lock & package then install (dev deps needed for build)
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# copy source and build
COPY . .
RUN pnpm run build

# production image
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME="0.0.0.0"

# enable corepack for pnpm in runner
RUN corepack enable && corepack prepare pnpm@latest --activate

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