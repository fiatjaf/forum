import { pool } from "@nostr/gadgets/global"
import type { NostrEvent } from "@nostr/tools/core"
import * as nip19 from "@nostr/tools/nip19"
import { useEffect, useState } from "preact/hooks"
import { KIND_COMMENT, KIND_THREAD, getGroup, normalizeRelay, relaySelf } from "../groups"
import { authRelays, onauth } from "../nostr"
import { query, save } from "../store"
import { navigate } from "./common"

// A nevent pointing at a forum thread or comment: find it on the hinted relay,
// work out its group from the "h" tag and go to the thread inside the forum,
// where the whole group gets loaded.
async function resolve(code: string): Promise<string> {
  const d = nip19.decode(code)
  if (d.type !== "nevent") throw new Error("only nevent links can be opened here")
  const { id, relays = [] } = d.data
  if (!relays.length) throw new Error("this link has no relay hint, so there's no way to tell which forum it's from")

  let found: { evt: NostrEvent; relay: string } | null = null
  const [local] = await query({ ids: [id] }, 1)
  for (const url of relays.map(normalizeRelay)) {
    authRelays.add(url)
    const evt =
      local ??
      (await pool.get([url], { ids: [id] }, { maxWait: 8000, onauth } as any).catch(() => null))
    if (evt) {
      found = { evt, relay: url }
      break
    }
  }
  if (!found) throw new Error("couldn't find the event on the relays the link names")

  const { evt, relay } = found
  if (evt.kind !== KIND_THREAD && evt.kind !== KIND_COMMENT) throw new Error("this isn't a forum thread or comment")
  const h = evt.tags.find(t => t[0] === "h")?.[1]
  if (!h) throw new Error("this isn't from a forum (no group tag)")
  await save(evt)

  const relayPubkey = await relaySelf(relay)
  const g = getGroup({ id: h, relay, relayPubkey })
  if (evt.kind === KIND_THREAD) return `/${g.naddr}/${evt.id}`
  const root = evt.tags.find(t => t[0] === "E")?.[1]
  if (!root) throw new Error("this comment doesn't say which thread it belongs to")
  return `/${g.naddr}/${root}#c${evt.id}`
}

export function Resolve({ code }: { code: string }) {
  const [error, setError] = useState("")
  useEffect(() => {
    resolve(code).then(
      path => navigate(path, true),
      err => setError(String(err?.message ?? err))
    )
  }, [code])
  return (
    <div>
      <div class="pagehead">
        <h1 class="pt">
          <span class="p">~/</span>opening…
        </h1>
      </div>
      {error ? (
        <p class="err" role="alert">
          {error}
        </p>
      ) : (
        <p class="hint">Looking up the thread…</p>
      )}
    </div>
  )
}
