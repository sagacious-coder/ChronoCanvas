import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [react(), wasm(), topLevelAwait()],
  resolve: {
    alias: {
      "@chronocanvas/shared-types": fileURLToPath(new URL("./src/types/shared.ts", import.meta.url)),
    },
  },
  build: {
    target: "esnext",
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules")) {
            if (id.includes("react") || id.includes("react-dom")) {
              return "vendor-react";
            }
            if (id.includes("@codemirror") || id.includes("codemirror")) {
              return "vendor-codemirror";
            }
            if (id.includes("loro-crdt") || id.includes("loro-codemirror")) {
              return "vendor-loro";
            }
            return "vendor";
          }
        },
      },
    },
  },
  server: {
    port: 5173,
  },
});
