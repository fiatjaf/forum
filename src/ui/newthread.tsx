import { useState } from "preact/hooks"
import type { Group } from "../groups"
import { Editor, navigate } from "./common"

export function NewThread({ group: g }: { group: Group }) {
  const [title, setTitle] = useState("")
  const [body, setBody] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const base = `/${g.naddr}`

  const submit = async () => {
    if (!title.trim() || busy) return
    setBusy(true)
    setError("")
    try {
      const evt = await g.createThread(title.trim(), body.trim())
      navigate(`${base}/${evt.id}`)
    } catch (err) {
      setError(`Couldn't post: ${(err as Error).message ?? err}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div class="thread-form-page">
      <div class="pagehead">
        <h1 class="pt">
          <span class="p">~/</span>new thread
        </h1>
      </div>
      {error && (
        <p class="err" role="alert">
          {error}
        </p>
      )}

      <div class="thread-form-layout">
        <form
          class="thread-form"
          aria-label="New thread"
          onSubmit={e => {
            e.preventDefault()
            submit()
          }}
        >
          <div class="field">
            <label for="thread-title">title</label>
            <input id="thread-title" class="inp" value={title} maxLength={200} required autofocus onInput={e => setTitle((e.target as HTMLInputElement).value)} />
            <div class="hint">
              <span></span>
              <span>{title.length} / 200</span>
            </div>
          </div>
          <div class="field">
            <label for="thread-body">
              body <span>(optional, markdown)</span>
            </label>
            <Editor id="thread-body" value={body} onInput={setBody} onSubmit={submit} label="Body" />
            <div class="hint">
              <span></span>
              <span>{body.length} / 20000</span>
            </div>
          </div>
          <div class="thread-form-actions">
            <button class="btn pri" type="submit" disabled={busy}>
              {busy ? "posting…" : "post thread"}
            </button>
            <a class="btn ghost" href={base}>
              cancel
            </a>
          </div>
        </form>

        <aside class="thread-help" aria-label="Markdown help">
          <div class="label">markdown</div>
          <pre class="cheat">
            <b>**bold**</b>
            {"      "}
            <b>_italic_</b>
            {"\n"}
            <b>`code`</b>
            {"        "}
            <b>```</b> block{"\n"}
            <b>[text](url)</b> link{"\n"}
            <b>&gt; quote</b>
            {"       "}
            <b>- list</b>
            {"\n"}
            <b>nostr:npub1…</b> mention{"\n"}
            <b>~~strike~~</b>
          </pre>
          <div class="label">how it shows</div>
          <p>New threads go to the top of the front page, and threads with new comments move up.</p>
        </aside>
      </div>
    </div>
  )
}
