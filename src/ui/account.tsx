import { createSignal } from "solid-js"
import { myGroups } from "../groups"
import {
  accountType,
  localSecretKey,
  logout,
  me,
  nsec,
  pendingName,
  pomegranateLink,
  setPomegranateLink,
  setProfileName
} from "../account"
import { linkGoogle } from "../pomegranate"
import { useChanges } from "../state"
import { displayName, forgetUser, npub, plural } from "./common"
import { AppearanceCard, DesktopAlertsCard, ProgrammaticAccess, Sidebar } from "./preferences"

export function AccountPage() {
  return (
    <div class="account-page">
      <div class="pagehead">
        <h1 class="pt">
          <span class="p">~/</span>account
        </h1>
        <span class="sp"></span>
        <button
          class="btn"
          type="button"
          onClick={() => {
            if (!confirm("Log out? This browser will forget your key. Save your nsec first if you need it.")) return
            logout()
          }}
        >
          log out
        </button>
      </div>

      <div class="layout account-layout">
        <Sidebar
          label="Account sections"
          items={[
            { id: "profile", label: "profile" },
            { id: "name", label: "name" },
            { id: "appearance", label: "appearance" },
            { id: "notifications", label: "notifications" },
            { id: "programmatic", label: "programmatic access" }
          ]}
        />
        <div class="stack account-stack">
          <WhoAmI />
          <NameCard />
          <AppearanceCard />
          <DesktopAlertsCard />
          <ProgrammaticAccess />
        </div>
      </div>
    </div>
  )
}

// The quick summary: what this browser knows about the identity it signs as.
function WhoAmI() {
  const [busy, setBusy] = createSignal(false)
  const [step, setStep] = createSignal("")
  const [error, setError] = createSignal("")
  const [showKey, setShowKey] = createSignal(false)
  const sk = localSecretKey()
  const secret = nsec()

  const link = () => {
    useChanges()
    return pomegranateLink()
  }
  const forums = () => {
    useChanges()
    return myGroups.length
  }
  const pending = () => {
    useChanges()
    return pendingName()
  }

  const linkAccount = async () => {
    if (!sk) return
    setBusy(true)
    setError("")
    setStep("")
    try {
      const result = await linkGoogle(sk, m => setStep(m))
      setPomegranateLink({ token: result.token, central: result.central, email: result.email })
      setStep("done")
    } catch (err) {
      setError(String((err as Error).message ?? err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section id="profile" class="card" aria-label="Profile">
      <div class="term" role="group" aria-label="Your account">
        <div>
          <span class="ps">$</span> whoami
        </div>
        <dl class="kv">
          <dt>name</dt>
          <dd>
            {displayName(me)} {pending() && <span class="muted">(not published yet)</span>}
          </dd>
          <dt>npub</dt>
          <dd class="mono npub">{npub(me)}</dd>
          <dt>signer</dt>
          <dd>{accountType() === "nsec" ? "a key in this browser" : "a remote signer (bunker)"}</dd>
          <dt>nsec</dt>
          <dd>
            {secret ? (
              <>
                <span class="mono npub">{showKey() ? secret : "nsec1••••••••••••"}</span>{" "}
                <button class="inline-button accent" type="button" onClick={() => setShowKey(!showKey())}>
                  {showKey() ? "hide" : "show"}
                </button>
              </>
            ) : (
              "not in this browser (remote signer)"
            )}
          </dd>
          <dt>google</dt>
          <dd>
            {link() ? (
              `${link()!.email || "linked"} · ${new URL(link()!.central).host}`
            ) : accountType() === "nsec" ? (
              <>
                not linked ·{" "}
                <button
                  class="inline-button accent"
                  type="button"
                  disabled={busy()}
                  title="Split your key across Pomegranate operators so you can log in with Google on another device."
                  onClick={linkAccount}
                >
                  {busy() ? "linking…" : "link google account"}
                </button>
              </>
            ) : (
              "not available with a remote signer"
            )}
            {busy() && step() && <span class="muted"> · {step()}</span>}
          </dd>
          <dt>forums</dt>
          <dd>
            {plural(forums(), "forum")} ·{" "}
            <a class="accent" href="/">
              see your forums ›
            </a>
          </dd>
          <dt>public</dt>
          <dd>
            <a class="accent" href={`/${npub(me)}`}>
              your public profile ›
            </a>
          </dd>
        </dl>
        {error() && (
          <p class="err" role="alert">
            {error()}
          </p>
        )}
      </div>
    </section>
  )
}

function NameCard() {
  const [name, setName] = createSignal(displayName(me))
  const [busy, setBusy] = createSignal(false)
  const [msg, setMsg] = createSignal("")
  const pending = () => {
    useChanges()
    return pendingName()
  }
  return (
    <section id="name" class="card" aria-labelledby="name-heading">
      <div class="card-h">
        <h2 id="name-heading">name</h2>
        <p>
          {pending()
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
            <input
              id="name"
              class="inp"
              value={name()}
              required
              maxLength={60}
              onInput={e => setName((e.target as HTMLInputElement).value)}
            />
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
