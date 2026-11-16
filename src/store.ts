import { setReplaceableStore } from "@nostr/gadgets/global"
import { RedEventStore } from "@nostr/gadgets/redstore"
import RedStoreWorker from "@nostr/gadgets/redstore/redstore-worker?worker"
import type { NostrEvent as Event } from "@nostr/tools/core"
import type { Filter } from "@nostr/tools/filter"
import { isAddressableKind } from "@nostr/tools/kinds"

// One redstore for everything: group events, profiles and lists (the gadgets
// loaders cache their replaceables here too).
const store = new RedEventStore(new RedStoreWorker(), "@forum-redstore")

// gadgets asks for kind 0 and 1xxxx with an empty d-tag, and redstore looks
// that up in the d-tag index, which only holds 3xxxx events: drop the d-tag
// for non-addressable kinds, and don't trust a lookup that answers with
// another event.
const rawLoadReplaceables = store.loadReplaceables.bind(store)
store.loadReplaceables = (async (specs: [number, string, string?][]) => {
  const found = await rawLoadReplaceables(
    specs.map(([kind, pubkey, d]): [number, string, string?] =>
      isAddressableKind(kind) ? [kind, pubkey, d] : [kind, pubkey]
    )
  )
  return found.map(([lastAttempt, stored], i) => {
    const [kind, pubkey, d] = specs[i]
    const fits = (e: Event | undefined) =>
      !!e &&
      e.kind === kind &&
      e.pubkey === pubkey &&
      (!isAddressableKind(kind) || d === undefined || (e.tags.find(t => t[0] === "d")?.[1] ?? "") === d)
    return Array.isArray(stored) ? [lastAttempt, stored.filter(fits)] : [lastAttempt, fits(stored) ? stored : undefined]
  })
}) as any

setReplaceableStore(store)

export function query(filter: Filter, maxLimit = 100_000): Promise<Event[]> {
  return store.queryEvents(filter, maxLimit).catch(err => {
    console.warn("[store] query failed", filter, err)
    return []
  })
}

// Everything that reaches the store through us is announced here, once, the
// first time it is saved.
const listeners = new Set<(event: Event) => void>()

export function onSaved(fn: (event: Event) => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export async function save(event: Event): Promise<boolean> {
  let isNew = false
  try {
    isNew = await store.saveEvent(event)
  } catch (err) {
    console.warn("[store] save failed", err)
    return false
  }
  if (isNew) {
    for (const fn of listeners) {
      try {
        fn(event)
      } catch (err) {
        console.warn("[store] listener failed", err)
      }
    }
  }
  return isNew
}
