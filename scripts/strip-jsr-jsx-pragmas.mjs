// JSR packages are published as Deno sources, pragmas and all: their .tsx files
// start with `@jsxRuntime classic`, `@jsxImportSource npm:solid-js@^1.9.19` and
// friends. Deno understands those; `tsc` instead switches the file to the
// classic JSX runtime and then looks for a React namespace that was never
// installed, while the bundler build already strips them (vite.config.ts).
// Dropping the comments here keeps `tsc --noEmit` focused on our own sources.
//
// This only touches comments, so it cannot change any behaviour, and it is a
// no-op once the packages ship npm-ready builds.
import { readdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"

const PRAGMA = /\/\*\*\s*@jsx(?:Runtime|ImportSource|ImportSourceTypes|Factory|FragmentFactory)\b[^*]*\*\//g

// Installed JSR packages carry `_jsr_revision` in their package.json, which
// also covers ones installed under an npm alias.
async function isJsrPackage(dir) {
  try {
    const manifest = JSON.parse(await readFile(join(dir, "package.json"), "utf8"))
    return typeof manifest._jsr_revision === "number"
  } catch {
    return false
  }
}

async function* installedPackages(dir) {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const path = join(dir, entry.name)
    if (entry.name.startsWith("@")) yield* installedPackages(path)
    else yield path
  }
}

async function* tsxFiles(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) yield* tsxFiles(path)
    else if (entry.name.endsWith(".tsx")) yield path
  }
}

for await (const pkg of installedPackages("node_modules")) {
  if (!(await isJsrPackage(pkg))) continue
  for await (const file of tsxFiles(pkg)) {
    const code = await readFile(file, "utf8")
    const withoutPragmas = code.replace(PRAGMA, "")
    if (withoutPragmas !== code) await writeFile(file, withoutPragmas)
  }
}
