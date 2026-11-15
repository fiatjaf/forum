import { useEffect, useState } from "preact/hooks"
import { getGroup, myGroups, myGroupsLoaded, normalizeRelay, relaySelf, type Group } from "../groups"
import { emit } from "../state"
import { ago, navigate, plural } from "./common"

export function Home() {
  const groups = myGroups.map(item => getGroup({ id: item.groupId, relay: normalizeRelay(item.relay) }))

  // a 10009 entry doesn't say what the relay's key is, and links need it
  useEffect(() => {
    for (const g of groups) {
      if (g.relayPubkey) continue
      relaySelf(g.relay)
        .then(pk => {
          if (!g.relayPubkey) g.relayPubkey = pk
          emit()
        })
        .catch(() => {})
    }
  }, [groups.length])

  const sorted = [...groups].sort((a, b) => lastActivity(b) - lastActivity(a))

  return (
    <div class="front-page">
      <div class="pagehead">
        <h1 class="pt">
          <span class="p">~/</span>forums
        </h1>
      </div>

      {sorted.length ? (
        <ol class="list">
          {sorted.map(g => (
            <GroupRow key={g.relay + g.id} group={g} />
          ))}
        </ol>
      ) : myGroupsLoaded ? (
        <p>
          You're not in any forum yet. <a href="/new">Start one</a>, or open one below.
        </p>
      ) : (
        <p class="hint">Loading your forums…</p>
      )}

      <OpenForum />
    </div>
  )
}

function lastActivity(g: Group): number {
  let last = 0
  for (const t of g.visibleThreads()) last = Math.max(last, g.lastActivity(t))
  return last
}

function GroupRow({ group: g }: { group: Group }) {
  const threads = g.visibleThreads().length
  const last = lastActivity(g)
  const host = g.relay.replace(/^wss?:\/\//, "").replace(/\/$/, "")
  const href = g.naddr ? `/${g.naddr}` : undefined
  return (
    <li class="row">
      <div class="vc">
        {g.metadata?.picture ? <img class="forum-pic" src={g.metadata.picture} alt="" /> : <span class="forum-pic none" aria-hidden="true"></span>}
      </div>
      <div class="thread-cell">
        <a class="tt" href={href}>
          {g.name}
        </a>
        {g.metadata?.isPrivate && <span class="flag">private</span>}
        {g.metadata?.isClosed && <span class="flag">closed</span>}
        <div class="meta">
          <span>{host}</span>
          <span>·</span>
          <span>{plural(threads, "thread")}</span>
          {g.metadata?.about && (
            <>
              <span>·</span>
              <span class="about">{g.metadata.about}</span>
            </>
          )}
          {g.syncError && (
            <>
              <span>·</span>
              <span class="gone">{g.syncError}</span>
            </>
          )}
        </div>
      </div>
      <span class="act">{last ? ago(last) : ""}</span>
    </li>
  )
}

function OpenForum() {
  const [value, setValue] = useState("")
  const [error, setError] = useState("")
  return (
    <form
      class="open-forum"
      onSubmit={e => {
        e.preventDefault()
        const code = value.trim().replace(/^nostr:/, "").replace(/^https?:\/\/[^/]+\//, "")
        if (/^(naddr1|nevent1)/.test(code)) navigate("/" + code)
        else setError("Paste a forum link (naddr1…) or a thread link (nevent1…).")
      }}
    >
      <div class="field">
        <label for="open-forum">open a forum or thread</label>
        <div class="row-inline">
          <input id="open-forum" class="inp mono wide" value={value} onInput={e => setValue((e.target as HTMLInputElement).value)} placeholder="naddr1… or nevent1…" spellcheck={false} />
          <button class="btn" type="submit">
            open
          </button>
        </div>
      </div>
      {error && (
        <p class="err" role="alert">
          {error}
        </p>
      )}
    </form>
  )
}
