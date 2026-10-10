# syntax=docker/dockerfile:1

# ==========================================
# Stage 1: Build TypeScript worker & dependencies
# ==========================================
FROM node:20-bookworm-slim AS builder

WORKDIR /app

# Enable pnpm matching monorepo version (9.0.0)
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

# Copy root workspace manifests
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./

# Copy all workspace package.json manifests to satisfy lockfile importers
COPY packages/shared-types/package.json ./packages/shared-types/
COPY apps/agent-worker/package.json ./apps/agent-worker/
COPY apps/server/package.json ./apps/server/
COPY apps/web/package.json ./apps/web/

# Install dependencies needed for @chronocanvas/agent-worker and its workspace dependencies
RUN pnpm install --frozen-lockfile --filter @chronocanvas/agent-worker...

# Copy source code for shared-types and agent-worker
COPY packages/shared-types/ ./packages/shared-types/
COPY apps/agent-worker/ ./apps/agent-worker/

# Build shared types first, then agent-worker
RUN pnpm --filter @chronocanvas/shared-types run build
RUN pnpm --filter @chronocanvas/agent-worker run build

# Prune development dependencies
RUN pnpm prune --prod

# ==========================================
# Stage 2: Dual-runtime production runner (Node 20 + Python 3.11 + astral-sh/uv)
# ==========================================
FROM node:20-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production

# Install Python 3.11+ for the ephemeral code execution sandbox
RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 python3-pip && \
    ln -sf /usr/bin/python3 /usr/bin/python && \
    rm -rf /var/lib/apt/lists/*

# Install uv from official Astral binary image
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

# Configure uv to execute with the system Python environment directly
ENV UV_SYSTEM_PYTHON=1

# Copy workspace production dependencies and built packages
COPY --from=builder /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/shared-types ./packages/shared-types
COPY --from=builder /app/apps/agent-worker/package.json ./apps/agent-worker/
COPY --from=builder /app/apps/agent-worker/node_modules ./apps/agent-worker/node_modules
COPY --from=builder /app/apps/agent-worker/dist ./apps/agent-worker/dist

WORKDIR /app/apps/agent-worker

CMD ["node", "dist/worker.js"]
