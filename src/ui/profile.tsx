import type { NostrEvent } from "@nostr/tools/core"
import * as nip19 from "@nostr/tools/nip19"
import { For, Show, createMemo, createSignal } from "solid-js"
import { KIND_COMMENT, allGroups, type Group } from "../groups"
import {
  accountType,
  localSecretKey,
  me,
  nsec,
  pendingName,
  pomegranateLink,
  setPomegranateLink,
  setProfileName,
  startFresh,
  useBunker,
  useSecretKey
} from "../nostr"
import { linkGoogle } from "../pomegranate"
import { useChanges } from "../state"
import { ago, displayName, forgetUser, getUser, plural, snippet, titleOf } from "./common"
import { AppearanceCard, DesktopAlertsCard, Sidebar } from "./preferences"

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
    const threads: [Group, NostrEvent][] = []
    const comments: [Group, NostrEvent][] = []
    for (const g of allGroups()) {
      for (const t of g.threads.values()) if (t.pubkey === pubkey && !g.isDeleted(t)) threads.push([g, t])
      for (const c of g.comments.values()) if (c.pubkey === pubkey && !g.isDeleted(c)) comments.push([g, c])
    }
    threads.sort((a, b) => b[1].created_at - a[1].created_at)
    comments.sort((a, b) => b[1].created_at - a[1].created_at)
    return { threads, comments }
  })

  return (
    <div class={isMe ? "account-page" : "profile-page"}>
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

      {isMe && <Account />}

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

function Account() {
  return (
    <div class="layout account-layout">
      <Sidebar
        label="Account sections"
        items={[
          { id: "name", label: "name" },
          { id: "appearance", label: "appearance" },
          { id: "notifications", label: "notifications" },
          { id: "google", label: "google account" },
          { id: "keys", label: "keys" }
        ]}
      />
      <div class="stack account-stack">
        <NameCard />
        <AppearanceCard />
        <DesktopAlertsCard />
        <GoogleCard />
        <KeysCard />
      </div>
    </div>
  )
}

function NameCard() {
  const [name, setName] = createSignal(displayName(me))
  const [busy, setBusy] = createSignal(false)
  const [msg, setMsg] = createSignal("")
  const pending = pendingName()
  return (
    <section id="name" class="card" aria-labelledby="name-heading">
      <div class="card-h">
        <h2 id="name-heading">name</h2>
        <p>
          {pending
            ? "You got a made-up name. Keep it or pick your own; it's published when you save or first post."
            : "Shown next to everything you post, in every forum."}
        </p>
      </div>
      <div class="card-b">
        <form
          onSubmit={async e => {
            e.preventDefault()
            setBusy(true)
            setMsg("")
            try {
              await setProfileName(name().trim())
              forgetUser(me)
              setMsg("saved")
            } catch (err) {
              setMsg(`Couldn't save: ${(err as Error).message ?? err}`)
            } finally {
              setBusy(false)
            }
          }}
        >
          <div class="field">
            <label for="name">name</label>
            <input id="name" class="inp" value={name()} required maxLength={60} onInput={e => setName((e.target as HTMLInputElement).value)} />
          </div>
          <div class="row">
            <button class="btn pri" type="submit" disabled={busy()}>
              {busy() ? "saving…" : "save name"}
            </button>
            {msg() && <span class="where">{msg()}</span>}
          </div>
        </form>
      </div>
    </section>
  )
}

function GoogleCard() {
  const [link, setLink] = createSignal(pomegranateLink())
  const [log, setLog] = createSignal<string[]>([])
  const [error, setError] = createSignal("")
  const [busy, setBusy] = createSignal(false)
  const sk = localSecretKey()

  const run = async () => {
    setBusy(true)
    setError("")
    setLog([])
    try {
      const result = await linkGoogle(sk, m => setLog(l => [...l, m]))
      setPomegranateLink({ token: result.token, central: result.central, email: result.email })
      setLink(pomegranateLink())
      setLog(l => [...l, "done"])
    } catch (err) {
      setError(String((err as Error).message ?? err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section id="google" class="card" aria-labelledby="google-heading">
      <div class="card-h">
        <h2 id="google-heading">google account</h2>
        <p>
          Your key lives only in this browser. Linking a Google account splits it across several{" "}
          <a class="underline" href="https://github.com/fiatjaf/pomegranate" target="_blank" rel="noopener">
            Pomegranate
          </a>{" "}
          operators, so you can log in with Google on another device and keep posting as yourself.
        </p>
      </div>
      <div class="card-b">
        {link() ? (
          <div class="notice" role="status">
            <span class="notice-title">linked</span>
            <span>
              {link()!.email || "a Google account"} · {new URL(link()!.central).host}
            </span>
          </div>
        ) : sk ? (
          <div class="row">
            <button class="btn pri" type="button" disabled={busy()} onClick={run}>
              {busy() ? "linking…" : "link google account"}
            </button>
          </div>
        ) : (
          <p class="help">You're signing with a remote signer, so there's no key here to link.</p>
        )}
        {log().length > 0 && <pre class="cheat link-log">{log().join("\n")}</pre>}
        {error() && (
          <p class="err" role="alert">
            {error()}
          </p>
        )}
      </div>
    </section>
  )
}

function KeysCard() {
  const [shown, setShown] = createSignal(false)
  const [input, setInput] = createSignal("")
  const [error, setError] = createSignal("")
  const [busy, setBusy] = createSignal(false)
  const secret = nsec()

  return (
    <section id="keys" class="card" aria-labelledby="keys-heading">
      <div class="card-h">
        <h2 id="keys-heading">keys</h2>
        <p>
          {accountType() === "nsec"
            ? "This browser holds your secret key. Save it somewhere if you want to use this identity elsewhere."
            : "You sign through a remote signer (bunker)."}
        </p>
      </div>
      <div class="card-b">
        {secret && (
          <div class="feeds">
            <span>secret key</span>
            <input class="inp wide mono" type={(shown() ? "text" : "password") as "text"} readOnly value={secret} aria-label="Secret key" />
            <button class="btn" type="button" onClick={() => setShown(!shown())}>
              {shown() ? "hide" : "show"}
            </button>
          </div>
        )}

        <div class="sub">
          <div class="sub-h">
            <h3>use another identity</h3>
          </div>
          <p class="help">
            Paste an nsec or a bunker:// link, or log in with a Google account linked elsewhere. The current key is forgotten by
            this browser, so save it first.
          </p>
          <form
            class="row-inline"
            onSubmit={async e => {
              e.preventDefault()
              setError("")
              setBusy(true)
              try {
                const v = input().trim()
                if (!confirm("Switch identity? The current key will be forgotten by this browser.")) return
                if (v.startsWith("bunker://") || v.includes("@")) await useBunker(v)
                else useSecretKey(v)
              } catch (err) {
                setError(String((err as Error).message ?? err))
              } finally {
                setBusy(false)
              }
            }}
          >
            <input
              class="inp wide mono"
              placeholder="nsec1… or bunker://…"
              aria-label="Secret key or bunker"
              value={input()}
              onInput={e => setInput((e.target as HTMLInputElement).value)}
            />
            <button class="btn" type="submit" disabled={busy()}>
              use
            </button>
          </form>
          <div class="row">
            <button
              class="btn"
              type="button"
              disabled={busy()}
              onClick={async () => {
                if (!confirm("Log in with Google? The current key will be forgotten by this browser.")) return
                setBusy(true)
                setError("")
                try {
                  const result = await linkGoogle(null, () => {})
                  await useBunker(result.bunker, () =>
                    setPomegranateLink({ token: result.token, central: result.central, email: result.email })
                  )
                } catch (err) {
                  setError(String((err as Error).message ?? err))
                } finally {
                  setBusy(false)
                }
              }}
            >
              log in with google
            </button>
            <button
              class="btn ghost"
              type="button"
              onClick={() => {
                if (confirm("Make a brand new key? The current one will be forgotten by this browser.")) startFresh()
              }}
            >
              start over with a new key
            </button>
          </div>
          {error() && (
            <p class="err" role="alert">
              {error()}
            </p>
          )}
        </div>
      </div>
    </section>
  )
}
