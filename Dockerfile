# Container image for the dashboard.
#
# The dashboard is not static — it server-renders the board and exposes two
# POST routes — so it needs a Node process. A container is the least
# error-prone way to run a monorepo workspace on Azure: the alternative is
# talking App Service into finding packages/dashboard/server.js by itself.

FROM node:22-alpine AS deps
WORKDIR /app
# Copy manifests only, so npm ci is cached until a dependency actually changes.
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY packages/cli/package.json packages/cli/
COPY packages/dashboard/package.json packages/dashboard/
RUN npm ci --no-audit --no-fund

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# @dispatch/core resolves to dist/, so tsc has to run before next build.
RUN npm run build
RUN npm run build --workspace @dispatch/dashboard

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Run unprivileged. The image needs no write access at runtime.
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001

COPY --from=builder --chown=nextjs:nodejs /app/packages/dashboard/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/packages/dashboard/.next/static ./packages/dashboard/.next/static

USER nextjs
EXPOSE 3000

CMD ["node", "packages/dashboard/server.js"]
