import type { NostrEvent } from "@nostr/tools/core"
import { useEffect, useRef, useState } from "preact/hooks"
import type { Group } from "../groups"
import { me } from "../nostr"
import { Counter, Djot, Editor, NoteContent, UserLink, VoteButton, ago, displayName, lastRead, markRead, navigate, plural, linkOf, titleOf } from "./common"
import { Membership } from "./forum"

const parentOf = (c: NostrEvent) => c.tags.findLast(t => t[0] === "e")?.[1]

export function ThreadPage({ group: g, id }: { group: Group; id: string }) {
  const thread = g.threads.get(id)
  const base = `/${g.naddr}`
  // what was read before this visit decides what shows as new
  const [readBefore] = useState(() => lastRead(id))
  const comments = g.threadComments(id)

  useEffect(() => {
    if (!thread) return
    const newest = Math.max(thread.created_at, ...comments.map(c => c.created_at))
    markRead(id, newest)
  }, [thread, comments.length])

  // jump to a linked comment once it is there
  const jumped = useRef(false)
  useEffect(() => {
    if (jumped.current || !location.hash) return
    const el = document.getElementById(location.hash.slice(1))
    if (el) {
      jumped.current = true
      el.scrollIntoView()
      el.classList.add("target")
    }
  })

  if (!thread) {
    return (
      <div class="thread-page">
        <a class="back" href={base}>
          ‹ ~/threads
        </a>
        <p class="hint">{g.syncing ? "Loading the thread…" : "Thread not found."}</p>
      </div>
    )
  }

  const deleted = g.isDeleted(thread)
  const link = linkOf(thread)
  const visible = comments.filter(c => !g.isDeleted(c))
  const score = g.voters(thread.id).size
  const voted = g.myVotes(thread.id).length > 0
  const canDelete = !deleted && (thread.pubkey === me || g.isAdmin())

  // children by parent; replies to unknown parents go to the top level
  const known = new Set(comments.map(c => c.id))
  const byParent = new Map<string, NostrEvent[]>()
  for (const c of comments) {
    let p = parentOf(c) ?? id
    if (p !== id && !known.has(p)) p = id
    const list = byParent.get(p) ?? []
    list.push(c)
    byParent.set(p, list)
  }
  const best = (a: NostrEvent, b: NostrEvent) => g.voters(b.id).size - g.voters(a.id).size || a.created_at - b.created_at
  for (const list of byParent.values()) list.sort(best)

  const ctx: Ctx = { g, thread, byParent, readBefore }

  return (
    <div class="thread-page">
      <a class="back" href={base}>
        ‹ ~/threads
      </a>

      <article class="thread" id={"t" + thread.id}>
        <div class="vc thread-vote">
          <VoteButton group={g} target={thread} size={12} />
          <span class={"score" + (voted ? " on" : "")}>{score}</span>
        </div>
        <div class="thread-main">
          <h1 class="thread-title">
            {deleted ? (
              "[deleted]"
            ) : link ? (
              <>
                <a href={link.url} rel="nofollow noopener" target="_blank">
                  {titleOf(thread)}
                </a>{" "}
                <span class="dom">{link.domain}</span>
              </>
            ) : (
              titleOf(thread)
            )}
          </h1>
          <div class="meta">
            <UserLink pubkey={thread.pubkey} group={g} />
            <span>·</span>
            <span title={new Date(thread.created_at * 1000).toLocaleString()}>{ago(thread.created_at)}</span>
            <span>·</span>
            <a href="#comments">{plural(visible.length, "comment")}</a>
            {canDelete && (
              <>
                <span>·</span>
                <button
                  class="inline-button"
                  type="button"
                  onClick={async () => {
                    if (!confirm("Delete this thread? This cannot be undone.")) return
                    try {
                      await g.deleteEvent(thread)
                      navigate(base)
                    } catch (err) {
                      alert(`Couldn't delete: ${(err as Error).message}`)
                    }
                  }}
                >
                  delete
                </button>
              </>
            )}
          </div>
          {!deleted && !link && thread.content.trim() && <Djot class="prose thread-body" text={thread.content} />}
        </div>
      </article>

      <Membership group={g} />

      <CommentForm g={g} thread={thread} parent={thread} />

      <div class="comments-head">
        <span class="label">{plural(visible.length, "comment")} · best first</span>
        <span class="sp"></span>
      </div>

      <section class="comments" aria-label="Comments">
        <ol class="comment-list" id="comments">
          {(byParent.get(id) ?? []).map(c => (
            <Comment key={c.id} c={c} ctx={ctx} />
          ))}
        </ol>
        {!comments.length && <p class="no-comments">No comments yet.</p>}
      </section>

      <div class="dock">
        <a class="fake" href="#comment-form" onClick={e => {
          e.preventDefault()
          document.querySelector<HTMLTextAreaElement>("#comment-form textarea")?.focus()
        }}>
          add a comment…
        </a>
      </div>
    </div>
  )
}

