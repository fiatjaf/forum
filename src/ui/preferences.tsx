import { For, Show, createEffect, createSignal, on, onCleanup } from "solid-js"
import type { Group } from "../groups"
import { useChanges } from "../state"

// ─── sidebar ───────────────────────────────────────────────────
// Soliloquy's account page uses a sticky table of contents that follows the
// section being read. The same nav is reused on the forum settings page.

export type SidebarItem = { id: string; label: string; red?: boolean }

export function Sidebar(props: { label: string; items: SidebarItem[] }) {
  let nav!: HTMLElement

  createEffect(
    on(
      () => props.items.map(i => i.id).join(" "),
      () => {
        const sections = Array.from(nav.querySelectorAll<HTMLAnchorElement>('a[href^="#"]'))
          .map(link => ({ link, section: document.getElementById(link.hash.slice(1)) }))
          .filter((entry): entry is { link: HTMLAnchorElement; section: HTMLElement } => !!entry.section)
        if (!sections.length) return

        const markCurrent = (current: (typeof sections)[number] | undefined) => {
          for (const entry of sections) {
            if (entry === current) entry.link.setAttribute("aria-current", "true")
            else entry.link.removeAttribute("aria-current")
          }
        }

        // The section under the reading line near the top is the current one.
        // The last section may be too short to reach the line, so the end of
        // the page selects it. A click wins for a moment, because the browser
        // can land at the bottom when scrolling to a section near the end.
        let clicked = 0
        const updateCurrent = () => {
          if (clicked) return
          let current = sections[0]
          for (const entry of sections) {
            if (entry.section.getBoundingClientRect().top <= 120) current = entry
          }
          const atEnd = window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2
          markCurrent(atEnd ? sections[sections.length - 1] : current)
        }

        const offs = sections.map(entry => {
          const onClick = () => {
            markCurrent(entry)
            window.clearTimeout(clicked)
            clicked = window.setTimeout(() => {
              clicked = 0
            }, 300)
          }
          entry.link.addEventListener("click", onClick)
          return () => entry.link.removeEventListener("click", onClick)
        })

        window.addEventListener("scroll", updateCurrent, { passive: true })
        window.addEventListener("resize", updateCurrent)
        updateCurrent()

        onCleanup(() => {
          window.clearTimeout(clicked)
          window.removeEventListener("scroll", updateCurrent)
          window.removeEventListener("resize", updateCurrent)
          for (const off of offs) off()
        })
      }
    )
  )

  return (
    <nav ref={nav} class="toc" aria-label={props.label}>
      <For each={props.items}>
        {item => (
          <a href={`#${item.id}`} class={item.red ? "red" : undefined}>
            {item.label}
          </a>
        )}
      </For>
    </nav>
  )
}

// ─── appearance ────────────────────────────────────────────────

export function AppearanceCard() {
  const [theme, setTheme] = createSignal(localStorage.getItem("theme") || "auto")
  const pick = (t: string) => {
    setTheme(t)
    document.documentElement.className = "sq " + t
    try {
      localStorage.setItem("theme", t)
    } catch {}
  }
  return (
    <section id="appearance" class="card" aria-labelledby="appearance-heading">
      <div class="card-h">
        <h2 id="appearance-heading">appearance</h2>
        <p>Saved in this browser.</p>
      </div>
      <div class="card-b">
        <fieldset class="seg" aria-label="Theme">
          <For each={["auto", "light", "dark"] as const}>
            {t => (
              <label>
                <input type="radio" name="theme" value={t} checked={theme() === t} onChange={() => pick(t)} />
                <span>{t === "auto" ? "system" : t}</span>
              </label>
            )}
          </For>
        </fieldset>
      </div>
    </section>
  )
}

// ─── desktop notifications ─────────────────────────────────────
// The preference is per browser, so it lives in localStorage rather than on
// the account. Permission is separate: it can be revoked by the browser.

const DESKTOP_ALERTS_KEY = "desktop-alerts"

export function desktopAlertsEnabled(): boolean {
  try {
    return localStorage.getItem(DESKTOP_ALERTS_KEY) === "on"
  } catch {
    return false
  }
}

function setDesktopAlertsEnabled(enabled: boolean) {
  try {
    if (enabled) localStorage.setItem(DESKTOP_ALERTS_KEY, "on")
    else localStorage.removeItem(DESKTOP_ALERTS_KEY)
  } catch {}
}

export function desktopAlertsActive(): boolean {
  return desktopAlertsEnabled() && typeof Notification !== "undefined" && Notification.permission === "granted"
}

type AlertsState = "unsupported" | "blocked" | "on" | "off"

function alertsState(): AlertsState {
  if (typeof Notification === "undefined") return "unsupported"
  if (Notification.permission === "denied") return "blocked"
  return desktopAlertsActive() ? "on" : "off"
}

