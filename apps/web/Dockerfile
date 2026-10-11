# ChronoCanvas — Stage 4 Day 12 Production Client Container
# Multi-stage build: Node.js build environment -> Hardened Nginx runtime

# Stage 1: Build production assets
FROM node:20-alpine AS builder

WORKDIR /app

# Enable pnpm via Corepack
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy package definition and install dependencies
COPY package.json ./
RUN pnpm install

# Copy source code and configuration files
COPY . .

# Build production bundle with TypeScript check & Vite optimization
RUN pnpm run build

# Stage 2: Serve optimized static artifacts with Nginx Alpine
FROM nginx:alpine-slim AS runner

# Remove default Nginx welcome page
RUN rm -rf /usr/share/nginx/html/*

# Copy built production assets from builder stage
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy production Nginx configuration with SPA fallback & security headers
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Expose HTTP port
EXPOSE 80

# Health check endpoint verification
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost/healthz || exit 1

# Start Nginx in foreground
CMD ["nginx", "-g", "daemon off;"]
