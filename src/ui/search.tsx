import { For, createSignal } from "solid-js"
import { KIND_COMMENT, type Group } from "../groups"
import { search } from "../search"
import { useChanges } from "../state"
import { UserLink, ago, navigate, plural, snippet, titleOf, useAsync } from "./common"

const PER_PAGE = 30

export function SearchPage(props: { group: Group }) {
  const g = props.group
  const params = new URLSearchParams(location.search)
  const q = params.get("q") ?? ""
  const page = Math.max(1, parseInt(params.get("page") || "1") || 1)
  const [input, setInput] = createSignal(q)
  const base = `/${g.naddr}`
  const results = useAsync(() => (q.trim() ? search(q, g.id) : Promise.resolve([])), () => [q, g.id])

  const visible = () => (results.value ?? []).filter(evt => !g.isDeleted(evt))
  const totalPages = () => Math.max(1, Math.ceil(visible().length / PER_PAGE))
  const shown = () => visible().slice((page - 1) * PER_PAGE, page * PER_PAGE)
  const link = (p: number) => `${base}/search?q=${encodeURIComponent(q)}&page=${p}`

  return (
    <div class="search-page">
      <form
        role="search"
        aria-label="Search threads and comments"
        onSubmit={e => {
          e.preventDefault()
          navigate(`${base}/search?q=${encodeURIComponent(input())}`)
        }}
      >
        <label class="bigsearch">
          <span class="ps" aria-hidden="true">
            grep
          </span>
          <input type="search" value={input()} onInput={e => setInput((e.target as HTMLInputElement).value)} aria-label="Search threads and comments" autofocus />
          <button class="btn pri" type="submit">
            search
          </button>
        </label>
      </form>

      {!q.trim() ? (
        <p class="hint">Search thread titles, thread bodies and comments stored in this browser.</p>
      ) : results.loading ? (
        <p class="hint">Searching…</p>
      ) : visible().length ? (
        <>
          <div class="search-summary">
            <span class="label">
              {plural(visible().length, "result")} · best match first
            </span>
            <span class="label">threads and comments</span>
          </div>
          <ol class="rl">
            <For each={shown()}>
              {evt => {
                const isComment = evt.kind === KIND_COMMENT
                const rootId = isComment ? evt.tags.find(t => t[0] === "E")?.[1] : evt.id
                const root = rootId ? g.threads.get(rootId) : undefined
                const threadLink = `${base}/${rootId}`
                const count = () => {
                  useChanges()
                  return g.commentCount(evt.id)
                }
                return (
                  <li class="r">
                    <span class={"ty" + (isComment ? "" : " t")}>{isComment ? "comment" : "thread"}</span>
                    <div class="search-result-body">
                      {isComment ? (
                        <div class="ctx">
                          <UserLink class="au" pubkey={evt.pubkey} group={g} /> in <a href={threadLink}>{root ? titleOf(root) : "a thread"}</a>
                        </div>
                      ) : (
                        <a class="tt" href={threadLink}>
                          {titleOf(evt)}
                        </a>
                      )}
                      {evt.content.trim() && <div class="snip">{snippet(evt.content)}</div>}
                      <div class="meta">
                        {isComment ? (
                          <>
                            <span>{ago(evt.created_at)}</span>
                            <span>·</span>
                            <a href={`${threadLink}#c${evt.id}`}>open comment ›</a>
                          </>
                        ) : (
                          <>
                            <UserLink pubkey={evt.pubkey} group={g} />
                            <span>·</span>
                            <span>{ago(evt.created_at)}</span>
                            <span>·</span>
                            <a href={`${threadLink}#comments`}>{plural(count(), "comment")}</a>
                          </>
                        )}
                      </div>
                    </div>
                  </li>
                )
              }}
            </For>
          </ol>
          {totalPages() > 1 && (
            <nav class="pagination" aria-label="Pages">
              <span class="label">
                page {page} of {totalPages()} · {PER_PAGE} per page
              </span>
              <span class="sp"></span>
              {page > 1 && (
                <a class="btn" href={link(page - 1)} rel="prev">
                  ‹ previous
                </a>
              )}
              {page < totalPages() && (
                <a class="btn" href={link(page + 1)} rel="next">
                  next ›
                </a>
              )}
            </nav>
          )}
        </>
      ) : (
        <p>No results for “{q}”.</p>
      )}
    </div>
  )
}
