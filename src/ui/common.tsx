import { loadNostrUser, type NostrUser, bareNostrUser } from "@nostr/gadgets/metadata"
import type { NostrEvent } from "@nostr/tools/core"
import * as nip19 from "@nostr/tools/nip19"
import { type Block, parse } from "@nostr/tools/nip27"
import DOMPurify from "dompurify"
import * as djot from "@djot/djot"
import type { ComponentChildren } from "preact"
import { useEffect, useRef, useState } from "preact/hooks"
import { me, pendingName, PROFILE_RELAYS } from "../nostr"
import type { Group } from "../groups"
import { emit } from "../state"

// ─── navigation ────────────────────────────────────────────────

export function navigate(path: string, replace = false) {
  if (replace) history.replaceState(null, "", path)
  else history.pushState(null, "", path)
  window.scrollTo(0, 0)
  emit()
}

document.addEventListener("click", e => {
  const a = (e.target as HTMLElement).closest?.("a")
  if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
  if (a.target || a.hasAttribute("download")) return
  const url = new URL(a.href, location.href)
  if (url.origin !== location.origin) return
  if (url.pathname === location.pathname && url.search === location.search && url.hash) return
  e.preventDefault()
  navigate(url.pathname + url.search + url.hash)
  if (url.hash) requestAnimationFrame(() => document.getElementById(url.hash.slice(1))?.scrollIntoView())
})

window.addEventListener("popstate", () => emit())

// ─── people ────────────────────────────────────────────────────

const users = new Map<string, NostrUser>()
const loading = new Set<string>()

export function getUser(pubkey: string, relays: string[] = []): NostrUser {
  const known = users.get(pubkey)
  if (!known && !loading.has(pubkey)) {
    loading.add(pubkey)
    loadNostrUser({ pubkey, relays: [...relays, ...PROFILE_RELAYS] })
      .then(u => {
        users.set(pubkey, u)
        emit()
      })
      .catch(() => {})
      .finally(() => loading.delete(pubkey))
  }
  return known ?? bareNostrUser(pubkey)
}

// After publishing a new kind:0 the loader has it; ask again.
export function forgetUser(pubkey: string) {
  users.delete(pubkey)
  emit()
}

export function displayName(pubkey: string, relays: string[] = []): string {
  if (pubkey === me) {
    const p = pendingName()
    if (p) return p
  }
  const u = getUser(pubkey, relays)
  return u.metadata.display_name || u.metadata.name || u.shortName
}

export const npub = (pubkey: string) => nip19.npubEncode(pubkey)

export function UserLink({ pubkey, group, class: cls }: { pubkey: string; group?: Group; class?: string }) {
  return (
    <a class={cls} href={`/${npub(pubkey)}`}>
      {displayName(pubkey, group ? [group.relay] : [])}
    </a>
  )
}

// ─── time ──────────────────────────────────────────────────────

export function ago(ts: number): string {
  const s = Math.floor(Date.now() / 1000) - ts
  if (s < 60) return "now"
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  if (s < 30 * 86400) return `${Math.floor(s / 86400)}d`
  if (s < 365 * 86400) return `${Math.floor(s / (30 * 86400))}mo`
  return `${Math.floor(s / (365 * 86400))}y`
}

