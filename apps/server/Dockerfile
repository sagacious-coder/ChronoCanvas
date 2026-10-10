# syntax=docker/dockerfile:1

# ==========================================
# Stage 1: Build stage
# ==========================================
FROM node:20-alpine AS builder

WORKDIR /app

# Enable pnpm matching monorepo version (9.0.0)
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

# Copy root workspace manifests
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./

# Copy all workspace package.json manifests to satisfy lockfile importers
COPY packages/shared-types/package.json ./packages/shared-types/
COPY apps/server/package.json ./apps/server/
COPY apps/agent-worker/package.json ./apps/agent-worker/
COPY apps/web/package.json ./apps/web/

# Install dependencies needed for @chronocanvas/server and its workspace dependencies
RUN pnpm install --frozen-lockfile --filter @chronocanvas/server...

# Copy source code for shared-types and server
COPY packages/shared-types/ ./packages/shared-types/
COPY apps/server/ ./apps/server/

# Build shared types first, then the server
RUN pnpm --filter @chronocanvas/shared-types run build
RUN pnpm --filter @chronocanvas/server run build

# Prune development dependencies for minimal production footprint
RUN pnpm prune --prod

# ==========================================
# Stage 2: Production runner
# ==========================================
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3001

# Copy workspace production dependencies and built packages
COPY --from=builder /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/shared-types ./packages/shared-types
COPY --from=builder /app/apps/server/package.json ./apps/server/
COPY --from=builder /app/apps/server/node_modules ./apps/server/node_modules
COPY --from=builder /app/apps/server/dist ./apps/server/dist

WORKDIR /app/apps/server

EXPOSE 3001

CMD ["node", "dist/index.js"]
