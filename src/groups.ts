import { loadSimpleGroups, type SimpleGroupItem } from "@nostr/gadgets/lists"
import { pool } from "@nostr/gadgets/global"
import type { EventTemplate, NostrEvent } from "@nostr/tools/core"
import { fetchRelayInformation } from "@nostr/tools/nip11"
import * as nip19 from "@nostr/tools/nip19"
import { normalizeURL } from "@nostr/tools/utils"
import { anySuccess, authRelays, me, myWriteRelays, now, onauth, publishToRelay, sign } from "./nostr"
import { onSaved, query, save } from "./store"
import { emit } from "./state"

export const KIND_THREAD = 11
export const KIND_COMMENT = 1111
export const KIND_REACTION = 7
export const KIND_DELETION = 5
export const CONTENT_KINDS = [KIND_THREAD, KIND_COMMENT, KIND_REACTION, KIND_DELETION, 9000, 9001, 9005]
export const META_KINDS = [39000, 39001, 39002]

export type GroupRef = { id: string; relay: string; relayPubkey?: string }

const tag = (evt: NostrEvent, name: string) => evt.tags.find(t => t[0] === name)?.[1]

export function normalizeRelay(input: string): string {
  input = input.trim()
  if (!/^wss?:\/\//.test(input)) input = "wss://" + input
  return normalizeURL(input)
}

// ─── relay identity ────────────────────────────────────────────
// The naddr of a group names the relay's own key (NIP-11 "self"), which also
// signs the group's 39xxx events.
const relaySelfCache = new Map<string, Promise<string>>()

export function relaySelf(relay: string): Promise<string> {
  let p = relaySelfCache.get(relay)
  if (!p) {
    const stored = localStorage.getItem("self:" + relay)
    p = stored
      ? Promise.resolve(stored)
      : fetchRelayInformation(relay).then(info => {
          const self = (info as any).self || info.pubkey
          if (!self || !/^[0-9a-f]{64}$/.test(self)) throw new Error(`${relay} doesn't say what its key is (NIP-11 "self")`)
          try {
            localStorage.setItem("self:" + relay, self)
          } catch {}
          return self as string
        })
    p.catch(() => relaySelfCache.delete(relay))
    relaySelfCache.set(relay, p)
  }
  return p
}

export function groupNaddr(g: GroupRef & { relayPubkey: string }): string {
  return nip19.naddrEncode({ kind: 39000, pubkey: g.relayPubkey, identifier: g.id, relays: [g.relay] })
}

export function parseNaddr(code: string): GroupRef | null {
  try {
    const d = nip19.decode(code)
    if (d.type !== "naddr" || d.data.kind !== 39000 || !d.data.relays?.length) return null
    return { id: d.data.identifier, relay: normalizeRelay(d.data.relays[0]), relayPubkey: d.data.pubkey }
  } catch {
    return null
  }
}

// ─── the in-memory model of one group ──────────────────────────

export type Metadata = {
  name?: string
  about?: string
  picture?: string
  isPrivate: boolean
  isClosed: boolean
  event: NostrEvent
}

export class Group {
  id: string
  relay: string
  relayPubkey?: string

  metadata: Metadata | null = null
  admins = new Map<string, string[]>()
  members: Set<string> | null = null
  // the latest 9000 or 9001 about me
  myMembershipEvent: NostrEvent | null = null

  threads = new Map<string, NostrEvent>()
  comments = new Map<string, NostrEvent>()
  commentsByRoot = new Map<string, NostrEvent[]>()
  reactions = new Map<string, NostrEvent[]>()
  // kind:5 targets, by the deleting author (only that author's events count)
  deletions = new Map<string, Set<string>>()
  // 9005 targets: the relay accepted them from a moderator
  removed = new Set<string>()
  // the most recent events, for the "previous" tag on what we publish
  recent: NostrEvent[] = []

  loaded: Promise<void>
  syncing = false
  lastSync = 0
  syncError: string | null = null

  constructor(ref: GroupRef) {
    this.id = ref.id
    this.relay = ref.relay
    this.relayPubkey = ref.relayPubkey
    authRelays.add(this.relay)
    this.loaded = this.loadFromStore()
  }

  get ref(): GroupRef {
    return { id: this.id, relay: this.relay, relayPubkey: this.relayPubkey }
  }

  get naddr(): string | null {
    return this.relayPubkey ? groupNaddr(this as GroupRef & { relayPubkey: string }) : null
  }

  get name(): string {
    return this.metadata?.name || this.id
  }

  private async loadFromStore() {
    const [content, meta] = await Promise.all([
      query({ "#h": [this.id], kinds: CONTENT_KINDS }),
      query({ "#d": [this.id], kinds: META_KINDS })
    ])
    // oldest first, so later replaceables and memberships win
    for (const evt of [...meta, ...content].sort((a, b) => a.created_at - b.created_at)) this.ingest(evt)
    emit()
  }

  ingest(evt: NostrEvent) {
    const h = tag(evt, "h")
    if (h === this.id) this.ingestContent(evt)
    else if (META_KINDS.includes(evt.kind) && tag(evt, "d") === this.id) this.ingestMeta(evt)
  }

  private ingestMeta(evt: NostrEvent) {
    // 39xxx are only valid when signed by the relay itself
    if (this.relayPubkey && evt.pubkey !== this.relayPubkey) return
    if (!this.relayPubkey) this.relayPubkey = evt.pubkey
    switch (evt.kind) {
      case 39000: {
        if (this.metadata && this.metadata.event.created_at > evt.created_at) return
        this.metadata = {
          name: tag(evt, "name"),
          about: tag(evt, "about"),
          picture: tag(evt, "picture"),
          isPrivate: evt.tags.some(t => t[0] === "private"),
          isClosed: evt.tags.some(t => t[0] === "closed"),
          event: evt
        }
        break
      }
      case 39001: {
        this.admins = new Map(evt.tags.filter(t => t[0] === "p" && t[1]).map(t => [t[1], t.slice(2)]))
        break
      }
      case 39002: {
        this.members = new Set(evt.tags.filter(t => t[0] === "p" && t[1]).map(t => t[1]))
        break
      }
    }
  }

  private ingestContent(evt: NostrEvent) {
    switch (evt.kind) {
      case KIND_THREAD:
        this.threads.set(evt.id, evt)
        break
      case KIND_COMMENT: {
        if (this.comments.has(evt.id)) return
        const root = tag(evt, "E")
        if (!root) return
        this.comments.set(evt.id, evt)
        const list = this.commentsByRoot.get(root) ?? []
        list.push(evt)
        this.commentsByRoot.set(root, list)
        break
      }
      case KIND_REACTION: {
        const target = evt.tags.findLast(t => t[0] === "e")?.[1]
        if (!target) return
        const list = this.reactions.get(target) ?? []
        if (list.some(r => r.id === evt.id)) return
        list.push(evt)
        this.reactions.set(target, list)
        break
      }
      case KIND_DELETION:
        for (const t of evt.tags) {
          if (t[0] !== "e" || !t[1]) continue
          const by = this.deletions.get(t[1]) ?? new Set()
          by.add(evt.pubkey)
          this.deletions.set(t[1], by)
        }
        break
      case 9005:
        for (const t of evt.tags) if (t[0] === "e" && t[1]) this.removed.add(t[1])
        break
      case 9000:
      case 9001:
        if (evt.tags.some(t => t[0] === "p" && t[1] === me)) {
          if (!this.myMembershipEvent || this.myMembershipEvent.created_at <= evt.created_at) this.myMembershipEvent = evt
        }
        return
    }
    if (evt.pubkey !== me && (evt.kind === KIND_THREAD || evt.kind === KIND_COMMENT)) {
      this.recent.push(evt)
      this.recent.sort((a, b) => b.created_at - a.created_at)
      if (this.recent.length > 50) this.recent.length = 50
    }
  }

  // ─── derived state ─────────────────────────────────────────

  isDeleted(evt: NostrEvent): boolean {
    return this.removed.has(evt.id) || !!this.deletions.get(evt.id)?.has(evt.pubkey)
  }

  voters(id: string): Set<string> {
    const voters = new Set<string>()
    for (const r of this.reactions.get(id) ?? []) {
      if (r.content === "-" || this.isDeleted(r)) continue
      voters.add(r.pubkey)
    }
    return voters
  }

  myVotes(id: string): NostrEvent[] {
    return (this.reactions.get(id) ?? []).filter(r => r.pubkey === me && r.content !== "-" && !this.isDeleted(r))
  }

  isAdmin(pubkey = me): boolean {
    return this.admins.has(pubkey)
  }

  isMember(pubkey = me): boolean {
    if (this.isAdmin(pubkey)) return true
    if (pubkey === me && this.myMembershipEvent) return this.myMembershipEvent.kind === 9000
    return !!this.members?.has(pubkey)
  }

  visibleThreads(): NostrEvent[] {
    return [...this.threads.values()].filter(t => !this.isDeleted(t))
  }

  threadComments(rootId: string): NostrEvent[] {
    return this.commentsByRoot.get(rootId) ?? []
  }

  lastActivity(thread: NostrEvent): number {
    let last = thread.created_at
    for (const c of this.threadComments(thread.id)) if (c.created_at > last && !this.isDeleted(c)) last = c.created_at
    return last
  }

  commentCount(rootId: string): number {
    return this.threadComments(rootId).filter(c => !this.isDeleted(c)).length
  }

  // ─── writing ───────────────────────────────────────────────

  async publish(template: Omit<EventTemplate, "created_at"> & { created_at?: number }): Promise<NostrEvent> {
    const previous = this.recent.slice(0, 3).map(e => e.id.slice(0, 8))
    const tags = [["h", this.id], ...template.tags]
    if (previous.length) tags.push(["previous", ...previous])
    const evt = await publishToRelay(this.relay, { ...template, tags, created_at: template.created_at ?? now() })
    return evt
  }

  createThread(title: string, body: string) {
    return this.publish({ kind: KIND_THREAD, content: body, tags: [["title", title]] })
  }

  comment(thread: NostrEvent, parent: NostrEvent, body: string) {
    const tags = [
      ["E", thread.id, this.relay, thread.pubkey],
      ["K", String(KIND_THREAD)],
      ["P", thread.pubkey, this.relay],
      ["e", parent.id, this.relay, parent.pubkey],
      ["k", String(parent.kind)],
      ["p", parent.pubkey, this.relay]
    ]
    for (const m of body.matchAll(/nostr:(npub1[a-z0-9]+|nprofile1[a-z0-9]+)/g)) {
      try {
        const d = nip19.decode(m[1])
        const pk = d.type === "npub" ? d.data : d.type === "nprofile" ? d.data.pubkey : null
        if (pk && !tags.some(t => t[0] === "p" && t[1] === pk)) tags.push(["p", pk])
      } catch {}
    }
    return this.publish({ kind: KIND_COMMENT, content: body, tags })
  }

  async toggleVote(target: NostrEvent) {
    const mine = this.myVotes(target.id)
    if (mine.length) {
      await this.publish({ kind: KIND_DELETION, content: "", tags: [...mine.map(r => ["e", r.id]), ["k", "7"]] })
    } else {
      await this.publish({
        kind: KIND_REACTION,
        content: "+",
        tags: [
          ["e", target.id, this.relay, target.pubkey],
          ["p", target.pubkey],
          ["k", String(target.kind)]
        ]
      })
    }
  }

  async deleteEvent(target: NostrEvent) {
    if (target.pubkey === me) {
      await this.publish({ kind: KIND_DELETION, content: "", tags: [["e", target.id], ["k", String(target.kind)]] })
    } else {
      await this.publish({ kind: 9005, content: "", tags: [["e", target.id]] })
    }
  }

  // edit-metadata replaces the whole group state, so whatever we don't edit
  // here (subgroup links, livekit, supported kinds…) is sent back as it was.
  async editMetadata(m: { name: string; about: string; picture: string; isPrivate: boolean; isClosed: boolean }) {
    const edited = new Set(["d", "name", "about", "picture", "private", "public", "closed", "open"])
    const kept = (this.metadata?.event.tags ?? []).filter(t => !edited.has(t[0]))
    const tags: string[][] = [["name", m.name]]
    if (m.about) tags.push(["about", m.about])
    if (m.picture) tags.push(["picture", m.picture])
    if (m.isPrivate) tags.push(["private"])
    if (m.isClosed) tags.push(["closed"])
    await this.publish({ kind: 9002, content: "", tags: [...tags, ...kept] })
  }

  async join(code?: string): Promise<string | null> {
    try {
      await this.publish({ kind: 9021, content: "", tags: code ? [["code", code]] : [] })
    } catch (err) {
      const msg = String((err as Error).message ?? err)
      if (!msg.includes("duplicate")) throw err
    }
    await addToMyGroups(this)
    return null
  }

  async leave() {
    await this.publish({ kind: 9022, content: "", tags: [] })
    await removeFromMyGroups(this)
  }

  putUser(pubkey: string) {
    return this.publish({ kind: 9000, content: "", tags: [["p", pubkey]] })
  }

  removeUser(pubkey: string) {
    return this.publish({ kind: 9001, content: "", tags: [["p", pubkey]] })
  }

  async createInvite(): Promise<string> {
    const code = Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10)
    await this.publish({ kind: 9009, content: "", tags: [["code", code]] })
    return code
  }
}

