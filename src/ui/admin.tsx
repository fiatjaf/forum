import * as nip19 from "@nostr/tools/nip19"
import { For, Show, createEffect, createSignal, untrack } from "solid-js"
import type { Group } from "../groups"
import { me } from "../account"
import { useChanges } from "../state"
import { UserLink, navigate } from "./common"
import { ForumFields, type ForumForm } from "./create"
import { Sidebar } from "./preferences"

function formFrom(g: Group): ForumForm {
  return {
    name: g.metadata?.name ?? "",
    about: g.metadata?.about ?? "",
    picture: g.metadata?.picture ?? "",
    isPrivate: !!g.metadata?.isPrivate,
    isClosed: !!g.metadata?.isClosed
  }
}

const errorText = (err: unknown) => String((err as Error)?.message ?? err)

export function ForumAdmin(props: { group: Group }) {
  const g = props.group
  const isAdmin = () => {
    useChanges()
    return g.isAdmin()
  }

  return (
    <div class="account-page">
      <div class="pagehead">
        <h1 class="pt">
          <span class="p">~/</span>admin
        </h1>
      </div>

      <Show
        when={isAdmin()}
        fallback={
          <p>
            Only admins of this forum can see this page. <a href={`/${g.naddr}`}>Back to the threads.</a>
          </p>
        }
      >
        <div class="layout">
          <Sidebar
            label="Admin sections"
            items={[
              { id: "forum", label: "forum" },
              { id: "members", label: "members" },
              { id: "invites", label: "invites" },
              { id: "delete", label: "delete forum", red: true }
            ]}
          />
          <div class="stack">
            <ForumCard group={g} />
            <Members group={g} />
            <Invites group={g} />
            <DeleteForum group={g} />
          </div>
        </div>
      </Show>
    </div>
  )
}

function ForumCard(props: { group: Group }) {
  const g = props.group
  const [form, setForm] = createSignal<ForumForm>(formFrom(g))
  const [touched, setTouched] = createSignal(false)
  const [error, setError] = createSignal("")
  const [saved, setSaved] = createSignal(false)
  const [busy, setBusy] = createSignal(false)

  // the metadata may arrive after the page opened
  createEffect(() => {
    useChanges()
    const id = g.metadata?.event.id
    untrack(() => {
      if (id && !touched()) setForm(formFrom(g))
    })
  })

  return (
    <section id="forum" class="card" aria-labelledby="forum-settings-heading">
      <div class="card-h">
        <h2 id="forum-settings-heading">forum</h2>
        <p>The name, the description, and who can read and join.</p>
      </div>
      <div class="card-b">
        {error() && (
          <p class="err" role="alert">
            {error()}
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
              await g.editMetadata(form())
              setSaved(true)
              setTouched(false)
            } catch (err) {
              setError(`Couldn't save: ${errorText(err)}`)
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
              setForm({ ...form(), ...f })
            }}
          />
          <div class="account-form-actions">
            <button class="btn pri" type="submit" disabled={busy()}>
              {busy() ? "saving…" : "save settings"}
            </button>
            {saved() && <span class="where">Saved. The server may take a moment to show it.</span>}
          </div>
        </form>
      </div>
    </section>
  )
}

function Members(props: { group: Group }) {
  const g = props.group
  const [input, setInput] = createSignal("")
  const [error, setError] = createSignal("")
  const members = () => {
    useChanges()
    return [...new Set([...g.admins.keys(), ...(g.members ?? [])])]
  }

  const makeAdmin = async (pk: string) => {
    setError("")
    try {
      await g.putUser(pk, ["admin"])
    } catch (err) {
      setError(errorText(err))
    }
  }

  // putting someone again without roles takes the ones they had away
  const removeAdmin = async (pk: string) => {
    setError("")
    try {
      await g.putUser(pk)
    } catch (err) {
      setError(errorText(err))
    }
  }

  const removeMember = async (pk: string) => {
    if (!confirm("Remove this member? They can't post until they join again.")) return
    setError("")
    try {
      await g.removeUser(pk)
    } catch (err) {
      setError(errorText(err))
    }
  }

  const addMember = async (e: SubmitEvent) => {
    e.preventDefault()
    setError("")
    try {
      const v = input()
        .trim()
        .replace(/^nostr:/, "")
      let pk = v
      if (v.startsWith("npub1") || v.startsWith("nprofile1")) {
        const d = nip19.decode(v)
        pk = d.type === "npub" ? d.data : d.type === "nprofile" ? d.data.pubkey : ""
      }
      if (!/^[0-9a-f]{64}$/.test(pk)) throw new Error("Paste an npub.")
      await g.putUser(pk)
      setInput("")
    } catch (err) {
      setError(errorText(err))
    }
  }

  return (
    <section id="members" class="card" aria-labelledby="members-heading">
      <div class="card-h">
        <h2 id="members-heading">members</h2>
        <p>Who is in the forum and who is an admin. Admins can change these settings and delete any post.</p>
      </div>
      <div class="card-b">
        {members().length ? (
          <ul class="member-list">
            <For each={members()}>
              {pk => {
                const roles = () => {
                  useChanges()
                  return g.admins.get(pk)
                }
                return (
                  <li>
                    <UserLink pubkey={pk} group={g} />
                    {pk === me && <span class="flag you">you</span>}
                    {roles() && <span class="flag a">{roles()!.join(", ") || "admin"}</span>}
                    <span class="sp"></span>
                    {pk !== me &&
                      (roles() ? (
                        <button class="inline-button" type="button" onClick={() => removeAdmin(pk)}>
                          remove admin
                        </button>
                      ) : (
                        <>
                          <button class="inline-button" type="button" onClick={() => makeAdmin(pk)}>
                            make admin
                          </button>
                          <button class="inline-button" type="button" onClick={() => removeMember(pk)}>
                            remove
                          </button>
                        </>
                      ))}
                  </li>
                )
              }}
            </For>
          </ul>
        ) : (
          <p class="hint">The server doesn't share the member list.</p>
        )}
        <form class="row-inline member-add" onSubmit={addMember}>
          <input
            class="inp mono wide"
            placeholder="npub1…"
            aria-label="Add a member"
            value={input()}
            onInput={e => setInput((e.target as HTMLInputElement).value)}
          />
          <button class="btn" type="submit">
            add member
          </button>
        </form>
        <p class="help">You can't remove your own admin rights. Ask another admin.</p>
        {error() && (
          <p class="err" role="alert">
            {error()}
          </p>
        )}
      </div>
    </section>
  )
}

