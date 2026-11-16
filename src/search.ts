import { Index } from "flexsearch"
import type { NostrEvent as Event } from "@nostr/tools/core"
import { KIND_COMMENT, KIND_THREAD } from "./groups"
import { onSaved, query } from "./store"

// Filled from the store the first time someone searches, then fed with every
// new thread and comment the store takes in.
const index = new Index({ tokenize: "forward" })
const docs: Event[] = []
const known = new Set<string>()

// Set on the first search; later searches wait for the same filling.
let filling: Promise<void> | null = null

function add(evt: Event) {
  if (known.has(evt.id)) return
  known.add(evt.id)
  const n = docs.push(evt) - 1
  const title = evt.tags.find(t => t[0] === "title")?.[1] ?? ""
  index.add(n, `${title}\n${evt.content}`)
}

async function fillIndex() {
  const events = await query({ kinds: [KIND_THREAD, KIND_COMMENT] })
  for (const evt of events) add(evt)
}

// Before the first search there's nothing to keep up to date: the store query
// will find this event then. After it, add it right away, even while the index
// is still being filled (add skips what it already has).
onSaved(evt => {
  if (!filling) return
  if (evt.kind === KIND_THREAD || evt.kind === KIND_COMMENT) add(evt)
})

// Best match first, only from the given group.
export async function search(q: string, groupId: string): Promise<Event[]> {
  if (!filling) filling = fillIndex()
  await filling
  const ids = index.search(q, { limit: 1000 }) as number[]
  return ids.map(n => docs[n]).filter(evt => evt.tags.some(t => t[0] === "h" && t[1] === groupId))
}
