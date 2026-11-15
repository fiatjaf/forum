import { pool } from "@nostr/gadgets/global"
import { loadNostrUser } from "@nostr/gadgets/metadata"
import { loadRelayList } from "@nostr/gadgets/lists"
import type { EventTemplate, NostrEvent, VerifiedEvent } from "@nostr/tools/core"
import { generateSecretKey, getPublicKey } from "@nostr/tools/pure"
import { PlainKeySigner, type Signer } from "@nostr/tools/signer"
import { BunkerSigner, parseBunkerInput } from "@nostr/tools/nip46"
import * as nip19 from "@nostr/tools/nip19"
import { bytesToHex, hexToBytes } from "@nostr/tools/utils"
import { haikuName } from "./haiku"
import { save } from "./store"
import { emit } from "./state"

export const BIG_RELAYS = ["wss://relay.damus.io/", "wss://nos.lol/", "wss://relay.primal.net/"]
export const PROFILE_RELAYS = [...BIG_RELAYS, "wss://purplepag.es/"]

// ─── account ───────────────────────────────────────────────────
// Kept in localStorage. "nsec" is the key this browser made (or one pasted
// in); "bunker" signs remotely through NIP-46, which is what a Google login
// through Pomegranate gives us.

type StoredAccount =
  | { type: "nsec"; sk: string; created: boolean }
  | { type: "bunker"; bunker: string; clientSk: string; pubkey: string }

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
  } catch {}
}

let account: StoredAccount = readJSON<StoredAccount>("account") ?? newLocalAccount()
let signer: Signer
export let me: string

function newLocalAccount(): StoredAccount {
  const acc: StoredAccount = { type: "nsec", sk: bytesToHex(generateSecretKey()), created: true }
  writeJSON("account", acc)
  // a name for this key until the person picks one; published on first write
  writeJSON("pendingName", haikuName())
  return acc
}

function setupSigner() {
  if (account.type === "nsec") {
    const sk = hexToBytes(account.sk)
    signer = new PlainKeySigner(sk)
    me = getPublicKey(sk)
  } else {
    me = account.pubkey
    const clientSk = hexToBytes(account.clientSk)
    let bunker: BunkerSigner | null = null
    signer = {
      getPublicKey: async () => me,
      async signEvent(evt) {
        if (!bunker) {
          const bp = await parseBunkerInput(account.type === "bunker" ? account.bunker : "")
          if (!bp) throw new Error("invalid bunker url")
          bunker = BunkerSigner.fromBunker(clientSk, bp, { pool })
          await bunker.connect().catch(() => {})
        }
        return bunker.signEvent(evt)
      }
    }
  }
}
setupSigner()

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
  location.href = "/"
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
  location.href = "/"
}

export function startFresh() {
  writeJSON("pomegranate", null)
  account = newLocalAccount()
  location.href = "/"
}

// ─── pomegranate (google) link state ───────────────────────────
export type PomegranateLink = { token: string; central: string; email: string }

export function pomegranateLink(): PomegranateLink | null {
  return readJSON<PomegranateLink>("pomegranate")
}

export function setPomegranateLink(link: PomegranateLink | null) {
  writeJSON("pomegranate", link)
}

// ─── relay auth ────────────────────────────────────────────────
// NIP-29 relays ask for AUTH to read private groups and to accept writes.
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

export async function setProfileName(name: string) {
  const current = await loadNostrUser({ pubkey: me, relays: profileRelays() })
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
  await loadNostrUser({ pubkey: me, refreshStyle: evt })
  writeJSON("pendingName", null)
  emit()
  await anySuccess(pool.publish(profileRelays(), evt, { onauth }))
}

// Before the first thing a new key writes, give it a name and a relay list so
// others can find out who it is.
export async function ensureProfile() {
  const pending = pendingName()
  if (!pending) return
  await publishProfile({ name: pending })
  if (account.type === "nsec" && account.created) {
    const relays = await signer.signEvent({
      kind: 10002,
      created_at: now(),
      tags: BIG_RELAYS.map(url => ["r", url]),
      content: ""
    })
    await save(relays)
    await anySuccess(pool.publish(PROFILE_RELAYS, relays))
  }
}

// ─── publishing ────────────────────────────────────────────────
export const now = () => Math.floor(Date.now() / 1000)

export async function sign(template: EventTemplate): Promise<NostrEvent> {
  return signer.signEvent(template)
}

export async function anySuccess(attempts: Promise<string>[]): Promise<void> {
  const results = await Promise.allSettled(attempts)
  if (results.some(r => r.status === "fulfilled")) return
  const reasons = results.map(r => (r.status === "rejected" ? String(r.reason?.message ?? r.reason) : ""))
  throw new Error(reasons.filter(Boolean).join("; ") || "no relay accepted the event")
}

// Signs, publishes to the relay and only then keeps it locally: a group
// relay that refuses the event is the authority on whether it exists.
export async function publishToRelay(relay: string, template: EventTemplate): Promise<NostrEvent> {
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
  } catch {}
  return BIG_RELAYS
}
