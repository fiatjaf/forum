import { Index } from "flexsearch"
import type { NostrEvent as Event } from "@nostr/tools/core"
import { KIND_COMMENT, KIND_THREAD } from "./groups"
import { onSaved, query } from "./store"

// Built from the store the first time someone searches, then fed with every
// new thread and comment the store takes in.
let index: Index | null = null
let building: Promise<Index> | null = null
const docs: Event[] = []
const known = new Set<string>()

function add(idx: Index, evt: Event) {
  if (known.has(evt.id)) return
  known.add(evt.id)
  const n = docs.push(evt) - 1
  const title = evt.tags.find(t => t[0] === "title")?.[1] ?? ""
  idx.add(n, `${title}\n${evt.content}`)
}

function ensureIndex(): Promise<Index> {
  if (index) return Promise.resolve(index)
  building ??= (async () => {
    const idx = new Index({ tokenize: "forward" })
    const events = await query({ kinds: [KIND_THREAD, KIND_COMMENT] })
    for (const evt of events) add(idx, evt)
    index = idx
    return idx
  })()
  return building
}

onSaved(evt => {
  if (index && (evt.kind === KIND_THREAD || evt.kind === KIND_COMMENT)) add(index, evt)
})

// Best match first, only from the given group.
export async function search(q: string, groupId: string): Promise<Event[]> {
  const idx = await ensureIndex()
  const ids = idx.search(q, { limit: 1000 }) as number[]
  return ids.map(n => docs[n]).filter(evt => evt.tags.some(t => t[0] === "h" && t[1] === groupId))
}
