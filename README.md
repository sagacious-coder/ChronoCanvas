# ChronoCanvas

![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white)
![React](https://img.shields.io/badge/React_18-20232A?style=for-the-badge&logo=react&logoColor=61DAFB)
![Node.js](https://img.shields.io/badge/Node.js_20-43853D?style=for-the-badge&logo=node.js&logoColor=white)
![Temporal](https://img.shields.io/badge/Temporal-151515?style=for-the-badge&logo=temporal&logoColor=white)
![TailwindCSS](https://img.shields.io/badge/Tailwind_CSS-38B2AC?style=for-the-badge&logo=tailwind-css&logoColor=white)

**ChronoCanvas** is a next-generation real-time collaborative coding platform engineered specifically for seamless human-agent pair programming. By leveraging zero-lock concurrency and durable workflow orchestration, the platform provides developers and AI agents with a shared, resilient workspace featuring instant checkpointed rollbacks and deterministic state synchronization.

---

## 🌟 Key Features

*   **Human-Agent Pair Programming:** Code alongside an autonomous LLM agent that understands context, generates multi-file solutions, and injects code directly into your active editor.
*   **Zero-Lock Concurrency (CRDT):** Powered by Loro CRDTs to resolve distributed editing conflicts mathematically, ensuring rapid synchronization without locking the document.
*   **Durable AI Orchestration:** Utilizes a Temporal.io backend to manage long-running agent tasks. If a worker crashes or an LLM API times out, the workflow seamlessly self-heals and resumes without losing state.
*   **Instant Checkpointed Rollbacks:** Navigate your document's history and revert to prior states instantly, preserving the exact structural integrity of both human and AI contributions.
*   **Bring Your Own Key (BYOK) Auth:** Secure, frontend-driven API key dispatching with JWT gateway validation and WebSocket loop guards.

---

## 🏗️ Architecture Overview

The project is structured as a tightly integrated monorepo using **PNPM workspaces**.

```text
├── apps/
│   ├── web/               # React 18 + Vite + Tailwind CSS + CodeMirror 6 frontend
│   ├── server/            # Node.js WebSocket gateway & Loro CRDT document engine
│   └── agent-worker/      # Temporal worker for LLM tasks & sandbox test runners
├── packages/
│   └── shared-types/      # Contract-first TypeScript interfaces for WebSocket deltas & awareness
├── package.json           # Root workspace manifest
└── pnpm-workspace.yaml    # PNPM workspace definition