export const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`

// ─── events ────────────────────────────────────────────────────

export const titleOf = (evt: NostrEvent) => evt.tags.find(t => t[0] === "title")?.[1] || evt.content.split("\n")[0].slice(0, 80) || "(untitled)"

// A thread whose whole body is one link is a link thread: its title points
// there and the domain shows next to it, like soliloquy's url threads.
export function linkOf(evt: NostrEvent): { url: string; domain: string } | null {
  const body = evt.content.trim()
  if (!/^https?:\/\/\S+$/.test(body)) return null
  try {
    return { url: body, domain: new URL(body).hostname.replace(/^www\./, "") }
  } catch {
    return null
  }
}

export function snippet(text: string, max = 200): string {
  const flat = text.replace(/\s+/g, " ").trim()
  return flat.length > max ? flat.slice(0, max - 1) + "…" : flat
}

// ─── note content ──────────────────────────────────────────────
// Comments are plain text, cut into links, references, media and hashtags by
// NIP-27. Thread bodies are djot and go through renderMentions below.

const mediaBlock = (block?: Block) =>
  block?.type === "image" || block?.type === "video" || block?.type === "audio"

export function NoteContent({
  event,
  group,
  class: cls
}: {
  event: Pick<NostrEvent, "content" | "tags">
  group?: Group
  class?: string
}) {
  const blocks = [...parse(event as NostrEvent)]

  return (
    <div class={"nc" + (cls ? " " + cls : "")}>
      {blocks.map((block, i) => {
        switch (block.type) {
          case "text": {
            let text = block.text
            if (mediaBlock(blocks[i - 1]) && text.startsWith("\n")) text = text.slice(1)
            if (mediaBlock(blocks[i + 1]) && text.endsWith("\n")) text = text.slice(0, -1)
            return text ? <span key={i}>{text}</span> : null
          }
          case "url":
            return (
              <a key={i} href={block.url} target="_blank" rel="nofollow noopener">
                {block.url}
              </a>
            )
          case "relay":
            return (
              <span key={i} class="relay" title={block.url}>
                {block.url}
              </span>
            )
          case "image":
            return <img key={i} class="note-image" src={block.url} loading="lazy" alt="" />
          case "video":
            return <video key={i} class="note-video" src={block.url} controls preload="metadata" />
          case "audio":
            return <audio key={i} class="note-audio" src={block.url} controls preload="metadata" />
          case "reference":
            return <NoteReference key={i} pointer={block.pointer} group={group} />
          case "hashtag":
            return (
              <span key={i} class="hashtag">
                #{block.value}
              </span>
            )
          case "emoji":
            return <img key={i} class="emoji" src={block.url} alt={`:${block.shortcode}:`} title={`:${block.shortcode}:`} loading="lazy" />
          default:
            return null
        }
      })}
    </div>
  )
}

function NoteReference({
  pointer,
  group
}: {
  pointer: Extract<Block, { type: "reference" }>["pointer"]
  group?: Group
}) {
  if ("identifier" in pointer) {
    const code = nip19.naddrEncode(pointer)
    return (
      <a class="ref" href={"/" + code} title={code}>
        %{pointer.kind}:{pointer.identifier.slice(0, 8)}
      </a>
    )
  }

  if ("id" in pointer) {
    // A reference to a thread or comment we already have opens in its forum
    // directly; anything else goes through the nevent resolver.
    if (group) {
      const thread = group.threads.get(pointer.id)
      if (thread) {
        return (
          <a class="ref" href={`/${group.naddr}/${thread.id}`} title={pointer.id}>
            %{pointer.id.slice(0, 8)}
          </a>
        )
      }
      const comment = group.comments.get(pointer.id)
      const root = comment?.tags.find(t => t[0] === "E")?.[1]
      if (comment && root) {
        return (
          <a class="ref" href={`/${group.naddr}/${root}#c${comment.id}`} title={pointer.id}>
            %{pointer.id.slice(0, 8)}
          </a>
        )
      }
    }
    const code = nip19.neventEncode(pointer)
    return (
      <a class="ref" href={"/" + code} title={pointer.id}>
        %{pointer.id.slice(0, 8)}
      </a>
    )
  }

  return (
    <a class="mention" href={`/${npub(pointer.pubkey)}`}>
      @{displayName(pointer.pubkey, pointer.relays)}
    </a>
  )
}

function renderMentions(text: string): string {
  return text.replace(/(?:nostr:)?((?:npub1|nprofile1)[a-z0-9]{50,})/g, (whole: string, code: string) => {
    try {
      const d = nip19.decode(code)
      const pk = d.type === "npub" ? d.data : d.type === "nprofile" ? d.data.pubkey : null
      if (!pk) return whole
      return `[@${displayName(pk).replace(/[\[\]]/g, "")}](/${nip19.npubEncode(pk)})`
    } catch {
      return whole
    }
  })
}

// Thread bodies are djot.
export function Djot({ text, class: cls }: { text: string; class?: string }) {
  let html: string
  try {
    html = DOMPurify.sanitize(djot.renderHTML(djot.parse(renderMentions(text))))
  } catch {
    html = DOMPurify.sanitize(text.replace(/[&<>]/g, c => `&#${c.charCodeAt(0)};`).replace(/\n/g, "<br>"))
  }
  return <div class={cls} dangerouslySetInnerHTML={{ __html: html }} />
}

