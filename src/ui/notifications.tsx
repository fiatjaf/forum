import type { NostrEvent } from "@nostr/tools/core"
import { useEffect, useState } from "preact/hooks"
import { allGroups, type Group } from "../groups"
import { me } from "../nostr"
import { ago, displayName, snippet, titleOf } from "./common"

type Note = { g: Group; evt: NostrEvent; kind: "reply" | "comment" | "mention"; root?: NostrEvent }

// Comments, in the forums this browser holds, that reply to me, land on my
// threads or mention me.
function collect(): Note[] {
  const notes: Note[] = []
  for (const g of allGroups()) {
    for (const c of g.comments.values()) {
      if (c.pubkey === me || g.isDeleted(c)) continue
      const rootId = c.tags.find(t => t[0] === "E")?.[1]
      const root = rootId ? g.threads.get(rootId) : undefined
      const parentAuthor = c.tags.findLast(t => t[0] === "p")?.[1]
      const parentId = c.tags.findLast(t => t[0] === "e")?.[1]
      let kind: Note["kind"] | null = null
      if (parentId && parentId !== rootId && g.comments.get(parentId)?.pubkey === me) kind = "reply"
      else if (root?.pubkey === me) kind = "comment"
      else if (c.tags.some(t => t[0] === "p" && t[1] === me) && parentAuthor !== me) kind = "mention"
      if (kind) notes.push({ g, evt: c, kind, root })
    }
  }
  return notes.sort((a, b) => b.evt.created_at - a.evt.created_at)
}

function seenUntil(): number {
  return parseInt(localStorage.getItem("notificationsSeen") || "0") || 0
}

export function unreadNotifications(): number {
  const seen = seenUntil()
  return collect().filter(n => n.evt.created_at > seen).length
}

export function Notifications() {
  const [seen] = useState(seenUntil)
  const notes = collect()

  useEffect(() => {
    const newest = notes[0]?.evt.created_at ?? 0
    if (newest > seenUntil()) {
      try {
        localStorage.setItem("notificationsSeen", String(newest))
      } catch {}
    }
  }, [notes[0]?.evt.id])

  const unread = notes.filter(n => n.evt.created_at > seen)
  const earlier = notes.filter(n => n.evt.created_at <= seen).slice(0, 100)

  return (
    <div class="notifications-page">
      <div class="pagehead">
        <h1 class="pt">
          <span class="p">~/</span>notifications
        </h1>
      </div>
      {unread.length > 0 && (
        <>
          <div class="label section-label">unread · {unread.length}</div>
          <ol class="nl">
            {unread.map(n => (
              <Item key={n.evt.id} n={n} unread />
            ))}
          </ol>
        </>
      )}
      {earlier.length > 0 && (
        <>
          <div class="label section-label earlier-label">earlier</div>
          <ol class="nl">
            {earlier.map(n => (
              <Item key={n.evt.id} n={n} />
            ))}
          </ol>
        </>
      )}
      {!notes.length && <p>No notifications yet.</p>}
    </div>
  )
}

function Item({ n, unread }: { n: Note; unread?: boolean }) {
  const label = n.kind
  const title = n.root ? titleOf(n.root) : "a thread"
  const rootId = n.evt.tags.find(t => t[0] === "E")?.[1]
  return (
    <li class={"n" + (unread ? " un" : "")}>
      <span class={"dot" + (unread ? "" : " dot-empty")} aria-label={unread ? "unread" : undefined} aria-hidden={!unread}></span>
      <span class="kind">{label}</span>
      <div class="n-body">
        <a class="what" href={`/${n.g.naddr}/${rootId}#c${n.evt.id}`}>
          <span class="who">
            <span class="u">{displayName(n.evt.pubkey, [n.g.relay])}</span>
            <span class="kind-inline">{label}</span>
          </span>
          <span class="action">
            {n.kind === "mention"
              ? `mentioned you in “${title}”`
              : n.kind === "reply"
                ? `replied to your comment in “${title}”`
                : `commented on your thread “${title}”`}
          </span>
        </a>
        <div class="snip">{snippet(n.evt.content)}</div>
      </div>
      <time>{ago(n.evt.created_at)}</time>
    </li>
  )
}
