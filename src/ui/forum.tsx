import { useState } from "preact/hooks"
import { inMyGroups, addToMyGroups, type Group } from "../groups"
import { me } from "../nostr"
import { isLive, rejoined } from "../sync"
import { UserLink, VoteButton, ago, lastRead, linkOf, plural, titleOf } from "./common"

const PER_PAGE = 30

export function Forum({ group: g }: { group: Group }) {
  const params = new URLSearchParams(location.search)
  const page = Math.max(1, parseInt(params.get("page") || "1") || 1)
  const threads = g.visibleThreads().sort((a, b) => g.lastActivity(b) - g.lastActivity(a))
  const totalPages = Math.max(1, Math.ceil(threads.length / PER_PAGE))
  const shown = threads.slice((page - 1) * PER_PAGE, page * PER_PAGE)
  const base = `/${g.naddr}`

  return (
    <div class="front-page">
      <div class="pagehead">
        <h1 class="pt">
          <span class="p">~/</span>threads
        </h1>
        <span class="sp"></span>
        {isLive(g) && (
          <span class="live">
            <i></i>live
          </span>
        )}
      </div>
      {g.metadata?.about && <p class="forum-about">{g.metadata.about}</p>}

      <Membership group={g} />

      {shown.length ? (
        <ol class="list">
          {shown.map(t => {
            const score = g.voters(t.id).size
            const voted = g.myVotes(t.id).length > 0
            const comments = g.threadComments(t.id).filter(c => !g.isDeleted(c))
            const read = lastRead(t.id)
            const link = linkOf(t)
            const unopened = read === undefined && t.pubkey !== me
            const fresh = read === undefined ? 0 : comments.filter(c => c.created_at > read && c.pubkey !== me).length
            return (
              <li class="row" key={t.id}>
                <div class="vc">
                  <VoteButton group={g} target={t} />
                  <span class={"sc" + (voted ? " on" : "")}>{score}</span>
                </div>
                <div class="thread-cell">
                  {unopened && <span class="dot unread-dot" aria-label="unread"></span>}
                  {link ? (
                    <>
                      <a class="tt" href={link.url} rel="nofollow noopener" target="_blank">
                        {titleOf(t)}
                      </a>{" "}
                      <span class="dom">({link.domain})</span>
                    </>
                  ) : (
                    <a class="tt" href={`${base}/${t.id}`}>
                      {titleOf(t)}
                    </a>
                  )}
                  <div class="meta">
                    <UserLink pubkey={t.pubkey} group={g} />
                    <span>·</span>
                    <a href={`${base}/${t.id}#comments`}>{plural(comments.length, "comment")}</a>
                    {fresh > 0 && (
                      <>
                        <span>·</span>
                        <span class="new-count">{fresh} new</span>
                      </>
                    )}
                  </div>
                </div>
                <span class="act">{ago(g.lastActivity(t))}</span>
              </li>
            )
          })}
        </ol>
      ) : g.syncing ? (
        <p class="hint">Loading threads from {g.relay}…</p>
      ) : !g.metadata && !g.isMember() ? (
        <p class="hint">Nothing to show. This forum is probably private: join it, or open an invite link, to read it.</p>
      ) : g.syncError && !g.threads.size ? (
        <p class="err" role="alert">
          {g.syncError}
        </p>
      ) : (
        <p>
          No threads yet. <a href={`${base}/new`}>Start the first one.</a>
        </p>
      )}

      {totalPages > 1 && (
        <nav class="pagination" aria-label="Pages">
          <span class="label">
            page {page} of {totalPages} · {PER_PAGE} per page
          </span>
          <span class="sp"></span>
          {page > 1 && (
            <a class="btn" href={`${base}?page=${page - 1}`} rel="prev">
              ‹ newer
            </a>
          )}
          {page < totalPages && (
            <a class="btn" href={`${base}?page=${page + 1}`} rel="next">
              older ›
            </a>
          )}
        </nav>
      )}
    </div>
  )
}

// Join, or keep in the list, depending on where the person stands.
export function Membership({ group: g }: { group: Group }) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState("")
  const invite = new URLSearchParams(location.search).get("invite") ?? undefined
  const member = g.isMember()
  const listed = inMyGroups(g)

  if (member && listed) return null

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    setMessage("")
    try {
      await fn()
    } catch (err) {
      setMessage(String((err as Error).message ?? err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div class="notice membership" role="status">
      {member ? (
        <>
          <span class="notice-title">member</span>
          <span>You're a member, but this forum isn't in your list.</span>
          <span class="sp"></span>
          <button class="btn" disabled={busy} onClick={() => run(() => addToMyGroups(g))}>
            add to my forums
          </button>
        </>
      ) : (
        <>
          <span class="notice-title">{g.metadata?.isClosed && !invite ? "closed" : "join"}</span>
          <span>
            {g.metadata?.isClosed && !invite
              ? "This forum is closed. You need an invite link or an admin to add you."
              : g.metadata?.isPrivate || !g.metadata
                ? invite
                  ? "You have an invite. Join to read and post."
                  : "This forum is private (or its relay won't say). Join to read and post."
                : "You can read this forum. Join to keep it in your list."}
          </span>
          <span class="sp"></span>
          {(!g.metadata?.isClosed || invite) && (
            <button class="btn pri" disabled={busy} onClick={() => run(() => g.join(invite).then(() => rejoined(g)))}>
              {busy ? "joining…" : "join"}
            </button>
          )}
          {!listed && g.metadata?.isClosed && !invite && (
            <button class="btn" disabled={busy} onClick={() => run(() => addToMyGroups(g))}>
              add to my forums
            </button>
          )}
        </>
      )}
      {message && <span class="err">{message}</span>}
    </div>
  )
}
