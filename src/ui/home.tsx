import { For, Show, createEffect, createMemo, createSignal, on } from "solid-js"
import { getGroup, myGroups, myGroupsLoaded, normalizeRelay, relaySelf, type Group } from "../groups"
import { emit, useChanges } from "../state"
import { ago, navigate, plural } from "./common"

export function Home() {
  const groups = createMemo(() => {
    useChanges()
    return myGroups.map(item => getGroup({ id: item.groupId, relay: normalizeRelay(item.relay) }))
  })

  // a 10009 entry doesn't say what the server's key is, and links need it
  createEffect(
    on(
      () => groups().length,
      () => {
        for (const g of groups()) {
          if (g.relayPubkey) continue
          relaySelf(g.relay)
            .then(pk => {
              if (!g.relayPubkey) g.relayPubkey = pk
              emit()
            })
            .catch(() => {})
        }
      }
    )
  )

  const sorted = createMemo(() => [...groups()].sort((a, b) => lastActivity(b) - lastActivity(a)))
  const anyForums = () => {
    useChanges()
    return myGroupsLoaded
  }

  return (
    <div class="front-page">
      <div class="pagehead">
        <h1 class="pt">
          <span class="p">~/</span>forums
        </h1>
      </div>

      {sorted().length ? (
        <ol class="list">
          <For each={sorted()}>{g => <GroupRow group={g} />}</For>
        </ol>
      ) : anyForums() ? (
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

function GroupRow(props: { group: Group }) {
  const g = props.group
  const info = createMemo(() => {
    useChanges()
    return {
      threads: g.visibleThreads().length,
      last: lastActivity(g),
      name: g.name,
      href: g.naddr ? `/${g.naddr}` : undefined,
      isPrivate: g.metadata?.isPrivate,
      isClosed: g.metadata?.isClosed,
      about: g.metadata?.about,
      picture: g.metadata?.picture,
      syncError: g.syncError
    }
  })
  const host = g.relay.replace(/^wss?:\/\//, "").replace(/\/$/, "")
  return (
    <li class="row">
      <div class="vc">
        <Show when={info().picture} fallback={<span class="forum-pic none" aria-hidden="true"></span>}>
          {picture => <img class="forum-pic" src={picture()} alt="" />}
        </Show>
      </div>
      <div class="thread-cell">
        <a class="tt" href={info().href}>
          {info().name}
        </a>
        {info().isPrivate && <span class="flag">private</span>}
        {info().isClosed && <span class="flag">closed</span>}
        <div class="meta">
          <span>{host}</span>
          <span>·</span>
          <span>{plural(info().threads, "thread")}</span>
          {info().about && (
            <>
              <span>·</span>
              <span class="about">{info().about}</span>
            </>
          )}
          {info().syncError && (
            <>
              <span>·</span>
              <span class="gone">{info().syncError}</span>
            </>
          )}
        </div>
      </div>
      <span class="act">{info().last ? ago(info().last) : ""}</span>
    </li>
  )
}

function OpenForum() {
  const [value, setValue] = createSignal("")
  const [error, setError] = createSignal("")
  return (
    <form
      class="open-forum"
      onSubmit={e => {
        e.preventDefault()
        const code = value()
          .trim()
          .replace(/^nostr:/, "")
          .replace(/^https?:\/\/[^/]+\//, "")
        if (/^(naddr1|nevent1)/.test(code)) navigate("/" + code)
        else setError("Paste a forum link (naddr1…) or a thread link (nevent1…).")
      }}
    >
      <div class="field">
        <label for="open-forum">open a forum or thread</label>
        <div class="row-inline">
          <input
            id="open-forum"
            class="inp mono wide"
            value={value()}
            onInput={e => setValue((e.target as HTMLInputElement).value)}
            placeholder="naddr1… or nevent1…"
            spellcheck={false}
          />
          <button class="btn" type="submit">
            open
          </button>
        </div>
      </div>
      {error() && (
        <p class="err" role="alert">
          {error()}
        </p>
      )}
    </form>
  )
}
