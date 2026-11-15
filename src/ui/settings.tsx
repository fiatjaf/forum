import * as nip19 from "@nostr/tools/nip19"
import { useEffect, useState } from "preact/hooks"
import { removeFromMyGroups, type Group } from "../groups"
import { me } from "../nostr"
import { UserLink, navigate } from "./common"
import { ForumFields, type ForumForm } from "./create"

function formFrom(g: Group): ForumForm {
  return {
    name: g.metadata?.name ?? "",
    about: g.metadata?.about ?? "",
    picture: g.metadata?.picture ?? "",
    isPrivate: !!g.metadata?.isPrivate,
    isClosed: !!g.metadata?.isClosed
  }
}

export function ForumSettings({ group: g }: { group: Group }) {
  const [form, setForm] = useState<ForumForm>(() => formFrom(g))
  const [touched, setTouched] = useState(false)
  const [error, setError] = useState("")
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)

  // the metadata may arrive after the page opened
  useEffect(() => {
    if (!touched) setForm(formFrom(g))
  }, [g.metadata?.event.id])

  if (!g.isAdmin()) {
    return (
      <div class="admin-page">
        <div class="pagehead">
          <h1 class="pt">
            <span class="p">~/</span>settings
          </h1>
        </div>
        <p>Only admins of this forum can change its settings.</p>
        <LeaveForum group={g} />
      </div>
    )
  }

  return (
    <div class="admin-page">
      <div class="pagehead">
        <h1 class="pt">
          <span class="p">~/</span>settings
        </h1>
      </div>

      {error && (
        <p class="err" role="alert">
          {error}
        </p>
      )}

      <form
        class="account-form admin-settings-form"
        onSubmit={async e => {
          e.preventDefault()
          setBusy(true)
          setError("")
          setSaved(false)
          try {
            await g.editMetadata(form)
            setSaved(true)
            setTouched(false)
          } catch (err) {
            setError(`Couldn't save: ${(err as Error).message ?? err}`)
          } finally {
            setBusy(false)
          }
        }}
      >
        <ForumFields
          form={form}
          set={f => {
            setTouched(true)
            setSaved(false)
            setForm({ ...form, ...f })
          }}
        />
        <div class="account-form-actions">
          <button class="btn pri" type="submit" disabled={busy}>
            {busy ? "saving…" : "save settings"}
          </button>
          {saved && <span class="where">saved; the relay updates the forum in a moment</span>}
        </div>
      </form>

      <Members group={g} />
      <Invites group={g} />
      <LeaveForum group={g} />
    </div>
  )
}

function Members({ group: g }: { group: Group }) {
  const [input, setInput] = useState("")
  const [error, setError] = useState("")
  const members = [...new Set([...g.admins.keys(), ...(g.members ?? [])])]

  return (
    <section class="panel account-section" aria-labelledby="members-heading">
      <h2 class="label" id="members-heading">
        members
      </h2>
      {members.length ? (
        <ul class="member-list">
          {members.map(pk => (
            <li key={pk}>
              <UserLink pubkey={pk} group={g} />
              {g.isAdmin(pk) && <span class="flag a">{g.admins.get(pk)?.join(", ") || "admin"}</span>}
              <span class="sp"></span>
              {pk !== me && !g.isAdmin(pk) && (
                <button
                  class="inline-button"
                  type="button"
                  onClick={async () => {
                    if (!confirm("Remove this member?")) return
                    try {
                      await g.removeUser(pk)
                    } catch (err) {
                      alert(`Couldn't remove: ${(err as Error).message}`)
                    }
                  }}
                >
                  remove
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p class="hint">The relay doesn't publish the member list.</p>
      )}
      <form
        class="row-inline"
        onSubmit={async e => {
          e.preventDefault()
          setError("")
          try {
            const v = input.trim()
            let pk = v
            if (v.startsWith("npub1") || v.startsWith("nprofile1")) {
              const d = nip19.decode(v)
              pk = d.type === "npub" ? d.data : d.type === "nprofile" ? d.data.pubkey : ""
            }
            if (!/^[0-9a-f]{64}$/.test(pk)) throw new Error("paste an npub")
            await g.putUser(pk)
            setInput("")
          } catch (err) {
            setError(String((err as Error).message ?? err))
          }
        }}
      >
        <input class="inp mono wide" placeholder="npub1…" aria-label="Add a member" value={input} onInput={e => setInput((e.target as HTMLInputElement).value)} />
        <button class="btn" type="submit">
          add member
        </button>
      </form>
      {error && (
        <p class="err" role="alert">
          {error}
        </p>
      )}
    </section>
  )
}

function Invites({ group: g }: { group: Group }) {
  const [links, setLinks] = useState<string[]>([])
  const [error, setError] = useState("")
  return (
    <section class="panel account-section" aria-labelledby="invites-heading">
      <h2 class="label" id="invites-heading">
        invite links
      </h2>
      <p class="hint">Anyone with an invite link can join, even when the forum is closed.</p>
      {links.map(l => (
        <div class="row-inline" key={l}>
          <input class="inp mono wide" readOnly value={l} aria-label="Invite link" />
          <button class="btn" type="button" onClick={() => navigator.clipboard?.writeText(l)}>
            copy
          </button>
        </div>
      ))}
      <div class="row-inline">
        <button
          class="btn"
          type="button"
          onClick={async () => {
            setError("")
            try {
              const code = await g.createInvite()
              setLinks([...links, `${location.origin}/${g.naddr}?invite=${code}`])
            } catch (err) {
              setError(String((err as Error).message ?? err))
            }
          }}
        >
          make an invite link
        </button>
      </div>
      {error && (
        <p class="err" role="alert">
          {error}
        </p>
      )}
    </section>
  )
}

function LeaveForum({ group: g }: { group: Group }) {
  return (
    <section class="panel account-section" aria-labelledby="leave-heading">
      <h2 class="label" id="leave-heading">
        leave forum
      </h2>
      <p class="hint">Leaves the group on the relay and removes it from your list of forums.</p>
      <div class="row-inline">
        <button
          class="btn danger"
          type="button"
          onClick={async () => {
            if (!confirm(`Leave ${g.name}?`)) return
            try {
              await g.leave()
            } catch {
              // not a member on the relay; still take it off the list
              await removeFromMyGroups(g).catch(() => {})
            }
            navigate("/")
          }}
        >
          leave this forum
        </button>
      </div>
    </section>
  )
}
