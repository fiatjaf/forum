import { pool } from "@nostr/gadgets/global"
import { loadNostrUser as loadUser } from "@nostr/gadgets/metadata"
import { loadRelayList, loadSimpleGroups } from "@nostr/gadgets/lists"
import type { EventTemplate, NostrEvent as Event, VerifiedEvent } from "@nostr/tools/core"
import { generateSecretKey, getPublicKey } from "@nostr/tools/pure"
import { PlainKeySigner, type Signer } from "@nostr/tools/signer"
import { BunkerSigner, parseBunkerInput } from "@nostr/tools/nip46"
import * as nip19 from "@nostr/tools/nip19"
import { bytesToHex, hexToBytes, normalizeURL } from "@nostr/tools/utils"
import { save } from "./store"
import { emit } from "./state"

export const BIG_RELAYS = ["wss://relay.damus.io/", "wss://nos.lol/", "wss://relay.primal.net/"]
export const PROFILE_RELAYS = [...BIG_RELAYS, "wss://purplepag.es/"]
// where our profile and our list of forums always go, besides the servers of
// the forums themselves
export const ANNOUNCE_RELAYS = ["wss://relay.ditto.pub/", "wss://relay.primal.net/", "wss://nostr.mom/", "wss://nos.lol/"]

// ─── account ───────────────────────────────────────────────────
// Kept in localStorage. "nsec" is the key this browser made (or one pasted
// in); "bunker" signs remotely through NIP-46, which is what a Google login
// through Pomegranate gives us.

type StoredAccount =
    { type: "nsec"; sk: string; created: boolean } | { type: "bunker"; bunker: string; clientSk: string; pubkey: string }

function readJSON<T>(key: string): T | null {
    try {
        const raw = localStorage.getItem(key)
        return raw ? (JSON.parse(raw) as T) : null
    } catch {
        return null
    }
}

function writeJSON(key: string, value: unknown) {
    try {
        if (value === null) localStorage.removeItem(key)
        else localStorage.setItem(key, JSON.stringify(value))
    } catch { }
}

const storedAccount = readJSON<StoredAccount>("account")
let account: StoredAccount = storedAccount ?? newLocalAccount()
let signer: Signer
export let me: string
// for a "bunker" account, connected the first time something needs signing
let bunker: BunkerSigner | null = null

// A key generated for this page load still lets the rest of the modules run,
// but only a key read from storage means the person is logged in.
export const loggedIn = storedAccount !== null

function newLocalAccount(): StoredAccount {
    return { type: "nsec", sk: bytesToHex(generateSecretKey()), created: true }
}

function setupSigner() {
    if (account.type === "nsec") {
        const sk = hexToBytes(account.sk)
        signer = new PlainKeySigner(sk)
        me = getPublicKey(sk)
    } else {
        me = account.pubkey
        signer = {
            getPublicKey: async () => me,
            signEvent: signWithBunker
        }
    }
}
setupSigner()

async function signWithBunker(evt: EventTemplate): Promise<VerifiedEvent> {
    if (account.type !== "bunker") throw new Error("not a bunker account")
    if (!bunker) {
        const bp = await parseBunkerInput(account.bunker)
        if (!bp) throw new Error("invalid bunker url")
        bunker = BunkerSigner.fromBunker(hexToBytes(account.clientSk), bp, { pool })
        await bunker.connect().catch(() => { })
    }
    return bunker.signEvent(evt)
}

export function accountType(): "nsec" | "bunker" {
    return account.type
}

export function localSecretKey(): Uint8Array | null {
    return account.type === "nsec" ? hexToBytes(account.sk) : null
}

export function nsec(): string | null {
    const sk = localSecretKey()
    return sk ? nip19.nsecEncode(sk) : null
}

function switchAccount(acc: StoredAccount) {
    writeJSON("account", acc)
    writeJSON("pendingName", null)
    writeJSON("pomegranate", null)
    location.reload()
}

export function useSecretKey(input: string) {
    let sk: Uint8Array
    input = input.trim()
    if (input.startsWith("nsec1")) {
        const d = nip19.decode(input)
        if (d.type !== "nsec") throw new Error("not an nsec")
        sk = d.data
    } else if (/^[0-9a-f]{64}$/.test(input)) {
        sk = hexToBytes(input)
    } else throw new Error("paste an nsec1… or a hex secret key")
    switchAccount({ type: "nsec", sk: bytesToHex(sk), created: false })
}

