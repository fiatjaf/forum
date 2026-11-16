import { createSignal } from "solid-js"
import { createAccount, setPomegranateLink, useBunker, useSecretKey } from "../nostr"
import { linkGoogle } from "../pomegranate"

type Busy = "" | "name" | "key" | "google"

export function Login() {
  const [name, setName] = createSignal("")
  const [key, setKey] = createSignal("")
  const [busy, setBusy] = createSignal<Busy>("")
  const [error, setError] = createSignal("")

  const create = (e: SubmitEvent) => {
    e.preventDefault()
    setError("")
    const value = name().trim()
    if (!value) {
      setError("Pick a name.")
      return
    }
    setBusy("name")
    try {
      createAccount(value)
    } catch (err) {
      setError(String((err as Error).message ?? err))
      setBusy("")
    }
  }

  const logIn = async (e: SubmitEvent) => {
    e.preventDefault()
    setError("")
    const value = key().trim()
    if (!value) {
      setError("Paste an nsec or a bunker:// link.")
      return
    }
    setBusy("key")
    try {
      if (value.startsWith("bunker://") || value.includes("@")) await useBunker(value)
      else useSecretKey(value)
    } catch (err) {
      setError(String((err as Error).message ?? err))
      setBusy("")
    }
  }

  const google = async () => {
    setError("")
    setBusy("google")
    try {
      const result = await linkGoogle(null, () => {})
      await useBunker(result.bunker, () =>
        setPomegranateLink({ token: result.token, central: result.central, email: result.email })
      )
    } catch (err) {
      setError(String((err as Error).message ?? err))
      setBusy("")
    }
  }

  return (
    <main class="wrap login-page">
      <div class="auth-page auth-login">
        <a class="logo login-logo" href="/" aria-label="home">
          <span class="p">›</span>forums<span class="cur"></span>
        </a>
        <pre class="getty">{`a nostr forum
this browser has no key`}</pre>

        <div class="card auth-card" aria-label="Log in">
          <div class="auth-fields">
            {error() && (
              <p class="err" role="alert">
                {error()}
              </p>
            )}

            <div class="auth-heading">pick a name</div>
            <form class="auth-fields" onSubmit={create}>
              <div class="field">
                <label for="login-name">name</label>
                <input
                  id="login-name"
                  class="inp"
                  value={name()}
                  maxLength={60}
                  required
                  autofocus
                  onInput={e => setName((e.target as HTMLInputElement).value)}
                />
              </div>
              <button class="btn" type="submit" disabled={!!busy()}>
                {busy() === "name" ? "creating…" : "ok"}
              </button>
              <p class="auth-note">A new key is made in this browser. You can copy it from the account page later.</p>
            </form>

            <div class="auth-heading">use an existing key</div>
            <form class="auth-fields" onSubmit={logIn}>
              <div class="field">
                <label for="login-key">nsec or bunker://</label>
                <input
                  id="login-key"
                  class="inp mono"
                  placeholder="nsec1… or bunker://…"
                  spellcheck={false}
                  value={key()}
                  onInput={e => setKey((e.target as HTMLInputElement).value)}
                />
              </div>
              <button class="btn" type="submit" disabled={!!busy()}>
                {busy() === "key" ? "logging in…" : "log in"}
              </button>
            </form>

            <div class="auth-heading">google</div>
            <button class="btn" type="button" disabled={!!busy()} onClick={google}>
              {busy() === "google" ? "connecting…" : "log in with google"}
            </button>
          </div>
        </div>

        <p class="auth-note">Keys live in this browser. Logging out forgets the key unless you saved it.</p>
      </div>
    </main>
  )
}
