# ChronoCanvas

A real-time collaborative coding platform designed for seamless human-agent pair programming with zero-lock concurrency and instant checkpointed rollbacks.

## Architecture Overview (Monorepo)

```text
├── apps/
│   ├── web/               # React 18 + Vite + Tailwind CSS + CodeMirror 6 frontend
│   ├── server/            # (Stage 1) Node.js WebSocket gateway & Loro CRDT document engine
│   └── agent-worker/      # (Stage 2) Temporal worker for LLM tasks & sandbox test runners
├── packages/
│   └── shared-types/      # Contract-first TypeScript interfaces for WebSocket deltas & awareness
├── package.json           # Root workspace manifest
├── pnpm-workspace.yaml    # PNPM workspace definition
└── README.md
```

## Quickstart

### Prerequisites
- Node.js 20+
- PNPM 9+

### Installation & Development
```bash
# Install dependencies across all workspace packages
pnpm install

# Start the frontend development server
pnpm --filter @chronocanvas/web dev
```