export function DesktopAlertsCard() {
  const [state, setState] = createSignal<AlertsState>(alertsState())

  const refresh = () => setState(alertsState())

  const toggle = async () => {
    if (state() === "on") {
      setDesktopAlertsEnabled(false)
      refresh()
      return
    }
    try {
      const permission = await Notification.requestPermission()
      if (permission === "granted") setDesktopAlertsEnabled(true)
    } catch {}
    refresh()
  }

  const status = () => {
    switch (state()) {
      case "unsupported":
        return "not supported"
      case "blocked":
        return "blocked by the browser"
      case "on":
        return "on"
      default:
        return "off"
    }
  }

  return (
    <section id="notifications" class="card" aria-labelledby="notifications-heading">
      <div class="card-h">
        <h2 id="notifications-heading">notifications</h2>
        <p>
          Alerts for replies to you, comments on your threads and mentions. The bell in the header always shows them.
        </p>
      </div>
      <div class="sub">
        <div class="sub-h">
          <h3>desktop alerts</h3>
          <span class="where">this browser only</span>
          <span class="sp"></span>
          <span class={"pill" + (state() === "on" ? " on" : "")} role="status">
            {status()}
          </span>
        </div>
        <p class="help">A system alert when something new comes in while the forum is open in a background tab.</p>
        <Show when={state() !== "unsupported"}>
          <div class="row">
            <button class="btn" type="button" disabled={state() === "blocked"} onClick={toggle}>
              {state() === "on" ? "turn off" : "turn on desktop alerts"}
            </button>
          </div>
        </Show>
      </div>
    </section>
  )
}

// ─── programmatic access ───────────────────────────────────────

export function ProgrammaticAccess(props: { group?: Group }) {
  const [copied, setCopied] = createSignal(false)

  const address = () => {
    useChanges()
    const g = props.group
    if (!g) return "<address>"
    return g.naddr ?? `${g.relay.replace(/^wss?:\/\//, "").replace(/\/$/, "")}/${g.id}`
  }
  const relay = () => props.group?.relay ?? "<server>"
  const groupId = () => props.group?.id ?? "<group-id>"

  const copy = () => {
    if (!navigator.clipboard) return
    navigator.clipboard
      .writeText(address())
      .then(() => {
        setCopied(true)
        window.setTimeout(() => setCopied(false), 1200)
      })
      .catch(() => {})
  }

  return (
    <section id="programmatic" class="card" aria-labelledby="programmatic-heading">
      <div class="card-h">
        <h2 id="programmatic-heading">programmatic access</h2>
        <p>
          Forums here use an open protocol, so any compatible app or script can read and post too.{" "}
          <a class="underline" href="https://github.com/fiatjaf/nak" target="_blank" rel="noopener">
            nak
          </a>{" "}
          is a small command-line tool that can.
        </p>
      </div>
      <div class="card-b">
        <Show
          when={props.group}
          fallback={
            <p class="help">
              Open a forum's settings to copy its address. The examples below use <code>&lt;group-id&gt;</code>,{" "}
              <code>&lt;server&gt;</code>, <code>&lt;thread-id&gt;</code> and <code>&lt;thread-author&gt;</code> as
              placeholders.
            </p>
          }
        >
          <div class="field">
            <label for="group-address">group address</label>
            <div class="row-inline">
              <input
                id="group-address"
                class="inp wide mono"
                type="text"
                readonly
                value={address()}
                aria-label="Group address"
              />
              <button class="btn" type="button" onClick={copy}>
                {copied() ? "copied" : "copy"}
              </button>
            </div>
          </div>
        </Show>

        <div class="programmatic-block">
          <h3>read</h3>
          <pre class="api-example">{`# group metadata, admins and members
nak req -k 39000 -d ${groupId()} ${relay()}
nak req -k 39001 -d ${groupId()} ${relay()}
nak req -k 39002 -d ${groupId()} ${relay()}

# threads and comments
nak req -k 11 -h ${groupId()} -l 20 ${relay()}
nak req -k 1111 -h ${groupId()} -l 50 ${relay()}

# one thread
nak req -i <thread-id> ${relay()}`}</pre>
        </div>

        <div class="programmatic-block">
          <h3>write</h3>
          <pre class="api-example">{`# post a thread
nak event -k 11 -h ${groupId()} -t "title=hello world" -c "first post" ${relay()}

# reply to a thread
nak event -k 1111 -h ${groupId()} \\
  -t E=<thread-id> -t K=11 -t P=<thread-author> \\
  -t e=<thread-id> -t k=11 -t p=<thread-author> \\
  -c "nice thread" ${relay()}

# join or leave
nak event -k 9021 -h ${groupId()} ${relay()}
nak event -k 9022 -h ${groupId()} ${relay()}`}</pre>
        </div>

        <p class="help">
          Replace the placeholders with the forum's group id and the thread's id and author. Private groups need{" "}
          <code>--auth</code>, and your key goes in <code>--sec</code> or a local signer.
        </p>
      </div>
    </section>
  )
}
