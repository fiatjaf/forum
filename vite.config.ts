import { defineConfig, type Plugin } from "vite"
import solid from "vite-plugin-solid"

// JSR packages are published as Deno sources, so they import their dependencies
// as `npm:foo@1.2.3` / `npm:foo@1.2.3/subpath`. Browsers (and Vite) want plain
// bare specifiers, resolved from node_modules by the package manager.
const jsrNpmSpecifiers = (): Plugin => ({
  name: "jsr-npm-specifiers",
  enforce: "pre",
  transform(code, id) {
    if (!id.includes("/node_modules/") || !code.includes("npm:")) return null
    // The jsxImportSource pragmas point at `npm:` specifiers too, and esbuild
    // warns about them once they are rewritten.
    const stripped = code.replace(/\/\*\*\s*@jsx(?:Runtime|ImportSource|ImportSourceTypes|Factory|FragmentFactory)\b[^*]*\*\//g, "")
    return stripped.replace(/(["'])npm:([^"']+)\1/g, (_whole, quote: string, spec: string) => {
      const bare = spec.replace(/^(@[^/]+\/[^@/]+|[^@/]+)@[^/]*/, "$1")
      return quote + bare + quote
    })
  }
})

export default defineConfig({
  plugins: [jsrNpmSpecifiers(), solid()],
  optimizeDeps: {
    // The djot renderer needs to go through the plugin above and through
    // vite-plugin-solid (it ships .tsx sources), not through esbuild's
    // pre-bundling. Its own dependencies still do, since @djot/djot is CommonJS.
    exclude: ["@nostr/gadgets/redstore", "@fiatjaf/solid-djot"],
    include: ["@djot/djot"]
  },
  worker: { format: "es" }
})