// ─── registry ──────────────────────────────────────────────────

const groups = new Map<string, Group>()

export function getGroup(ref: GroupRef): Group {
  const key = `${ref.relay}'${ref.id}`
  let g = groups.get(key)
  if (!g) {
    g = new Group(ref)
    groups.set(key, g)
  } else if (!g.relayPubkey && ref.relayPubkey) g.relayPubkey = ref.relayPubkey
  return g
}

export function allGroups(): Group[] {
  return [...groups.values()]
}

// The store announces whatever it saved for the first time, from any source.
onSaved(evt => {
  const id = tag(evt, "h") ?? (META_KINDS.includes(evt.kind) ? tag(evt, "d") : undefined)
  if (!id) return
  let touched = false
  for (const g of groups.values()) {
    if (g.id !== id) continue
    g.ingest(evt)
    touched = true
  }
  if (touched) emit()
})

// ─── my groups (kind:10009) ────────────────────────────────────

export let myGroups: SimpleGroupItem[] = []
export let myGroupsLoaded = false

export async function loadMyGroups(refresh = false): Promise<SimpleGroupItem[]> {
  const list = await loadSimpleGroups(me, [], refresh || undefined)
  myGroups = list.items
  myGroupsLoaded = true
  emit()
  return myGroups
}

export function inMyGroups(g: GroupRef): boolean {
  return myGroups.some(i => i.groupId === g.id && i.relay === g.relay)
}