type Ctx = { g: Group; thread: NostrEvent; byParent: Map<string, NostrEvent[]>; readBefore?: number }

function Comment({ c, ctx }: { c: NostrEvent; ctx: Ctx }) {
  const { g, thread, byParent, readBefore } = ctx
  const [collapsed, setCollapsed] = useState(false)
  const [replying, setReplying] = useState(false)
  const deleted = g.isDeleted(c)
  const parent = parentOf(c)
  const isNew = readBefore !== undefined && c.created_at > readBefore && c.pubkey !== me
  const score = g.voters(c.id).size
  const kids = byParent.get(c.id) ?? []
  const canDelete = !deleted && (c.pubkey === me || g.isAdmin())

  return (
    <li class={"c" + (isNew ? " new" : "") + (collapsed ? " collapsed" : "")} id={"c" + c.id}>
      <div class="ch">
        {deleted ? (
          <>
            <span class="vote none" aria-hidden="true"></span>
            <span class="gone">[deleted]</span>
            <span>{ago(c.created_at)}</span>
          </>
        ) : (
          <>
            <VoteButton group={g} target={c} />
            <UserLink class="u" pubkey={c.pubkey} group={g} />
            {c.pubkey === thread.pubkey && <span class="op">op</span>}
            <span title={new Date(c.created_at * 1000).toLocaleString()}>{ago(c.created_at)}</span>
            <span>·</span>
            <span class="score">{plural(score, "point")}</span>
          </>
        )}
        {parent && parent !== thread.id && (
          <>
            <span>·</span>
            <a class="par" href={"#c" + parent}>
              parent
            </a>
          </>
        )}
        {isNew && <span class="tag">new</span>}
        <button
          class="tog"
          type="button"
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Expand comment" : "Collapse comment"}
          onClick={() => setCollapsed(!collapsed)}
        >
          {collapsed ? "[+]" : "[-]"}
        </button>
      </div>
      <div class={"cb" + (deleted ? " gone" : "")}>{deleted ? <p>[deleted]</p> : <NoteContent event={c} group={g} />}</div>
      {!deleted && (
        <div class="ca">
          <a
            class="reply-link"
            href="#"
            onClick={e => {
              e.preventDefault()
              setReplying(true)
            }}
          >
            reply
          </a>
          <a href={"#c" + c.id}>link</a>
          {canDelete && (
            <button
              class="inline-button"
              type="button"
              onClick={async () => {
                if (!confirm("Delete this comment? This cannot be undone. Replies to it stay.")) return
                try {
                  await g.deleteEvent(c)
                } catch (err) {
                  alert(`Couldn't delete: ${(err as Error).message}`)
                }
              }}
            >
              delete
            </button>
          )}
        </div>
      )}
      {replying && <CommentForm g={g} thread={thread} parent={c} onDone={() => setReplying(false)} />}
      <ol class="kids">
        {kids.map(k => (
          <Comment key={k.id} c={k} ctx={ctx} />
        ))}
      </ol>
    </li>
  )
}

function CommentForm({ g, thread, parent, onDone }: { g: Group; thread: NostrEvent; parent: NostrEvent; onDone?: () => void }) {
  const [body, setBody] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const isReply = parent.id !== thread.id
  const author = displayName(parent.pubkey, [g.relay])

  const submit = async () => {
    if (!body.trim() || busy) return
    setBusy(true)
    setError("")
    try {
      const evt = await g.comment(thread, parent, body.trim())
      setBody("")
      onDone?.()
      requestAnimationFrame(() => document.getElementById("c" + evt.id)?.scrollIntoView({ block: "nearest" }))
    } catch (err) {
      setError(`Couldn't post: ${(err as Error).message ?? err}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      class={isReply ? "reply-form" : "comment-form"}
      id={isReply ? undefined : "comment-form"}
      aria-label={isReply ? `Reply to ${author}` : "Add a comment"}
      onSubmit={e => {
        e.preventDefault()
        submit()
      }}
    >
      {error && (
        <p class="err" role="alert">
          {error}
        </p>
      )}
      <Editor
        value={body}
        onInput={setBody}
        onSubmit={submit}
        rows={isReply ? 6 : undefined}
        required
        autofocus={isReply}
        label={isReply ? "Reply" : "Comment"}
        placeholder={isReply ? `Reply to ${author}` : "Add a comment."}
        bar={
          <>
            <span>{isReply ? `replying to ${author}` : "nip27"}</span>
            <span class="sp"></span>
            <Counter value={body} />
            <button class="btn pri" type="submit" disabled={busy}>
              {busy ? "posting…" : isReply ? "reply" : "comment"}
            </button>
            {isReply && (
              <button class="btn ghost" type="button" onClick={onDone}>
                cancel
              </button>
            )}
          </>
        }
      />
    </form>
  )
}
