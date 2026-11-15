// Linking a key to a Google account through Pomegranate: the key is split
// across operators, so a Google login elsewhere can sign with it again (as a
// NIP-46 bunker). Adapted from hallway's google-login.service.ts.
import { trustedKeyDeal, hexShard, hexPubShard } from "@fiatjaf/promenade-trusted-dealer"
import { argon2id } from "@noble/hashes/argon2.js"
import { sha256 } from "@noble/hashes/sha2.js"
import { bytesToHex } from "@noble/hashes/utils.js"
import { pool } from "@nostr/gadgets/global"
import { finalizeEvent, generateSecretKey, getPublicKey } from "@nostr/tools/pure"
import { BIG_RELAYS, myWriteRelays } from "./nostr"

export const CENTRAL = "https://auth.njump.me"
export const OPERATORS = [
  "https://po.njump.me",
  "https://po.f7z.io",
  "https://po.jumble.social",
  "https://po.coracle.social",
  "https://po.yakihonne.com"
]

const KIND_SETUP_ANNOUNCEMENT = 16440
const utf8 = new TextEncoder()

export function tokenEmail(token: string): string {
  try {
    const parsed = JSON.parse(atob(token)) as { tags?: string[][] }
    return parsed.tags?.find(t => t[0] === "email" && typeof t[1] === "string")?.[1] ?? ""
  } catch {
    return ""
  }
}

const emailHash = (email: string) =>
  bytesToHex(argon2id(utf8.encode(email), "pomegranate", { t: 1, m: 65536, p: 4 }))

async function assertOk(resp: Response, label: string) {
  if (resp.ok) return
  const body = await resp.text().catch(() => "")
  throw new Error(`${label} failed (${resp.status})${body ? `: ${body.slice(0, 200)}` : ""}`)
}

async function announcedCentral(email: string): Promise<string | null> {
  if (!email) return null
  try {
    const results = await pool.querySync(
      BIG_RELAYS,
      { kinds: [KIND_SETUP_ANNOUNCEMENT], "#m": [emailHash(email)], limit: 1 },
      { maxWait: 5000 }
    )
    return results[0]?.tags.find(t => t[0] === "central")?.[1] ?? null
  } catch {
    return null
  }
}

export function googleLogin(central = CENTRAL): Promise<string> {
  const popup = window.open(`${central}/login/google`, "PomegranateOAuth", "width=600,height=600")
  if (!popup) return Promise.reject(new Error("the popup was blocked"))

  return new Promise<string>((resolve, reject) => {
    let settled = false
    const monitor = window.setInterval(() => {
      if (!settled && popup.closed) finish(null, new Error("login cancelled"))
    }, 250)
    function finish(value: string | null, err?: Error) {
      if (settled) return
      settled = true
      window.clearInterval(monitor)
      window.removeEventListener("message", handler)
      if (err) reject(err)
      else resolve(value!)
    }
    function handler(event: MessageEvent) {
      if (event.origin !== central || event.source !== popup || !event.data?.token) return
      popup!.close()
      finish(event.data.token as string)
    }
    window.addEventListener("message", handler)
  })
}

async function fetchAccount(central: string, token: string): Promise<{ pubkey: string } | null> {
  const resp = await fetch(`${central}/account`, { headers: { Authorization: "Token " + token } })
  if (resp.status === 404) return null
  await assertOk(resp, "central /account")
  return resp.json()
}

async function waitForAccount(central: string, token: string, log: (m: string) => void) {
  for (let i = 0; i < 15; i++) {
    const account = await fetchAccount(central, token)
    if (account) return account
    log("waiting for the operators to confirm…")
    await new Promise(r => setTimeout(r, 2000))
  }
  throw new Error("the operators never confirmed the account")
}

