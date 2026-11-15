import type { NostrEvent } from "@nostr/tools/core"
import { For, createEffect, createMemo, createSignal, on } from "solid-js"
import { allGroups, type Group } from "../groups"
import { me } from "../nostr"
import { useChanges } from "../state"
import { ago, displayName, navigate, snippet, titleOf } from "./common"
import { desktopAlertsActive } from "./preferences"

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

// Desktop alerts for notifications that arrive while the tab is in the
// background. The watcher lives for the whole app, not just the notifications
// page, and only announces events that are new since the tab opened.
export function watchDesktopAlerts() {
  const known = new Set<string>()
  const startedAt = Math.floor(Date.now() / 1000)
  let primed = false

  createEffect(() => {
    useChanges()
    const notes = collect()
    const fresh = notes.filter(n => !known.has(n.evt.id))
    for (const n of notes) known.add(n.evt.id)

    if (!primed) {
      primed = true
      return
    }
    if (!fresh.length || !document.hidden || !desktopAlertsActive()) return

    const live = fresh.filter(n => n.evt.created_at >= startedAt)
    if (!live.length) return
    showDesktopAlert(live)
  })
}

function showDesktopAlert(notes: Note[]) {
  const newest = notes[0]
  const who = displayName(newest.evt.pubkey, [newest.g.relay])
  const thread = newest.root ? titleOf(newest.root) : "a thread"
  const action =
    newest.kind === "mention"
      ? `mentioned you in “${thread}”`
      : newest.kind === "reply"
        ? `replied to you in “${thread}”`
        : `commented on your thread “${thread}”`
  const title = notes.length === 1 ? action : `${notes.length} new notifications`
  const body =
    notes.length === 1 ? `${who}: ${snippet(newest.evt.content, 140)}` : `${who} and ${notes.length - 1} more`

  try {
    const alert = new Notification(title, { body, tag: "forum-notification" })
    alert.onclick = () => {
      window.focus()
      navigate(noteURL(newest))
      alert.close()
    }
  } catch {
    // Notifications can be unavailable even when permission is granted.
  }
}

function noteURL(n: Note): string {
  const rootId = n.root?.id ?? n.evt.tags.find(t => t[0] === "E")?.[1]
  if (!rootId || !n.g.naddr) return "/notifications"
  return `/${n.g.naddr}/${rootId}#c${n.evt.id}`
}

export function Notifications() {
  const [seen] = createSignal<number>(seenUntil())
  const notes = createMemo(() => {
    useChanges()
    return collect()
  })

  createEffect(
    on(
      () => notes()[0]?.evt.id,
      () => {
        const newest = notes()[0]?.evt.created_at ?? 0
        if (newest > seenUntil()) {
          try {
            localStorage.setItem("notificationsSeen", String(newest))
          } catch {}
        }
      }
    )
  )

  const unread = createMemo(() => notes().filter(n => n.evt.created_at > seen()))
  const earlier = createMemo(() =>
    notes()
      .filter(n => n.evt.created_at <= seen())
      .slice(0, 100)
  )

  return (
    <div class="notifications-page">
      <div class="pagehead">
        <h1 class="pt">
          <span class="p">~/</span>notifications
        </h1>
      </div>
      {unread().length > 0 && (
        <>
          <div class="label section-label">unread · {unread().length}</div>
          <ol class="nl">
            <For each={unread()}>{n => <Item n={n} unread />}</For>
          </ol>
        </>
      )}
      {earlier().length > 0 && (
        <>
          <div class="label section-label earlier-label">earlier</div>
          <ol class="nl">
            <For each={earlier()}>{n => <Item n={n} />}</For>
          </ol>
        </>
      )}
      {!notes().length && <p>No notifications yet.</p>}
    </div>
  )
}

function Item(props: { n: Note; unread?: boolean }) {
  const n = props.n
  const label = n.kind
  const title = n.root ? titleOf(n.root) : "a thread"
  const rootId = n.evt.tags.find(t => t[0] === "E")?.[1]
  const who = createMemo(() => {
    useChanges()
    return displayName(n.evt.pubkey, [n.g.relay])
  })
  return (
    <li class={"n" + (props.unread ? " un" : "")}>
      <span
        class={"dot" + (props.unread ? "" : " dot-empty")}
        aria-label={props.unread ? "unread" : undefined}
        aria-hidden={!props.unread}
      ></span>
      <span class="kind">{label}</span>
      <div class="n-body">
        <a class="what" href={`/${n.g.naddr}/${rootId}#c${n.evt.id}`}>
          <span class="who">
            <span class="u">{who()}</span>
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
