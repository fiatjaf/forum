import type { NostrEvent as Event } from "@nostr/tools/core"
import { For, Show, createEffect, createMemo, createSignal, type Accessor } from "solid-js"
import type { Group } from "../groups"
import { me } from "../account"
import { useChanges } from "../state"
import {
  Counter,
  Djot,
  Editor,
  NoteContent,
  UserLink,
  VoteButton,
  ago,
  displayName,
  lastRead,
  markRead,
  navigate,
  plural,
  linkOf,
  titleOf
} from "./common"
import { Membership } from "./forum"

const parentOf = (c: Event) => c.tags.findLast(t => t[0] === "e")?.[1]

export function ThreadPage(props: { group: Group; id: string }) {
  const g = props.group
  const id = props.id
  const base = `/${g.naddr}`
  // what was read before this visit decides what shows as new
  const readBefore = lastRead(id)
  const thread = createMemo(() => {
    useChanges()
    return g.threads.get(id)
  })
  const syncing = () => {
    useChanges()
    return g.syncing
  }
  const comments = createMemo(() => {
    useChanges()
    // a fresh array: ingest pushes onto the model's array in place
    return [...g.threadComments(id)]
  })

  createEffect(() => {
    const t = thread()
    const cs = comments()
    if (!t) return
    const newest = Math.max(t.created_at, ...cs.map(c => c.created_at))
    markRead(id, newest)
  })

  // jump to a linked comment once it is there
  const jumped = { done: false }
  createEffect(() => {
    comments()
    if (jumped.done || !location.hash) return
    const el = document.getElementById(location.hash.slice(1))
    if (el) {
      jumped.done = true
      el.scrollIntoView()
      el.classList.add("target")
    }
  })

  return (
    <Show
      when={thread()}
      fallback={
        <div class="thread-page">
          <a class="back" href={base}>
            ‹ ~/threads
          </a>
          <p class="hint">{syncing() ? "Loading the thread…" : "Thread not found."}</p>
        </div>
      }
    >
      {t => {
        const deleted = createMemo(() => {
          useChanges()
          return g.isDeleted(t())
        })
        const link = createMemo(() => linkOf(t()))
        const visible = createMemo(() => comments().filter(c => !g.isDeleted(c)))
        const score = createMemo(() => {
          useChanges()
          return g.voters(t().id).size
        })
        const voted = createMemo(() => {
          useChanges()
          return g.myVotes(t().id).length > 0
        })
        const canDelete = () => !deleted() && (t().pubkey === me || g.isAdmin())

        // children by parent; replies to unknown parents go to the top level
        const byParent = createMemo(() => {
          const cs = comments()
          const known = new Set(cs.map(c => c.id))
          const map = new Map<string, Event[]>()
          for (const c of cs) {
            let p = parentOf(c) ?? id
            if (p !== id && !known.has(p)) p = id
            const list = map.get(p) ?? []
            list.push(c)
            map.set(p, list)
          }
          const best = (a: Event, b: Event) => g.voters(b.id).size - g.voters(a.id).size || a.created_at - b.created_at
          for (const list of map.values()) list.sort(best)
          return map
        })

        const ctx: Ctx = { g, thread: t(), byParent, readBefore }

        return (
          <div class="thread-page">
            <a class="back" href={base}>
              ‹ ~/threads
            </a>

            <article class="thread" id={"t" + t().id}>
              <div class="vc thread-vote">
                <VoteButton group={g} target={t()} size={12} />
                <span class={"score" + (voted() ? " on" : "")}>{score()}</span>
              </div>
              <div class="thread-main">
                <h1 class="thread-title">
                  {deleted() ? (
                    "[deleted]"
                  ) : link() ? (
                    <>
                      <a href={link()!.url} rel="nofollow noopener" target="_blank">
                        {titleOf(t())}
                      </a>{" "}
                      <span class="dom">{link()!.domain}</span>
                    </>
                  ) : (
                    titleOf(t())
                  )}
                </h1>
                <div class="meta">
                  <UserLink pubkey={t().pubkey} group={g} />
                  <span>·</span>
                  <span title={new Date(t().created_at * 1000).toLocaleString()}>{ago(t().created_at)}</span>
                  <span>·</span>
                  <a href="#comments">{plural(visible().length, "comment")}</a>
                  {canDelete() && (
                    <>
                      <span>·</span>
                      <button
                        class="inline-button"
                        type="button"
                        onClick={async () => {
                          if (!confirm("Delete this thread? This cannot be undone.")) return
                          try {
                            await g.deleteEvent(t())
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
                {!deleted() && !link() && t().content.trim() && <Djot class="prose thread-body" text={t().content} />}
              </div>
            </article>

            <Membership group={g} />

            <CommentForm g={g} thread={t()} parent={t()} />

            <div class="comments-head">
              <span class="label">{plural(visible().length, "comment")} · best first</span>
              <span class="sp"></span>
            </div>

            <section class="comments" aria-label="Comments">
              <ol class="comment-list" id="comments">
                <For each={byParent().get(id) ?? []}>{c => <Comment c={c} ctx={ctx} />}</For>
              </ol>
              {!visible().length && <p class="no-comments">No comments yet.</p>}
            </section>

            <div class="dock">
              <a
                class="fake"
                href="#comment-form"
                onClick={e => {
                  e.preventDefault()
                  document.querySelector<HTMLTextAreaElement>("#comment-form textarea")?.focus()
                }}
              >
                add a comment…
              </a>
            </div>
          </div>
        )
      }}
    </Show>
  )
}

type Ctx = { g: Group; thread: Event; byParent: Accessor<Map<string, Event[]>>; readBefore?: number }

function Comment(props: { c: Event; ctx: Ctx }) {
  const { g, thread, byParent, readBefore } = props.ctx
  const c = props.c
  const [collapsed, setCollapsed] = createSignal(false)
  const [replying, setReplying] = createSignal(false)
  const parent = parentOf(c)
  const info = createMemo(() => {
    useChanges()
    return {
      deleted: g.isDeleted(c),
      isNew: readBefore !== undefined && c.created_at > readBefore && c.pubkey !== me,
      score: g.voters(c.id).size,
      canDelete: !g.isDeleted(c) && (c.pubkey === me || g.isAdmin())
    }
  })
  const kids = () => byParent().get(c.id) ?? []

  return (
    <li class={"c" + (info().isNew ? " new" : "") + (collapsed() ? " collapsed" : "")} id={"c" + c.id}>
      <div class="ch">
        {info().deleted ? (
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
            <span class="score">{plural(info().score, "point")}</span>
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
        {info().isNew && <span class="tag">new</span>}
        <button
          class="tog"
          type="button"
          aria-expanded={!collapsed()}
          aria-label={collapsed() ? "Expand comment" : "Collapse comment"}
          onClick={() => setCollapsed(!collapsed())}
        >
          {collapsed() ? "[+]" : "[-]"}
        </button>
      </div>
      <div class={"cb" + (info().deleted ? " gone" : "")}>
        {info().deleted ? <p>[deleted]</p> : <NoteContent event={c} group={g} />}
      </div>
      {!info().deleted && (
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
          {info().canDelete && (
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
      {replying() && <CommentForm g={g} thread={thread} parent={c} onDone={() => setReplying(false)} />}
      <ol class="kids">
        <For each={kids()}>{k => <Comment c={k} ctx={props.ctx} />}</For>
      </ol>
    </li>
  )
}

function CommentForm(props: { g: Group; thread: Event; parent: Event; onDone?: () => void }) {
  const g = props.g
  const thread = props.thread
  const parent = props.parent
  const [body, setBody] = createSignal("")
  const [error, setError] = createSignal("")
  const [busy, setBusy] = createSignal(false)
  const isReply = parent.id !== thread.id
  const author = displayName(parent.pubkey, [g.relay])

  const submit = async () => {
    if (!body().trim() || busy()) return
    setBusy(true)
    setError("")
    try {
      const evt = await g.comment(thread, parent, body().trim())
      setBody("")
      props.onDone?.()
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
      {error() && (
        <p class="err" role="alert">
          {error()}
        </p>
      )}
      <Editor
        value={body()}
        onInput={setBody}
        onSubmit={submit}
        rows={isReply ? 6 : undefined}
        required
        autofocus={isReply}
        label={isReply ? "Reply" : "Comment"}
        placeholder={isReply ? `Reply to ${author}` : "Add a comment."}
        bar={
          <>
            <span>{isReply ? `replying to ${author}` : "plain text"}</span>
            <span class="sp"></span>
            <Counter value={body()} />
            <button class="btn pri" type="submit" disabled={busy()}>
              {busy() ? "posting…" : isReply ? "reply" : "comment"}
            </button>
            {isReply && (
              <button class="btn ghost" type="button" onClick={props.onDone}>
                cancel
              </button>
            )}
          </>
        }
      />
    </form>
  )
}
