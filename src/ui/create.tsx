import { createSignal } from "solid-js"
import { createGroup } from "../groups"
import { navigate } from "./common"

export type ForumForm = {
    name: string
    about: string
    picture: string
    isPrivate: boolean
    isClosed: boolean
}

// The fields both the create page and the settings page edit.
export function ForumFields(props: { form: () => ForumForm; set: (f: Partial<ForumForm>) => void }) {
    const form = () => props.form()
    return (
        <>
            <section class="panel account-section" aria-labelledby="forum-name-heading">
                <h2 class="label" id="forum-name-heading">
                    forum
                </h2>
                <div class="field">
                    <label for="forum-name">name</label>
                    <input
                        id="forum-name"
                        class="inp"
                        value={form().name}
                        maxLength={80}
                        required
                        onInput={e => props.set({ name: (e.target as HTMLInputElement).value })}
                    />
                </div>
            </section>

            <section class="panel account-section" aria-labelledby="visibility-heading">
                <h2 class="label" id="visibility-heading">
                    visibility
                </h2>
                <fieldset class="seg" aria-label="Visibility">
                    <label>
                        <input
                            type="radio"
                            name="visibility"
                            checked={!form().isPrivate}
                            onChange={() => props.set({ isPrivate: false })}
                        />
                        <span>public</span>
                    </label>
                    <label>
                        <input
                            type="radio"
                            name="visibility"
                            checked={form().isPrivate}
                            onChange={() => props.set({ isPrivate: true })}
                        />
                        <span>private</span>
                    </label>
                </fieldset>
                <p class="hint">
                    {form().isPrivate
                        ? "Only members can read threads and comments."
                        : "Anyone with the link can read threads and comments. Only members can post."}
                </p>
            </section>

            <section class="panel account-section" aria-labelledby="membership-heading">
                <h2 class="label" id="membership-heading">
                    membership
                </h2>
                <fieldset class="seg" aria-label="Membership">
                    <label>
                        <input
                            type="radio"
                            name="membership"
                            checked={!form().isClosed}
                            onChange={() => props.set({ isClosed: false })}
                        />
                        <span>open</span>
                    </label>
                    <label>
                        <input
                            type="radio"
                            name="membership"
                            checked={form().isClosed}
                            onChange={() => props.set({ isClosed: true })}
                        />
                        <span>closed</span>
                    </label>
                </fieldset>
                <p class="hint">
                    {form().isClosed ? "People join with an invite link or when an admin adds them." : "Anyone can join."}
                </p>
            </section>
        </>
    )
}

export function CreateForum() {
    const [relay, setRelay] = createSignal("chat.wisp.talk")
    const [form, setForm] = createSignal<ForumForm>({
        name: "",
        about: "",
        picture: "",
        isPrivate: false,
        isClosed: false
    })
    const [error, setError] = createSignal("")
    const [busy, setBusy] = createSignal(false)

    return (
        <div class="admin-page">
            <div class="pagehead">
                <h1 class="pt">
                    <span class="p">~/</span>new forum
                </h1>
            </div>

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
                    try {
                        const g = await createGroup({ relay: relay(), ...form() })
                        navigate(`/${g.naddr}`)
                    } catch (err) {
                        setError(`Couldn't create the forum: ${(err as Error).message ?? err}`)
                    } finally {
                        setBusy(false)
                    }
                }}
            >
                <section class="panel account-section" aria-labelledby="server-heading">
                    <h2 class="label" id="server-heading">
                        server
                    </h2>
                    <div class="field">
                        <label for="forum-server">server address</label>
                        <input
                            id="forum-server"
                            class="inp mono"
                            value={relay()}
                            required
                            spellcheck={false}
                            onInput={e => setRelay((e.target as HTMLInputElement).value)}
                        />
                    </div>
                    <p class="hint">
                        The server keeps the forum and decides who can read and post. Any compatible server works, and you can move
                        the forum to another one later, including a server you run yourself.
                    </p>
                </section>

                <ForumFields form={form} set={f => setForm({ ...form(), ...f })} />

                <div class="account-form-actions">
                    <button class="btn pri" type="submit" disabled={busy()}>
                        {busy() ? "creating…" : "create forum"}
                    </button>
                    <a class="btn ghost" href="/">
                        cancel
                    </a>
                </div>
            </form>
        </div>
    )
}
