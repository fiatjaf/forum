import { loadSimpleGroups, type SimpleGroupItem } from "@nostr/gadgets/lists"
import { pool } from "@nostr/gadgets/global"
import type { EventTemplate, NostrEvent as Event } from "@nostr/tools/core"
import { fetchRelayInformation } from "@nostr/tools/nip11"
import * as nip19 from "@nostr/tools/nip19"
import { parse } from "@nostr/tools/nip27"
import { normalizeURL } from "@nostr/tools/utils"
import { announceRelays, authRelays, me, now, onauth, publishToRelay, sign } from "./account"
import { onSaved, query, save } from "./store"
import { emit } from "./state"

export const KIND_THREAD = 11
export const KIND_COMMENT = 1111
export const KIND_REACTION = 7
export const KIND_DELETION = 5
export const CONTENT_KINDS = [KIND_THREAD, KIND_COMMENT, KIND_REACTION, KIND_DELETION, 9000, 9001, 9005]
export const META_KINDS = [39000, 39001, 39002]

export type GroupRef = { id: string; relay: string; relayPubkey?: string }

const tag = (evt: Event, name: string) => evt.tags.find(t => t[0] === name)?.[1]

export function normalizeRelay(input: string): string {
    input = input.trim()
    if (!/^wss?:\/\//.test(input)) input = "wss://" + input
    return normalizeURL(input)
}

// ─── server identity ───────────────────────────────────────────
// The naddr of a group names the server's own key (NIP-11 "self"), which also
// signs the group's 39xxx events.
// The front page asks for every forum at once, so a request already on its way
// for a server is shared instead of sending another.
const relaySelfFetching = new Map<string, Promise<string>>()

export async function relaySelf(relay: string): Promise<string> {
    const stored = localStorage.getItem("self:" + relay)
    if (stored) return stored

    let fetching = relaySelfFetching.get(relay)
    if (!fetching) {
        fetching = fetchRelaySelf(relay)
        relaySelfFetching.set(relay, fetching)
    }
    try {
        return await fetching
    } finally {
        relaySelfFetching.delete(relay)
    }
}

async function fetchRelaySelf(relay: string): Promise<string> {
    const info = await fetchRelayInformation(relay)
    const self = (info as any).self || info.pubkey
    if (!self || !/^[0-9a-f]{64}$/.test(self)) throw new Error(`${relay} doesn't say what its key is (NIP-11 "self")`)
    try {
        localStorage.setItem("self:" + relay, self)
    } catch { }
    return self
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
    event: Event
}

export class Group {
    id: string
    relay: string
    relayPubkey?: string

    metadata: Metadata | null = null
    admins = new Map<string, string[]>()
    members: Set<string> | null = null
    private adminsAt = 0
    private membersAt = 0
    // the latest 9000 or 9001 about me
    myMembershipEvent: Event | null = null

    threads = new Map<string, Event>()
    comments = new Map<string, Event>()
    commentsByRoot = new Map<string, Event[]>()
    reactions = new Map<string, Event[]>()
    // kind:5 targets, by the deleting author (only that author's events count)
    deletions = new Map<string, Set<string>>()
    // 9005 targets: the server accepted them from a moderator
    removed = new Set<string>()
    // the most recent events, for the "previous" tag on what we publish
    recent: Event[] = []

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

    ingest(evt: Event) {
        const h = tag(evt, "h")
        if (h === this.id) this.ingestContent(evt)
        else if (META_KINDS.includes(evt.kind) && tag(evt, "d") === this.id) this.ingestMeta(evt)
    }

    private ingestMeta(evt: Event) {
        // 39xxx are only valid when signed by the server itself
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
                if (this.adminsAt > evt.created_at) return
                this.adminsAt = evt.created_at
                this.admins = new Map(evt.tags.filter(t => t[0] === "p" && t[1]).map(t => [t[1], t.slice(2)]))
                break
            }
            case 39002: {
                if (this.membersAt > evt.created_at) return
                this.membersAt = evt.created_at
                this.members = new Set(evt.tags.filter(t => t[0] === "p" && t[1]).map(t => t[1]))
                break
            }
        }
    }

    private ingestContent(evt: Event) {
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
                    if (!this.myMembershipEvent || this.myMembershipEvent.created_at <= evt.created_at)
                        this.myMembershipEvent = evt
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

    isDeleted(evt: Event): boolean {
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

    myVotes(id: string): Event[] {
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

    visibleThreads(): Event[] {
        return [...this.threads.values()].filter(t => !this.isDeleted(t))
    }

    threadComments(rootId: string): Event[] {
        return this.commentsByRoot.get(rootId) ?? []
    }

    lastActivity(thread: Event): number {
        let last = thread.created_at
        for (const c of this.threadComments(thread.id)) if (c.created_at > last && !this.isDeleted(c)) last = c.created_at
        return last
    }

    commentCount(rootId: string): number {
        return this.threadComments(rootId).filter(c => !this.isDeleted(c)).length
    }

    // ─── writing ───────────────────────────────────────────────

    async publish(template: Omit<EventTemplate, "created_at"> & { created_at?: number }): Promise<Event> {
        const previous = this.recent.slice(0, 3).map(e => e.id.slice(0, 8))
        const tags = [["h", this.id], ...template.tags]
        if (previous.length) tags.push(["previous", ...previous])
        const evt = await publishToRelay(this.relay, { ...template, tags, created_at: template.created_at ?? now() })
        return evt
    }

    createThread(title: string, body: string) {
        return this.publish({ kind: KIND_THREAD, content: body, tags: [["title", title]] })
    }

    comment(thread: Event, parent: Event, body: string) {
        const tags = [
            ["E", thread.id, this.relay, thread.pubkey],
            ["K", String(KIND_THREAD)],
            ["P", thread.pubkey, this.relay],
            ["e", parent.id, this.relay, parent.pubkey],
            ["k", String(parent.kind)],
            ["p", parent.pubkey, this.relay]
        ]
        for (const block of parse(body)) {
            if (block.type !== "reference" || !("pubkey" in block.pointer)) continue
            const pk = block.pointer.pubkey
            if (!tags.some(t => t[0] === "p" && t[1] === pk)) tags.push(["p", pk])
        }
        return this.publish({ kind: KIND_COMMENT, content: body, tags })
    }

    async toggleVote(target: Event) {
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

    async deleteEvent(target: Event) {
        if (target.pubkey === me) {
            await this.publish({
                kind: KIND_DELETION,
                content: "",
                tags: [
                    ["e", target.id],
                    ["k", String(target.kind)]
                ]
            })
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

    putUser(pubkey: string, roles: string[] = []) {
        return this.publish({ kind: 9000, content: "", tags: [["p", pubkey, ...roles]] })
    }

    removeUser(pubkey: string) {
        return this.publish({ kind: 9001, content: "", tags: [["p", pubkey]] })
    }

    async createInvite(): Promise<string> {
        const code = randomId(16)
        await this.publish({ kind: 9009, content: "", tags: [["code", code]] })
        return code
    }

    async deleteGroup() {
        await this.publish({ kind: 9008, content: "", tags: [] })
        await removeFromMyGroups(this).catch(() => { })
    }
}

function randomId(length: number): string {
    return Array.from(
        crypto.getRandomValues(new Uint8Array(length)),
        b => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]
    ).join("")
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

const LIST_FETCH_WAIT = 4000

function within<T>(ms: number, p: Promise<T>, fallback: T): Promise<T> {
    return Promise.race([p.catch(() => fallback), new Promise<T>(resolve => setTimeout(() => resolve(fallback), ms))])
}

// The newest list we can find: what we have here, or a newer one some relay
// has (another client may have changed it). Null only if there is none at all.
async function latestMyGroupsList(): Promise<Event | null> {
    let newest: Event | null = null

    const local = await within(1000, loadSimpleGroups(me, [], false), null)
    if (local?.event && local.event.created_at > 0) newest = local.event

    const relays = await within(LIST_FETCH_WAIT, announceRelays(), [])
    const filter = { kinds: [10009], authors: [me] }
    const found = await within(LIST_FETCH_WAIT + 1000, pool.querySync(relays, filter, { maxWait: LIST_FETCH_WAIT }), [])
    for (const evt of found) {
        if (!newest || evt.created_at > newest.created_at) newest = evt
    }

    return newest
}

// Signs the new list, saves it here and shows it, then resolves. Sending it out
// to relays happens in the background and may fail without anyone minding.
async function publishMyGroupsList(previous: Event | null, tags: string[][]) {
    // the "r" tags always mirror the relays of the groups in the list
    const groupRelays = [...new Set(tags.filter(t => t[0] === "group").map(t => t[2]))]
    const finalTags = tags.filter(t => t[0] !== "r")
    for (const relay of groupRelays) finalTags.push(["r", relay])

    const evt = await sign({
        kind: 10009,
        // always newer than the list it replaces, even if our clock is behind
        created_at: Math.max(now(), (previous?.created_at ?? 0) + 1),
        tags: finalTags,
        content: previous?.content ?? ""
    })
    await save(evt)

    const list = await loadSimpleGroups(me, [], evt)
    myGroups = list.items
    myGroupsLoaded = true
    emit()

    // the servers of forums we just left get it too, so they don't keep the old list
    const previousRelays = (previous?.tags ?? []).filter(t => t[0] === "group" && t[2]).map(t => t[2])
    announceRelays([...groupRelays, ...previousRelays])
        .then(targets => Promise.allSettled(pool.publish(targets, evt, { onauth })))
        .catch(() => { })
}

// Changes to the list go one at a time: each waits for the previous one to
// finish, so two quick ones don't both start from the same list.
let previousChange: Promise<void> = Promise.resolve()

export async function addToMyGroups(g: Group) {
    if (inMyGroups(g)) return

    const waitForPrevious = previousChange
    let finished!: () => void
    previousChange = new Promise(resolve => (finished = resolve))
    await waitForPrevious

    try {
        const current = await latestMyGroupsList()
        const entry = ["group", g.id, g.relay]
        if (g.metadata?.name) entry.push(g.metadata.name)
        const tags = [...(current?.tags ?? []), entry]
        await publishMyGroupsList(current, tags)
    } finally {
        finished()
    }
}

export async function removeFromMyGroups(g: GroupRef) {
    const waitForPrevious = previousChange
    let finished!: () => void
    previousChange = new Promise(resolve => (finished = resolve))
    await waitForPrevious

    try {
        const current = await latestMyGroupsList()
        const tags = (current?.tags ?? []).filter(
            t => !(t[0] === "group" && t[1] === g.id && normalizeRelay(t[2] ?? "") === g.relay)
        )
        await publishMyGroupsList(current, tags)
    } finally {
        finished()
    }
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
    const id = randomId(9)
    const g = getGroup({ id, relay, relayPubkey })
    await g.publish({ kind: 9007, content: "", tags: [] })
    await g.editMetadata(opts)
    // the server's 39000 may take a moment; until then show what we asked for
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
