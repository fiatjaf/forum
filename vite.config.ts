import { defineConfig } from "vite"
import solid from "vite-plugin-solid"

export default defineConfig({
  plugins: [solid()],
  optimizeDeps: { exclude: ["@nostr/gadgets/redstore"] },
  worker: { format: "es" }
})
