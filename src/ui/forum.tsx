import { For, Show, createMemo, createSignal, onMount } from "solid-js"
import type { NostrEvent as Event } from "@nostr/tools/core"
import { inMyGroups, addToMyGroups, type Group } from "../groups"
import { me } from "../account"
import { isLive, rejoined } from "../sync"
import { useChanges } from "../state"
import { UserLink, VoteButton, ago, lastRead, linkOf, plural, titleOf } from "./common"

const PER_PAGE = 30

export function Forum(props: { group: Group }) {
  const g = props.group
  const params = new URLSearchParams(location.search)
  const page = Math.max(1, parseInt(params.get("page") || "1") || 1)
  const threads = createMemo(() => {
    useChanges()
    return g.visibleThreads().sort((a, b) => g.lastActivity(b) - g.lastActivity(a))
  })
  const totalPages = () => Math.max(1, Math.ceil(threads().length / PER_PAGE))
  const shown = () => threads().slice((page - 1) * PER_PAGE, page * PER_PAGE)
  const base = `/${g.naddr}`
  const live = () => {
    useChanges()
    return isLive(g)
  }
  const about = () => {
    useChanges()
    return g.metadata?.about
  }
  const syncing = () => {
    useChanges()
    return g.syncing
  }
  const metadata = () => {
    useChanges()
    return g.metadata
  }
  const member = () => {
    useChanges()
    return g.isMember()
  }
  const syncError = () => {
    useChanges()
    return g.syncError
  }

  return (
    <div class="front-page">
      <div class="pagehead">
        <h1 class="pt">
          <span class="p">~/</span>threads
        </h1>
        <span class="sp"></span>
        <InviteButton group={g} />
        {live() && (
          <span class="live">
            <i></i>live
          </span>
        )}
      </div>
      {about() && <p class="forum-about">{about()}</p>}

      <Membership group={g} />

      {shown().length ? (
        <ol class="list">
          <For each={shown()}>{t => <ThreadRow group={g} thread={t} base={base} />}</For>
        </ol>
      ) : syncing() ? (
        <p class="hint">Loading threads from {g.relay}…</p>
      ) : !metadata() && !member() ? (
        <p class="hint">
          Nothing to show. This forum is probably private. Join it, or open an invite link, to read it.
        </p>
      ) : syncError() && !g.threads.size ? (
        <p class="err" role="alert">
          {syncError()}
        </p>
      ) : (
        <p>
          No threads yet. <a href={`${base}/new`}>Start the first one.</a>
        </p>
      )}

      {totalPages() > 1 && (
        <nav class="pagination" aria-label="Pages">
          <span class="label">
            page {page} of {totalPages()} · {PER_PAGE} per page
          </span>
          <span class="sp"></span>
          {page > 1 && (
            <a class="btn" href={`${base}?page=${page - 1}`} rel="prev">
              ‹ newer
            </a>
          )}
          {page < totalPages() && (
            <a class="btn" href={`${base}?page=${page + 1}`} rel="next">
              older ›
            </a>
          )}
        </nav>
      )}
    </div>
  )
}

function ThreadRow(props: { group: Group; thread: Event; base: string }) {
  const g = props.group
  const t = props.thread
  const info = createMemo(() => {
    useChanges()
    const comments = g.threadComments(t.id).filter(c => !g.isDeleted(c))
    const read = lastRead(t.id)
    return {
      score: g.voters(t.id).size,
      voted: g.myVotes(t.id).length > 0,
      commentCount: comments.length,
      fresh: read === undefined ? 0 : comments.filter(c => c.created_at > read && c.pubkey !== me).length,
      unopened: read === undefined && t.pubkey !== me,
      link: linkOf(t),
      title: titleOf(t),
      activity: g.lastActivity(t)
    }
  })
  return (
    <li class="row">
      <div class="vc">
        <VoteButton group={g} target={t} />
        <span class={"sc" + (info().voted ? " on" : "")}>{info().score}</span>
      </div>
      <div class="thread-cell">
        {info().unopened && <span class="dot unread-dot" aria-label="unread"></span>}
        {info().link ? (
          <>
            <a class="tt" href={info().link!.url} rel="nofollow noopener" target="_blank">
              {info().title}
            </a>{" "}
            <span class="dom">({info().link!.domain})</span>
          </>
        ) : (
          <a class="tt" href={`${props.base}/${t.id}`}>
            {info().title}
          </a>
        )}
        <div class="meta">
          <UserLink pubkey={t.pubkey} group={g} />
          <span>·</span>
          <a href={`${props.base}/${t.id}#comments`}>{plural(info().commentCount, "comment")}</a>
          {info().fresh > 0 && (
            <>
              <span>·</span>
              <span class="new-count">{info().fresh} new</span>
            </>
          )}
        </div>
      </div>
      <span class="act">{ago(info().activity)}</span>
    </li>
  )
}

