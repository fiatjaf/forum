import { defineConfig } from "vite"

export default defineConfig({
  esbuild: { jsx: "automatic", jsxImportSource: "preact" },
  optimizeDeps: { exclude: ["@nostr/gadgets/redstore"] },
  worker: { format: "es" }
})