export async function useBunker(input: string, beforeSwitch?: () => void) {
    const bp = await parseBunkerInput(input.trim())
    if (!bp) throw new Error("invalid bunker url")
    const clientSk = generateSecretKey()
    const bunker = BunkerSigner.fromBunker(clientSk, bp, { pool })
    await bunker.connect()
    const pubkey = await bunker.getPublicKey()
    await bunker.close()
    beforeSwitch?.()
    const acc: StoredAccount = { type: "bunker", bunker: input.trim(), clientSk: bytesToHex(clientSk), pubkey }
    writeJSON("account", acc)
    writeJSON("pendingName", null)
    location.reload()
}

export function createAccount(name: string) {
    writeJSON("account", newLocalAccount())
    writeJSON("pendingName", name)
    writeJSON("pomegranate", null)
    try {
        localStorage.setItem("welcomed", "1")
    } catch { }
    location.reload()
}

export function logout() {
    writeJSON("account", null)
    writeJSON("pendingName", null)
    writeJSON("pomegranate", null)
    location.href = "/"
}

// ─── pomegranate (google) link state ───────────────────────────
export type PomegranateLink = { token: string; central: string; email: string }

export function pomegranateLink(): PomegranateLink | null {
    return readJSON<PomegranateLink>("pomegranate")
}

export function setPomegranateLink(link: PomegranateLink | null) {
    writeJSON("pomegranate", link)
    emit()
}

// ─── server auth ───────────────────────────────────────────────
// NIP-29 servers ask for AUTH to read private groups and to accept writes.
export const authRelays = new Set<string>()

export const onauth = (evt: EventTemplate): Promise<VerifiedEvent> => signer.signEvent(evt)

pool.automaticallyAuth = (url: string) => (authRelays.has(url) ? onauth : null)

// ─── names ─────────────────────────────────────────────────────
// The name a person has before publishing their first kind:0.
export function pendingName(): string | null {
    return readJSON<string>("pendingName")
}

export function profileRelays(): string[] {
    return [...new Set([...PROFILE_RELAYS, ...authRelays])]
}

// Our profile and our forum list go to the servers of every forum we're in, so
// the people there can find them, and to a few big relays. Without a list of
// servers given, that's those in our forum list plus any forum opened here (a
// new account's first post may be the join through an invite).
export async function announceRelays(groupRelays?: string[]): Promise<string[]> {
    if (!groupRelays) {
        groupRelays = [...authRelays]
        try {
            const list = await loadSimpleGroups(me)
            groupRelays.push(...list.items.map(i => i.relay))
        } catch { }
    }
    return [
        ...new Set(
            [...groupRelays, ...ANNOUNCE_RELAYS, ...PROFILE_RELAYS, ...(await myWriteRelays())]
                .filter(Boolean)
                .map(r => normalizeURL(r))
        )
    ]
}

export async function setProfileName(name: string) {
    const current = await loadUser({ pubkey: me, relays: profileRelays() })
    const metadata = { ...current.metadata, name }
    await publishProfile(metadata)
}

async function publishProfile(metadata: Record<string, unknown>) {
    const evt = await signer.signEvent({
        kind: 0,
        created_at: now(),
        tags: [],
        content: JSON.stringify(metadata)
    })
    await loadUser({ pubkey: me, refreshStyle: evt })
    writeJSON("pendingName", null)
    emit()
    await anySuccess(pool.publish(await announceRelays(), evt, { onauth }))
}

// Before the first thing a new key writes, give it a name and a server list so
// others can find out who it is.
export async function ensureProfile() {
    const pending = pendingName()
    if (!pending) return
    await publishProfile({ name: pending })
}

// ─── publishing ────────────────────────────────────────────────
export const now = () => Math.floor(Date.now() / 1000)

export async function sign(template: EventTemplate): Promise<Event> {
    return signer.signEvent(template)
}

export async function anySuccess(attempts: Promise<string>[]): Promise<void> {
    const results = await Promise.allSettled(attempts)
    if (results.some(r => r.status === "fulfilled")) return
    const reasons = results.map(r => (r.status === "rejected" ? String(r.reason?.message ?? r.reason) : ""))
    throw new Error(reasons.filter(Boolean).join("; ") || "no server accepted the event")
}

// Signs, publishes to the server and only then keeps it locally: a group
// server that refuses the event is the authority on whether it exists.
export async function publishToRelay(relay: string, template: EventTemplate): Promise<Event> {
    await ensureProfile()
    const evt = await signer.signEvent(template)
    authRelays.add(relay)
    await anySuccess(pool.publish([relay], evt, { onauth }))
    await save(evt)
    return evt
}

export async function myWriteRelays(): Promise<string[]> {
    try {
        const list = await loadRelayList(me)
        const writes = list.items.filter(r => r.write).map(r => r.url)
        if (writes.length) return [...new Set([...writes, ...BIG_RELAYS])]
    } catch { }
    return BIG_RELAYS
}
