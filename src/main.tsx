import "./style.css"
import "./extra.css"
import { type Accessor, Show, createEffect, createMemo, createSignal } from "solid-js"
import { render } from "solid-js/web"
import { loggedIn, me, pendingName, ensureProfile } from "./account"
import { getGroup, parseNaddr, type Group } from "./groups"
import { activate, startSync } from "./sync"
import { useChanges } from "./state"
import { displayName, navigate } from "./ui/common"
import { Home } from "./ui/home"
import { CreateForum } from "./ui/create"
import { Forum } from "./ui/forum"
import { ThreadPage } from "./ui/thread"
import { NewThread } from "./ui/newthread"
import { ForumSettings } from "./ui/settings"
import { ForumAdmin } from "./ui/admin"
import { SearchPage } from "./ui/search"
import { Profile } from "./ui/profile"
import { AccountPage } from "./ui/account"
import { Login } from "./ui/login"
import { Notifications, unreadNotifications, watchDesktopAlerts } from "./ui/notifications"
import { Resolve } from "./ui/resolve"

type Route = (
  | { page: "home" }
  | { page: "create" }
  | { page: "notifications" }
  | { page: "account" }
  | { page: "profile"; code: string }
  | { page: "resolve"; code: string }
  | { page: "forum"; naddr: string; group: Group; sub: string[] }
  | { page: "notfound" }
) & { path: string; search: string }

function parseRoute(): Route {
  const path = location.pathname
  const search = location.search
  const parts = location.pathname.split("/").filter(Boolean)
  const [first, ...rest] = parts
  function withPath<T>(r: T): T & { path: string; search: string } {
    return { ...r, path, search }
  }
  if (!first) return withPath({ page: "home" })
  if (first === "new" && !rest.length) return withPath({ page: "create" })
  if (first === "notifications") return withPath({ page: "notifications" })
  if (first === "account" && !rest.length) return withPath({ page: "account" })
  if (first.startsWith("npub1") || first.startsWith("nprofile1")) return withPath({ page: "profile", code: first })
  if (first.startsWith("nevent1") || first.startsWith("note1")) return withPath({ page: "resolve", code: first })
  if (first.startsWith("naddr1")) {
    const ref = parseNaddr(first)
    if (ref) return withPath({ page: "forum", naddr: first, group: getGroup(ref), sub: rest })
  }
  return withPath({ page: "notfound" })
}

function App() {
  const route = createMemo(
    () => {
      useChanges()
      return parseRoute()
    },
    undefined,
    { equals: (a, b) => a.path === b.path && a.search === b.search }
  )

  createEffect(() => {
    const r = route()
    if (r.page === "forum") activate(r.group)
  })

  createEffect(() => {
    useChanges()
    const r = route()
    document.title = r.page === "forum" ? r.group.name : "forums"
  })

  watchDesktopAlerts()

  return (
    <>
      <Header route={route} />
      <main class="wrap">
        <Welcome />
        <Show when={route()} keyed>
          {r => <Page route={r} />}
        </Show>
        <footer class="foot">
          <span>a simple forum app</span>
        </footer>
      </main>
    </>
  )
}

function Page(props: { route: Route }) {
  const r = props.route
  switch (r.page) {
    case "home":
      return <Home />
    case "create":
      return <CreateForum />
    case "notifications":
      return <Notifications />
    case "account":
      return <AccountPage />
    case "profile":
      return <Profile code={r.code} />
    case "resolve":
      return <Resolve code={r.code} />
    case "forum": {
      const [sub, ...more] = r.sub
      if (!sub) return <Forum group={r.group} />
      if (sub === "new") return <NewThread group={r.group} />
      if (sub === "settings") return <ForumSettings group={r.group} />
      if (sub === "admin") return <ForumAdmin group={r.group} />
      if (sub === "search") return <SearchPage group={r.group} />
      if (/^[0-9a-f]{64}$/.test(sub) && !more.length) return <ThreadPage group={r.group} id={sub} />
      return <NotFound />
    }
    default:
      return <NotFound />
  }
}