async function register(central: string, token: string, email: string, secretKey: Uint8Array, log: (m: string) => void) {
  const operators = OPERATORS
  const threshold = Math.ceil((operators.length * 7) / 12)
  const session = crypto.randomUUID()
  const masterSk = Array.from(secretKey).reduce((acc, byte) => (acc << 8n) + BigInt(byte), 0n)
  const { shards } = trustedKeyDeal(masterSk, threshold, operators.length)

  log("registering with central…")
  const reg = finalizeEvent(
    {
      kind: 20445,
      created_at: Math.floor(Date.now() / 1000),
      tags: [["threshold", String(threshold)], ...operators.map((op, i) => ["operator", op, hexPubShard(shards[i].pubShard)])],
      content: ""
    },
    secretKey
  )
  await assertOk(
    await fetch(`${central}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Token " + token, "X-Pomegranate-Session": session },
      body: JSON.stringify(reg)
    }),
    "central /register"
  )

  for (let i = 0; i < operators.length; i++) {
    const op = operators[i]
    log(`handing a shard to ${new URL(op).host}…`)
    const evt = finalizeEvent(
      {
        kind: 20444,
        created_at: Math.floor(Date.now() / 1000),
        tags: [["central", central], ["email", email]],
        content: hexShard(shards[i])
      },
      secretKey
    )
    await assertOk(
      await fetch(`${op}/po/register`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Pomegranate-Operator-Token": bytesToHex(sha256(utf8.encode(session + ":" + op)))
        },
        body: JSON.stringify(evt)
      }),
      `${op} /register`
    )
  }

  log("announcing the setup…")
  const announcement = finalizeEvent(
    {
      kind: KIND_SETUP_ANNOUNCEMENT,
      created_at: Math.floor(Date.now() / 1000),
      tags: [["m", emailHash(email)], ["central", central]],
      content: ""
    },
    secretKey
  )
  await Promise.allSettled(pool.publish([...BIG_RELAYS, ...(await myWriteRelays())], announcement))
}

export async function defaultBunker(central: string, token: string): Promise<string> {
  const list = async (): Promise<any[]> => {
    const resp = await fetch(`${central}/profiles`, { headers: { Authorization: "Token " + token } })
    await assertOk(resp, "central /profiles")
    const profiles = await resp.json()
    return Array.isArray(profiles) ? profiles : []
  }
  let profile = (await list()).find(p => p?.name === "default")
  if (!profile) {
    await assertOk(
      await fetch(`${central}/profiles`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Token " + token },
        body: JSON.stringify({ name: "default" })
      }),
      "profile creation"
    )
    profile = (await list()).find(p => p?.name === "default")
  }
  if (!profile?.handler_pubkey) throw new Error("central did not return a default signing profile")
  return `bunker://${profile.handler_pubkey}?relay=${encodeURIComponent(central.replace(/^http/, "ws"))}`
}

// Logs in with Google and makes sure the account behind it holds secretKey
// (registering it when there is no account yet). Without a secretKey, a new
// key is made for a new account, or the existing account is used as it is.
// Answers where it ended up, with a bunker that signs as that account.
export async function linkGoogle(
  secretKey: Uint8Array | null,
  log: (m: string) => void
): Promise<{ token: string; central: string; email: string; bunker: string; pubkey: string }> {
  let central = CENTRAL
  log("opening the Google login…")
  let token = await googleLogin(central)
  let email = tokenEmail(token)

  log("checking for an account…")
  let account = await fetchAccount(central, token)
  if (!account) {
    const elsewhere = await announcedCentral(email)
    if (elsewhere && elsewhere !== central) {
      central = elsewhere
      log(`this email is set up at ${new URL(central).host}, logging in there…`)
      token = await googleLogin(central)
      email = tokenEmail(token)
      account = await fetchAccount(central, token)
    }
  }

  if (account && secretKey && account.pubkey !== getPublicKey(secretKey)) {
    throw new Error(`${email || "this Google account"} is already linked to another key`)
  }

  if (!account) {
    await register(central, token, email, secretKey ?? generateSecretKey(), log)
    account = await waitForAccount(central, token, log)
  }

  log("getting the signing profile…")
  const bunker = await defaultBunker(central, token)
  return { token, central, email, bunker, pubkey: account.pubkey }
}
