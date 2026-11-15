import * as nip19 from "@nostr/tools/nip19"
import { For, createEffect, createSignal, untrack } from "solid-js"
import { inMyGroups, removeFromMyGroups, type Group } from "../groups"
import { me } from "../nostr"
import { useChanges } from "../state"
import { UserLink, navigate } from "./common"
import { ForumFields, type ForumForm } from "./create"
import { AppearanceCard, DesktopAlertsCard, ProgrammaticAccess, Sidebar, type SidebarItem } from "./preferences"

function formFrom(g: Group): ForumForm {
  return {
    name: g.metadata?.name ?? "",
    about: g.metadata?.about ?? "",
    picture: g.metadata?.picture ?? "",
    isPrivate: !!g.metadata?.isPrivate,
    isClosed: !!g.metadata?.isClosed
  }
}

export function ForumSettings(props: { group: Group }) {
  const g = props.group
  const [form, setForm] = createSignal<ForumForm>(formFrom(g))
  const [touched, setTouched] = createSignal(false)
  const [error, setError] = createSignal("")
  const [saved, setSaved] = createSignal(false)
  const [busy, setBusy] = createSignal(false)
  const isAdmin = () => {
    useChanges()
    return g.isAdmin()
  }
  const listed = () => {
    useChanges()
    return g.isMember() || inMyGroups(g)
  }

  // the metadata may arrive after the page opened
  createEffect(() => {
    useChanges()
    const id = g.metadata?.event.id
    untrack(() => {
      if (id && !touched()) setForm(formFrom(g))
    })
  })

  const items = (): SidebarItem[] => {
    const nav: SidebarItem[] = []
    if (isAdmin()) {
      nav.push({ id: "forum", label: "forum" })
      nav.push({ id: "members", label: "members" })
      nav.push({ id: "invites", label: "invites" })
    }
    nav.push({ id: "appearance", label: "appearance" })
    nav.push({ id: "notifications", label: "notifications" })
    nav.push({ id: "programmatic", label: "programmatic access" })
    if (listed()) nav.push({ id: "leave", label: "leave group", red: true })
    return nav
  }

  return (
    <div class="account-page">
      <div class="pagehead">
        <h1 class="pt">
          <span class="p">~/</span>settings
        </h1>
      </div>

      <div class="layout">
        <Sidebar label="Settings sections" items={items()} />

        <div class="stack">
          {isAdmin() && (
            <section id="forum" class="card" aria-labelledby="forum-settings-heading">
              <div class="card-h">
                <h2 id="forum-settings-heading">forum</h2>
                <p>Name, description and who can read or join.</p>
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
                      setForm({ ...form(), ...f })
                    }}
                  />
                  <div class="account-form-actions">
                    <button class="btn pri" type="submit" disabled={busy()}>
                      {busy() ? "saving…" : "save settings"}
                    </button>
                    {saved() && <span class="where">saved; the relay updates the forum in a moment</span>}
                  </div>
                </form>
              </div>
            </section>
          )}

          {isAdmin() && <Members group={g} />}
          {isAdmin() && <Invites group={g} />}

          <AppearanceCard />
          <DesktopAlertsCard />
          <ProgrammaticAccess group={g} />

          {listed() && <LeaveGroup group={g} />}
        </div>
      </div>
    </div>
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

  return (
    <section id="members" class="card" aria-labelledby="members-heading">
      <div class="card-h">
        <h2 id="members-heading">members</h2>
        <p>People the relay lets in, and who is an admin.</p>
      </div>
      <div class="card-b">
        {members().length ? (
          <ul class="member-list">
            <For each={members()}>
              {pk => {
                const isAdmin = () => {
                  useChanges()
                  return g.isAdmin(pk)
                }
                return (
                  <li>
                    <UserLink pubkey={pk} group={g} />
                    {isAdmin() && <span class="flag a">{g.admins.get(pk)?.join(", ") || "admin"}</span>}
                    <span class="sp"></span>
                    {pk !== me && !isAdmin() && (
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
                )
              }}
            </For>
          </ul>
        ) : (
          <p class="hint">The relay doesn't publish the member list.</p>
        )}
        <form
          class="row-inline member-add"
          onSubmit={async e => {
            e.preventDefault()
            setError("")
            try {
              const v = input().trim()
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
          <input class="inp mono wide" placeholder="npub1…" aria-label="Add a member" value={input()} onInput={e => setInput((e.target as HTMLInputElement).value)} />
          <button class="btn" type="submit">
            add member
          </button>
        </form>
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
        <p>Anyone with an invite link can join, even when the forum is closed.</p>
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
                setError(String((err as Error).message ?? err))
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

function LeaveGroup(props: { group: Group }) {
  const g = props.group
  return (
    <section id="leave" class="card dz" aria-labelledby="leave-heading">
      <div class="card-h">
        <h2 id="leave-heading">leave group</h2>
        <p>This forum is a NIP-29 group. Leaving tells the relay you're no longer a member and takes it off your list.</p>
      </div>
      <div class="card-b">
        <p class="help">Your threads and comments stay in the group.</p>
        <div class="row">
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
            leave this group
          </button>
        </div>
      </div>
    </section>
  )
}
