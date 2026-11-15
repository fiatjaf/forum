import "./style.css"
import "./extra.css"
import { render } from "preact"
import { useEffect, useState } from "preact/hooks"
import { me, pendingName, ensureProfile } from "./nostr"
import { getGroup, parseNaddr, type Group } from "./groups"
import { activate, startSync } from "./sync"
import { useChanges } from "./state"
import { displayName, navigate, npub } from "./ui/common"
import { Home } from "./ui/home"
import { CreateForum } from "./ui/create"
import { Forum } from "./ui/forum"
import { ThreadPage } from "./ui/thread"
import { NewThread } from "./ui/newthread"
import { ForumSettings } from "./ui/settings"
import { SearchPage } from "./ui/search"
import { Profile } from "./ui/profile"
import { Notifications, unreadNotifications } from "./ui/notifications"
import { Resolve } from "./ui/resolve"

type Route =
  | { page: "home" }
  | { page: "create" }
  | { page: "notifications" }
  | { page: "profile"; code: string }
  | { page: "resolve"; code: string }
  | { page: "forum"; naddr: string; group: Group; sub: string[] }
  | { page: "notfound" }

function route(): Route {
  const parts = location.pathname.split("/").filter(Boolean)
  const [first, ...rest] = parts
  if (!first) return { page: "home" }
  if (first === "new" && !rest.length) return { page: "create" }
  if (first === "notifications") return { page: "notifications" }
  if (first.startsWith("npub1") || first.startsWith("nprofile1")) return { page: "profile", code: first }
  if (first.startsWith("nevent1") || first.startsWith("note1")) return { page: "resolve", code: first }
  if (first.startsWith("naddr1")) {
    const ref = parseNaddr(first)
    if (ref) return { page: "forum", naddr: first, group: getGroup(ref), sub: rest }
  }
  return { page: "notfound" }
}

function App() {
  useChanges()
  const r = route()
  const group = r.page === "forum" ? r.group : null

  useEffect(() => {
    if (group) activate(group)
  }, [group])

  useEffect(() => {
    const base = group ? group.name : "forums"
    document.title = base
  }, [group?.name])

  let content
  switch (r.page) {
    case "home":
      content = <Home />
      break
    case "create":
      content = <CreateForum />
      break
    case "notifications":
      content = <Notifications />
      break
    case "profile":
      content = <Profile code={r.code} />
      break
    case "resolve":
      content = <Resolve code={r.code} />
      break
    case "forum": {
      const [sub, ...more] = r.sub
      if (!sub) content = <Forum group={r.group} />
      else if (sub === "new") content = <NewThread group={r.group} />
      else if (sub === "settings") content = <ForumSettings group={r.group} />
      else if (sub === "search") content = <SearchPage group={r.group} />
      else if (/^[0-9a-f]{64}$/.test(sub) && !more.length) content = <ThreadPage group={r.group} id={sub} />
      else content = <NotFound />
      break
    }
    default:
      content = <NotFound />
  }

  return (
    <>
      <Header group={group} />
      <main class="wrap">
        <Welcome />
        {content}
        <footer class="foot">
          <span>
            a nostr forum · UI from <a href="https://github.com/skorokithakis/soliloquy">soliloquy</a>
          </span>
        </footer>
      </main>
    </>
  )
}

function Header({ group }: { group: Group | null }) {
  const base = group?.naddr ? `/${group.naddr}` : null
  const path = location.pathname
  const q = new URLSearchParams(location.search).get("q") ?? ""
  const unread = unreadNotifications()
  const nav = (
    <>
      {base ? (
        <a class={path === base ? "on" : ""} aria-current={path === base ? "page" : undefined} href={base}>
          threads
        </a>
      ) : null}
      {base && group?.isAdmin() ? (
        <a class={path === base + "/settings" ? "on" : ""} href={base + "/settings"}>
          settings
        </a>
      ) : null}
      <a class={path === "/" ? "on" : ""} aria-current={path === "/" ? "page" : undefined} href="/">
        forums
      </a>
    </>
  )
  return (
    <>
      <header class="top">
        <div class="wrap">
          <a class="logo" href={base ?? "/"} aria-label="home">
            <span class="p">›</span>
            {group ? group.name : "forums"}
            <span class="cur"></span>
          </a>
          <nav class="nav" aria-label="Main">
            {nav}
          </nav>
          <div class="sp"></div>
          {base && (
            <form
              class="search"
              role="search"
              onSubmit={e => {
                e.preventDefault()
                const v = ((e.target as HTMLFormElement).elements.namedItem("q") as HTMLInputElement).value
                navigate(`${base}/search?q=${encodeURIComponent(v)}`)
              }}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">
                <circle cx="7" cy="7" r="4.5"></circle>
                <path d="m10.5 10.5 3.5 3.5"></path>
              </svg>
              <input type="search" name="q" key={q} defaultValue={q} placeholder="search" aria-label="Search threads and comments" />
            </form>
          )}
          {base && (
            <a class="ib search-link" href={`${base}/search`} aria-label="Search">
              <svg width="19" height="19" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
                <circle cx="7" cy="7" r="4.5"></circle>
                <path d="m10.5 10.5 3.5 3.5"></path>
              </svg>
            </a>
          )}
          {base ? (
            <a class="btn pri" href={`${base}/new`}>
              <span class="btn-text">+ new thread</span>
              <svg class="btn-icon" width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
                <path d="M8 3v10M3 8h10"></path>
              </svg>
            </a>
          ) : (
            <a class="btn pri" href="/new">
              <span class="btn-text">+ new forum</span>
              <svg class="btn-icon" width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
                <path d="M8 3v10M3 8h10"></path>
              </svg>
            </a>
          )}
          <a class="ib notifications-link" href="/notifications" aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}>
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">
              <path d="M5 8a5 5 0 0 1 10 0c0 4 1.5 5.5 2 6H3c.5-.5 2-2 2-6Z"></path>
              <path d="M8 16.5a2 2 0 0 0 4 0"></path>
            </svg>
            {unread > 0 && <span class="badge">{unread}</span>}
          </a>
          <a class="me" href={`/${npub(me)}`}>
            {displayName(me)}
          </a>
        </div>
      </header>
      <nav class="sub" aria-label="Main">
        {nav}
        <span class="sp"></span>
        <a href={`/${npub(me)}`}>{displayName(me)}</a>
      </nav>
    </>
  )
}

// A key was made for this browser with a made-up name: say so once, and let
// the person keep it or pick another.
function Welcome() {
  const [dismissed, setDismissed] = useState(() => localStorage.getItem("welcomed") === "1")
  const name = pendingName()
  if (!name || dismissed || location.pathname === `/${npub(me)}`) return null
  const close = () => {
    try {
      localStorage.setItem("welcomed", "1")
    } catch {}
    setDismissed(true)
  }
  return (
    <div class="notice welcome" role="status">
      <span class="notice-title">hello</span>
      <span>
        You're <b>{name}</b> here. A key was made for you in this browser.{" "}
        <a class="accent" href={`/${npub(me)}`} onClick={close}>
          pick another name
        </a>{" "}
        ·{" "}
        <a
          href="#"
          onClick={e => {
            e.preventDefault()
            close()
            ensureProfile().catch(() => {})
          }}
        >
          keep it
        </a>
      </span>
    </div>
  )
}

function NotFound() {
  return (
    <div>
      <div class="pagehead">
        <h1 class="pt">
          <span class="p">~/</span>not found
        </h1>
      </div>
      <p>
        Nothing here. <a href="/">Back to your forums.</a>
      </p>
    </div>
  )
}

render(<App />, document.getElementById("app")!)
startSync()
