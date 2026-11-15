import { pool } from "@nostr/gadgets/global"
import type { NostrEvent } from "@nostr/tools/core"
import type { Filter } from "@nostr/tools/filter"
import type { SubCloser } from "@nostr/tools/abstract-pool"
import { CONTENT_KINDS, META_KINDS, type Group, allGroups, getGroup, loadMyGroups, normalizeRelay } from "./groups"
import { onauth } from "./nostr"
import { query, save } from "./store"
import { emit } from "./state"

const OVERLAP = 2 * 60 * 60
const PAGE = 500
const MAX_PAGES = 200
const RESYNC_EVERY = 15 * 60 * 1000

function contentFilter(g: Group): Filter {
  return { "#h": [g.id], kinds: CONTENT_KINDS }
}

function metaFilter(g: Group): Filter {
  const f: Filter = { "#d": [g.id], kinds: META_KINDS }
  if (g.relayPubkey) f.authors = [g.relayPubkey]
  return f
}

// One REQ until EOSE (or a timeout); answers undefined when the relay
// closed it on us, so the caller can tell "nothing more" from "failed".
function fetchPage(relay: string, filter: Filter): Promise<NostrEvent[] | undefined> {
  return new Promise(resolve => {
    const events: NostrEvent[] = []
    let done = false
    const finish = (ok: boolean) => {
      if (done) return
      done = true
      resolve(ok ? events : undefined)
    }
    const sub = pool.subscribe([relay], filter, {
      label: "forum-sync",
      maxWait: 15_000,
      onauth,
      onevent: evt => {
        events.push(evt)
      },
      oneose: () => {
        finish(true)
        sub.close()
      },
      onclose: reasons => finish(reasons.every(r => r.reason === "closed by caller"))
    })
  })
}

// The newest event a complete sync brought, per group. Events that arrive
// some other way (the live subscription, our own posts) don't move it, so it
// never claims history we haven't actually fetched.
const checkpointKey = (g: Group) => `sync:${g.relay}'${g.id}`

function checkpoint(g: Group): number | undefined {
  const v = parseInt(localStorage.getItem(checkpointKey(g)) || "")
  return Number.isFinite(v) ? v : undefined
}

function setCheckpoint(g: Group, ts: number | undefined) {
  try {
    if (ts === undefined) localStorage.removeItem(checkpointKey(g))
    else localStorage.setItem(checkpointKey(g), String(ts))
  } catch {}
}

// Brings the store up to date with the relay: everything from the newest
// event we have (less two hours, for late arrivals and clock skew) on, or
// the whole history the first time (or when full is set, e.g. after joining
// a private forum whose history we couldn't read before).
const fullSyncQueued = new Set<Group>()

export async function syncGroup(g: Group, full = false) {
  if (g.syncing) {
    if (full) fullSyncQueued.add(g)
    return
  }
  g.syncing = true
  g.syncError = null
  emit()
  try {
    await g.loaded
    const meta = await fetchPage(g.relay, metaFilter(g))
    for (const evt of meta ?? []) await save(evt)

    const from = full ? undefined : checkpoint(g)
    const since = from === undefined ? undefined : from - OVERLAP
    let newest = from
    let complete = true

    let until: number | undefined
    const seen = new Set<string>()
    for (let p = 0; p < MAX_PAGES; p++) {
      const page = await fetchPage(g.relay, { ...contentFilter(g), since, until, limit: PAGE })
      if (page === undefined) {
        complete = false
        if (p === 0 && !meta) throw new Error(`couldn't read from ${g.relay}`)
        break
      }
      let fresh = 0
      let oldest = Infinity
      for (const evt of page) {
        if (evt.created_at < oldest) oldest = evt.created_at
        if (newest === undefined || evt.created_at > newest) newest = evt.created_at
        if (seen.has(evt.id)) continue
        seen.add(evt.id)
        fresh++
        save(evt)
      }
      // a page of only what we already had: nothing older left to get
      if (fresh === 0) break
      until = oldest
    }
    if (complete) setCheckpoint(g, newest)
    g.lastSync = Date.now()
  } catch (err) {
    g.syncError = String((err as Error).message ?? err)
    console.warn("[sync]", g.relay, g.id, err)
  } finally {
    g.syncing = false
    emit()
    if (fullSyncQueued.delete(g)) syncGroup(g, true)
  }
}

// ─── live ──────────────────────────────────────────────────────

const live = new Map<Group, SubCloser>()

export function goLive(g: Group) {
  if (live.has(g)) return
  const open = () => {
    const sub = pool.subscribeMap(
      [
        { url: g.relay, filter: { ...contentFilter(g), since: Math.floor(Date.now() / 1000) - 60 } },
        { url: g.relay, filter: metaFilter(g) }
      ],
      {
        label: "forum-live",
        onauth,
        onevent: evt => {
          save(evt)
        },
        onclose: () => {
          if (live.get(g) !== sub) return
          live.delete(g)
          // reconnect later and catch up on what we missed meanwhile
          setTimeout(() => {
            syncGroup(g)
            goLive(g)
          }, 15_000)
        }
      }
    )
    live.set(g, sub)
  }
  open()
}

// After joining, what the relay hid from us before is readable: subscribe
// again and fetch the whole history.
export function rejoined(g: Group) {
  const sub = live.get(g)
  live.delete(g)
  sub?.close()
  goLive(g)
  syncGroup(g, true)
}

export function isLive(g: Group): boolean {
  return live.has(g)
}

// A group being looked at: load it, catch up and stay subscribed.
export function activate(g: Group) {
  goLive(g)
  if (!g.syncing && Date.now() - g.lastSync > 60_000) syncGroup(g)
}

// ─── startup ───────────────────────────────────────────────────

export async function startSync() {
  const items = await loadMyGroups().catch(() => [])
  for (const item of items) {
    const g = getGroup({ id: item.groupId, relay: normalizeRelay(item.relay) })
    syncGroup(g).then(() => goLive(g))
  }
  // a fresh copy of the list, in case another client changed it
  loadMyGroups(true)
    .then(items => {
      for (const item of items) activate(getGroup({ id: item.groupId, relay: normalizeRelay(item.relay) }))
    })
    .catch(() => {})

  setInterval(() => {
    for (const g of allGroups()) syncGroup(g)
  }, RESYNC_EVERY)
}