async function publishMyGroups(mutate: (tags: string[][]) => string[][]) {
  // always start from the newest list we can find, so another client's
  // additions aren't lost
  const current = await loadSimpleGroups(me, [], true)
  const base = current.event?.tags ?? []
  const tags = mutate(base.map(t => [...t]))
  const relays = [...new Set(tags.filter(t => t[0] === "group").map(t => t[2]))]
  const final = [...tags.filter(t => t[0] !== "r"), ...relays.map(r => ["r", r])]
  const evt = await sign({ kind: 10009, created_at: now(), tags: final, content: current.event?.content ?? "" })
  await save(evt)
  await loadSimpleGroups(me, [], evt)
  await loadMyGroups()
  await anySuccess(pool.publish(await myWriteRelays(), evt, { onauth }))
}

export function addToMyGroups(g: Group) {
  if (inMyGroups(g)) return Promise.resolve()
  return publishMyGroups(tags => {
    const entry = ["group", g.id, g.relay]
    if (g.metadata?.name) entry.push(g.metadata.name)
    return [...tags, entry]
  })
}

export function removeFromMyGroups(g: GroupRef) {
  return publishMyGroups(tags =>
    tags.filter(t => !(t[0] === "group" && t[1] === g.id && normalizeRelay(t[2] ?? "") === g.relay))
  )
}

// ─── creating ──────────────────────────────────────────────────

export async function createGroup(opts: {
  relay: string
  name: string
  about: string
  picture: string
  isPrivate: boolean
  isClosed: boolean
}): Promise<Group> {
  const relay = normalizeRelay(opts.relay)
  const relayPubkey = await relaySelf(relay)
  const id = Array.from(crypto.getRandomValues(new Uint8Array(9)), b => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("")
  const g = getGroup({ id, relay, relayPubkey })
  await g.publish({ kind: 9007, content: "", tags: [] })
  await g.editMetadata(opts)
  // the relay's 39000 may take a moment; until then show what we asked for
  if (!g.metadata) {
    g.metadata = {
      name: opts.name,
      about: opts.about,
      picture: opts.picture,
      isPrivate: opts.isPrivate,
      isClosed: opts.isClosed,
      event: { kind: 39000, tags: [], content: "", created_at: 0, id: "", pubkey: relayPubkey, sig: "" }
    }
  }
  g.admins.set(me, ["admin"])
  await addToMyGroups(g)
  return g
}