function Invites(props: { group: Group }) {
  const g = props.group
  const [links, setLinks] = createSignal<string[]>([])
  const [error, setError] = createSignal("")
  return (
    <section id="invites" class="card" aria-labelledby="invites-heading">
      <div class="card-h">
        <h2 id="invites-heading">invite links</h2>
        <p>Anyone with an invite link can join, even when the forum is closed. Send it to them yourself.</p>
      </div>
      <div class="card-b">
        <For each={links()}>
          {l => (
            <div class="row-inline">
              <input class="inp mono wide" readOnly value={l} aria-label="Invite link" />
              <button class="btn" type="button" onClick={() => navigator.clipboard?.writeText(l)}>
                copy
              </button>
            </div>
          )}
        </For>
        <div class="row">
          <button
            class="btn"
            type="button"
            onClick={async () => {
              setError("")
              try {
                const code = await g.createInvite()
                setLinks([...links(), `${location.origin}/${g.naddr}?invite=${code}`])
              } catch (err) {
                setError(errorText(err))
              }
            }}
          >
            make an invite link
          </button>
        </div>
        {error() && (
          <p class="err" role="alert">
            {error()}
          </p>
        )}
      </div>
    </section>
  )
}

function DeleteForum(props: { group: Group }) {
  const g = props.group
  const [confirmText, setConfirmText] = createSignal("")
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal("")
  const name = () => {
    useChanges()
    return g.name
  }
  const host = g.relay.replace(/^wss?:\/\//, "").replace(/\/$/, "")

  return (
    <section id="delete" class="dz" aria-labelledby="delete-heading">
      <div class="card-h">
        <h2 id="delete-heading">delete forum</h2>
        <p>This cannot be undone. When you delete the forum:</p>
      </div>
      <div class="card-b">
        <ul>
          <li>
            The server at <b>{host}</b> drops it, with all its threads and comments.
          </li>
          <li>Its link stops working for everyone.</li>
          <li>Copies that people have in their browsers stay there, but nobody can post again.</li>
        </ul>
        <div class="label">moving instead</div>
        <p class="help">
          If you only want off this server, move the forum instead. Every thread and comment is signed by the person who
          wrote it, so another server can take them as they are. Set up a server that hosts forums like this one (
          <a class="underline" href="https://github.com/fiatjaf/pyramid" target="_blank" rel="noopener">
            pyramid
          </a>{" "}
          is one you can run yourself), copy the forum over, and share the new link. Then delete this one.
        </p>
        <form
          class="delete-form"
          onSubmit={async e => {
            e.preventDefault()
            if (confirmText().trim() !== name()) return
            setBusy(true)
            setError("")
            try {
              await g.deleteGroup()
              navigate("/")
            } catch (err) {
              setError(`Couldn't delete: ${errorText(err)}`)
              setBusy(false)
            }
          }}
        >
          <div class="field">
            <label for="confirm-forum-name">
              type <b>{name()}</b> to confirm
            </label>
            <input
              id="confirm-forum-name"
              class="inp"
              autocomplete="off"
              spellcheck={false}
              placeholder={name()}
              value={confirmText()}
              onInput={e => setConfirmText((e.target as HTMLInputElement).value)}
            />
          </div>
          <div class="row">
            <button class="btn danger" type="submit" disabled={busy() || confirmText().trim() !== name()}>
              {busy() ? "deleting…" : "delete this forum"}
            </button>
          </div>
          {error() && (
            <p class="err" role="alert">
              {error()}
            </p>
          )}
        </form>
      </div>
    </section>
  )
}