// Join, or keep in the list, depending on where the person stands.
export function Membership(props: { group: Group }) {
  const g = props.group
  const [busy, setBusy] = createSignal(false)
  const [message, setMessage] = createSignal("")
  const invite = new URLSearchParams(location.search).get("invite") ?? undefined
  const member = () => {
    useChanges()
    return g.isMember()
  }
  const listed = () => {
    useChanges()
    return inMyGroups(g)
  }
  const meta = () => {
    useChanges()
    return g.metadata
  }

  const join = async () => {
    setBusy(true)
    setMessage("")
    try {
      await g.join(invite)
      rejoined(g)
      // the code is spent: don't offer it again on reload
      if (invite) history.replaceState(null, "", location.pathname)
    } catch (err) {
      setMessage(String((err as Error).message ?? err))
    } finally {
      setBusy(false)
    }
  }

  const addToList = async () => {
    setBusy(true)
    setMessage("")
    try {
      await addToMyGroups(g)
    } catch (err) {
      setMessage(String((err as Error).message ?? err))
    } finally {
      setBusy(false)
    }
  }

  // Opening an invite link (possibly right after logging in through it) is
  // asking to join.
  onMount(async () => {
    if (!invite) return
    await g.loaded
    if (!g.isMember()) join()
    else history.replaceState(null, "", location.pathname)
  })

  return (
    <Show when={!member() || !listed()}>
      <div class="notice membership" role="status">
        {member() ? (
          <>
            <span class="notice-title">member</span>
            <span>You're a member, but this forum isn't in your list.</span>
            <span class="sp"></span>
            <button class="btn" disabled={busy()} onClick={addToList}>
              add to my forums
            </button>
          </>
        ) : (
          <>
            <span class="notice-title">{meta()?.isClosed && !invite ? "closed" : "join"}</span>
            <span>
              {meta()?.isClosed && !invite
                ? "This forum is closed. You need an invite link or an admin to add you."
                : meta()?.isPrivate || !meta()
                  ? invite
                    ? "You have an invite. Join to read and post."
                    : "This forum is private, or its server won't say. Join to read and post."
                  : "You can read this forum. Join to keep it in your list."}
            </span>
            <span class="sp"></span>
            {(!meta()?.isClosed || invite) && (
              <button
                class="btn pri"
                disabled={busy()}
                onClick={join}
              >
                {busy() ? "joining…" : "join"}
              </button>
            )}
            {!listed() && meta()?.isClosed && !invite && (
              <button class="btn" disabled={busy()} onClick={addToList}>
                add to my forums
              </button>
            )}
          </>
        )}
        {message() && <span class="err">{message()}</span>}
      </div>
    </Show>
  )
}

// Open forums are shared by their own link; closed ones need an admin to make
// an invite code, which the link carries.
function InviteButton(props: { group: Group }) {
  const g = props.group
  const [state, setState] = createSignal<"" | "making" | "copied" | "error">("")
  const [link, setLink] = createSignal("")
  const canInvite = () => {
    useChanges()
    return g.metadata?.isClosed ? g.isAdmin() : g.isMember() || inMyGroups(g)
  }

  const invite = async () => {
    setState("making")
    try {
      let url = `${location.origin}/${g.naddr}`
      if (g.metadata?.isClosed) url += `?invite=${await g.createInvite()}`
      setLink(url)
      try {
        await navigator.clipboard.writeText(url)
        setState("copied")
      } catch {
        setState("")
      }
    } catch (err) {
      setLink(String((err as Error).message ?? err))
      setState("error")
    }
  }

  return (
    <Show when={canInvite()}>
      <button class="btn" type="button" disabled={state() === "making"} onClick={invite}>
        {state() === "making" ? "making invite…" : state() === "copied" ? "link copied" : "invite"}
      </button>
      {link() && (
        <input
          class={"inp mono invite-link" + (state() === "error" ? " err" : "")}
          readOnly
          value={link()}
          aria-label="Invite link"
          onFocus={e => (e.target as HTMLInputElement).select()}
        />
      )}
    </Show>
  )
}