function Header(props: { route: Accessor<Route> }) {
  const group = () => {
    useChanges()
    const r = props.route()
    return r.page === "forum" ? r.group : null
  }
  const base = () => {
    const g = group()
    return g ? `/${g.naddr}` : null
  }
  const path = () => props.route().path
  const q = () => new URLSearchParams(props.route().search).get("q") ?? ""
  const unread = () => {
    useChanges()
    return unreadNotifications()
  }
  const myName = () => {
    useChanges()
    return displayName(me)
  }
  const isAdmin = () => {
    useChanges()
    return !!group()?.isAdmin()
  }
  const tab = (href: string, label: string) => (
    <a class={path() === href ? "on" : ""} aria-current={path() === href ? "page" : undefined} href={href}>
      {label}
    </a>
  )
  const nav = () => (
    <>
      {base() && tab(base()!, "threads")}
      {base() && tab(base() + "/settings", "settings")}
      {base() && isAdmin() && tab(base() + "/admin", "admin")}
      {tab("/", "forums")}
    </>
  )
  return (
    <>
      <header class="top">
        <div class="wrap">
          <a class="logo" href={base() ?? "/"} aria-label="home">
            <span class="p">›</span>
            <span class="name">{group()?.name ?? "forums"}</span>
            <span class="cur"></span>
          </a>
          <nav class="nav" aria-label="Main">
            {nav()}
          </nav>
          <div class="sp"></div>
          {base() && (
            <form
              class="search"
              role="search"
              onSubmit={e => {
                e.preventDefault()
                const v = ((e.target as HTMLFormElement).elements.namedItem("q") as HTMLInputElement).value
                navigate(`${base()}/search?q=${encodeURIComponent(v)}`)
              }}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                stroke-width="1.6"
                aria-hidden="true"
              >
                <circle cx="7" cy="7" r="4.5"></circle>
                <path d="m10.5 10.5 3.5 3.5"></path>
              </svg>
              <input type="search" name="q" value={q()} placeholder="search" aria-label="Search threads and comments" />
            </form>
          )}
          {base() && (
            <a class="ib search-link" href={`${base()}/search`} aria-label="Search">
              <svg
                width="19"
                height="19"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                stroke-width="1.5"
                aria-hidden="true"
              >
                <circle cx="7" cy="7" r="4.5"></circle>
                <path d="m10.5 10.5 3.5 3.5"></path>
              </svg>
            </a>
          )}
          {base() ? (
            <a class="btn pri" href={`${base()}/new`}>
              <span class="btn-text">+ new thread</span>
              <svg
                class="btn-icon"
                width="18"
                height="18"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                stroke-width="1.8"
                aria-hidden="true"
              >
                <path d="M8 3v10M3 8h10"></path>
              </svg>
            </a>
          ) : (
            <a class="btn pri" href="/new">
              <span class="btn-text">+ new forum</span>
              <svg
                class="btn-icon"
                width="18"
                height="18"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                stroke-width="1.8"
                aria-hidden="true"
              >
                <path d="M8 3v10M3 8h10"></path>
              </svg>
            </a>
          )}
          <a
            class="ib notifications-link"
            href="/notifications"
            aria-label={`Notifications${unread() ? `, ${unread()} unread` : ""}`}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              stroke-width="1.6"
              aria-hidden="true"
            >
              <path d="M5 8a5 5 0 0 1 10 0c0 4 1.5 5.5 2 6H3c.5-.5 2-2 2-6Z"></path>
              <path d="M8 16.5a2 2 0 0 0 4 0"></path>
            </svg>
            {unread() > 0 && <span class="badge">{unread()}</span>}
          </a>
          <a class="me" href="/account">
            {myName()}
          </a>
        </div>
      </header>
      <nav class="sub" aria-label="Main">
        {nav()}
        <span class="sp"></span>
        <a href="/account">{myName()}</a>
      </nav>
    </>
  )
}

// A key was made for this browser with a made-up name: say so once, and let
// the person keep it or pick another.
function Welcome() {
  const [dismissed, setDismissed] = createSignal<boolean>(localStorage.getItem("welcomed") === "1")
  const name = () => {
    useChanges()
    if (dismissed() || location.pathname === "/account") return null
    return pendingName()
  }
  const close = () => {
    try {
      localStorage.setItem("welcomed", "1")
    } catch {}
    setDismissed(true)
  }
  return (
    <Show when={name()}>
      {name => (
        <div class="notice welcome" role="status">
          <span class="notice-title">hello</span>
          <span>
            You're <b>{name()}</b> here. This browser made a key for you.{" "}
            <a class="accent" href="/account#name" onClick={close}>
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
      )}
    </Show>
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

render(() => (loggedIn ? <App /> : <Login />), document.getElementById("app")!)
if (loggedIn) startSync()