// ─── editor ────────────────────────────────────────────────────
// The write/preview editor every form uses, with its counter.

export const MAX_BODY = 20000

export function Editor(props: {
  value: string
  onInput: (v: string) => void
  onSubmit?: () => void
  placeholder?: string
  rows?: number
  required?: boolean
  autofocus?: boolean
  id?: string
  label: string
  bar?: ComponentChildren
  format?: "nip27" | "djot"
}) {
  const [tab, setTab] = useState<"write" | "preview">("write")
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    if (props.autofocus) ref.current?.focus()
  }, [])
  return (
    <div class="editor">
      <div class="tabs" role="tablist">
        <button type="button" class={tab === "write" ? "on" : ""} role="tab" aria-selected={tab === "write"} onClick={() => setTab("write")}>
          write
        </button>
        <button type="button" class={tab === "preview" ? "on" : ""} role="tab" aria-selected={tab === "preview"} onClick={() => setTab("preview")}>
          preview
        </button>
      </div>
      <textarea
        ref={ref}
        id={props.id}
        hidden={tab !== "write"}
        rows={props.rows}
        maxLength={MAX_BODY}
        required={props.required}
        aria-label={props.label}
        placeholder={props.placeholder}
        value={props.value}
        onInput={e => props.onInput((e.target as HTMLTextAreaElement).value)}
        onKeyDown={e => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault()
            props.onSubmit?.()
          }
        }}
      />
      {tab === "preview" && (
        <div class={"preview" + (props.format === "djot" ? " prose" : "")}>
          {props.value.trim() ? (
            props.format === "djot" ? (
              <Djot text={props.value} />
            ) : (
              <NoteContent event={{ content: props.value, tags: [] }} />
            )
          ) : (
            <p class="muted">Nothing to preview.</p>
          )}
        </div>
      )}
      {props.bar && <div class="edbar">{props.bar}</div>}
    </div>
  )
}

export function Counter({ value, max = MAX_BODY }: { value: string; max?: number }) {
  return (
    <span>
      {value.length} / {max}
    </span>
  )
}

// ─── votes ─────────────────────────────────────────────────────

export function VoteButton({ group, target, size = 10 }: { group: Group; target: NostrEvent; size?: number }) {
  const voted = group.myVotes(target.id).length > 0
  const [busy, setBusy] = useState(false)
  return (
    <button
      class={"vote" + (voted ? " on" : "")}
      type="button"
      disabled={busy}
      aria-label={voted ? "Remove upvote" : "Upvote"}
      aria-pressed={voted}
      onClick={async () => {
        setBusy(true)
        try {
          await group.toggleVote(target)
        } catch (err) {
          alert(`Couldn't vote: ${(err as Error).message}`)
        } finally {
          setBusy(false)
        }
      }}
    >
      <svg width={size} height={size} viewBox="0 0 10 10" aria-hidden="true">
        <path d="M5 1.5 9 8.5H1z" fill="currentColor"></path>
      </svg>
    </button>
  )
}

// ─── reads ─────────────────────────────────────────────────────
// What this browser has seen of each thread, for the unread dot and the "new"
// marks, like soliloquy's thread reads.

function readsMap(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem("reads") || "{}")
  } catch {
    return {}
  }
}

export function lastRead(threadId: string): number | undefined {
  return readsMap()[threadId]
}

export function markRead(threadId: string, ts: number) {
  const m = readsMap()
  if ((m[threadId] ?? 0) >= ts) return
  m[threadId] = ts
  try {
    localStorage.setItem("reads", JSON.stringify(m))
  } catch {}
}

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): { value?: T; error?: string; loading: boolean } {
  const [state, setState] = useState<{ value?: T; error?: string; loading: boolean }>({ loading: true })
  useEffect(() => {
    let alive = true
    setState({ loading: true })
    fn().then(
      value => alive && setState({ value, loading: false }),
      err => alive && setState({ error: String(err?.message ?? err), loading: false })
    )
    return () => {
      alive = false
    }
  }, deps)
  return state
}
