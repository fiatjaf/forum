import type { NostrEvent as Event } from "@nostr/tools/core"
import * as nip19 from "@nostr/tools/nip19"
import { For, createMemo } from "solid-js"
import { KIND_COMMENT, allGroups, type Group } from "../groups"
import { me } from "../account"
import { useChanges } from "../state"
import { ago, displayName, getUser, plural, snippet, titleOf } from "./common"

function decodePubkey(code: string): string | null {
  try {
    const d = nip19.decode(code)
    if (d.type === "npub") return d.data
    if (d.type === "nprofile") return d.data.pubkey
  } catch {}
  return null
}

export function Profile(props: { code: string }) {
  const pubkey = decodePubkey(props.code)
  if (!pubkey) return <p>That isn't a valid profile link.</p>
  const isMe = pubkey === me

  const user = createMemo(() => {
    useChanges()
    return getUser(pubkey)
  })
  const name = createMemo(() => {
    useChanges()
    return displayName(pubkey)
  })

  // everything this person wrote in the forums this browser holds
  const activity = createMemo(() => {
    useChanges()
    const threads: [Group, Event][] = []
    const comments: [Group, Event][] = []
    for (const g of allGroups()) {
      for (const t of g.threads.values()) if (t.pubkey === pubkey && !g.isDeleted(t)) threads.push([g, t])
      for (const c of g.comments.values()) if (c.pubkey === pubkey && !g.isDeleted(c)) comments.push([g, c])
    }
    threads.sort((a, b) => b[1].created_at - a[1].created_at)
    comments.sort((a, b) => b[1].created_at - a[1].created_at)
    return { threads, comments }
  })

  return (
    <div class="profile-page">
      <div class="pagehead">
        <h1 class="pt">
          <span class="p">~/</span>users/{name()}
        </h1>
      </div>
      <div class="meta">
        <span class="mono npub">{nip19.npubEncode(pubkey)}</span>
        {user().metadata.nip05 && (
          <>
            <span>·</span>
            <span>{user().metadata.nip05}</span>
          </>
        )}
      </div>
      {user().metadata.about && <p class="profile-about">{user().metadata.about}</p>}

      {isMe && (
        <p class="hint">
          This is your public profile.{" "}
          <a class="accent" href="/account">
            manage your account ›
          </a>
        </p>
      )}

      <div class="search-summary">
        <span class="label">threads</span>
        <span class="label">newest first</span>
      </div>
      {activity().threads.length ? (
        <ol class="rl">
          <For each={activity().threads.slice(0, 50)}>
            {([g, t]) => {
              const count = () => {
                useChanges()
                return g.commentCount(t.id)
              }
              const forum = () => {
                useChanges()
                return g.name
              }
              return (
                <li class="r">
                  <span class="ty t">thread</span>
                  <div class="search-result-body">
                    <a class="tt" href={`/${g.naddr}/${t.id}`}>
                      {titleOf(t)}
                    </a>
                    <div class="meta">
                      <span>{forum()}</span>
                      <span>·</span>
                      <span>{ago(t.created_at)}</span>
                      <span>·</span>
                      <a href={`/${g.naddr}/${t.id}#comments`}>{plural(count(), "comment")}</a>
                    </div>
                  </div>
                </li>
              )
            }}
          </For>
        </ol>
      ) : (
        <p class="hint">No threads here yet.</p>
      )}

      <div class="search-summary">
        <span class="label">comments</span>
        <span class="label">newest first</span>
      </div>
      {activity().comments.length ? (
        <ol class="rl">
          <For each={activity().comments.slice(0, 50)}>
            {([g, c]) => {
              const rootId = c.tags.find(t => t[0] === "E")?.[1]
              const root = rootId ? g.threads.get(rootId) : undefined
              return (
                <li class="r">
                  <span class="ty">comment</span>
                  <div class="search-result-body">
                    <div class="ctx">
                      in <a href={`/${g.naddr}/${rootId}`}>{root ? titleOf(root) : "a thread"}</a> · {g.name}
                    </div>
                    {c.kind === KIND_COMMENT && <div class="snip">{snippet(c.content)}</div>}
                    <div class="meta">
                      <span>{ago(c.created_at)}</span>
                      <span>·</span>
                      <a href={`/${g.naddr}/${rootId}#c${c.id}`}>open comment ›</a>
                    </div>
                  </div>
                </li>
              )
            }}
          </For>
        </ol>
      ) : (
        <p class="hint">No comments here yet.</p>
      )}
    </div>
  )
}
