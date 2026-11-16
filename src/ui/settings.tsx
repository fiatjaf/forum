import { inMyGroups, removeFromMyGroups, type Group } from "../groups"
import { useChanges } from "../state"
import { navigate } from "./common"
import { AppearanceCard, DesktopAlertsCard, ProgrammaticAccess, Sidebar, type SidebarItem } from "./preferences"

export function ForumSettings(props: { group: Group }) {
  const g = props.group
  const isAdmin = () => {
    useChanges()
    return g.isAdmin()
  }
  const listed = () => {
    useChanges()
    return g.isMember() || inMyGroups(g)
  }

  const items = (): SidebarItem[] => {
    const nav: SidebarItem[] = [
      { id: "appearance", label: "appearance" },
      { id: "notifications", label: "notifications" },
      { id: "programmatic", label: "programmatic access" }
    ]
    if (listed()) nav.push({ id: "leave", label: "leave forum", red: true })
    return nav
  }

  return (
    <div class="account-page">
      <div class="pagehead">
        <h1 class="pt">
          <span class="p">~/</span>settings
        </h1>
        <span class="sp"></span>
        {isAdmin() && (
          <a class="btn" href={`/${g.naddr}/admin`}>
            admin
          </a>
        )}
      </div>

      <div class="layout">
        <Sidebar label="Settings sections" items={items()} />

        <div class="stack">
          <AppearanceCard />
          <DesktopAlertsCard />
          <ProgrammaticAccess group={g} />

          {listed() && <LeaveGroup group={g} />}
        </div>
      </div>
    </div>
  )
}

function LeaveGroup(props: { group: Group }) {
  const g = props.group
  return (
    <section id="leave" class="card dz" aria-labelledby="leave-heading">
      <div class="card-h">
        <h2 id="leave-heading">leave forum</h2>
        <p>You stop being a member and the forum leaves your list. Your threads and comments stay.</p>
      </div>
      <div class="card-b">
        <div class="row">
          <button
            class="btn danger"
            type="button"
            onClick={async () => {
              if (!confirm(`Leave ${g.name}?`)) return
              try {
                await g.leave()
              } catch {
                // not a member on the server; still take it off the list
                await removeFromMyGroups(g).catch(() => {})
              }
              navigate("/")
            }}
          >
            leave this forum
          </button>
        </div>
      </div>
    </section>
  )
}
