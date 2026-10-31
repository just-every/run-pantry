// The Settings index (B1, B3): one short directory, the six job groups in two cards at desktop
// width and one column on a phone. Each row is one link to its section's page, with a status
// only where this viewer's own reads return one; a refused read leaves the plain link.
import { Link } from '@tanstack/react-router'
import { Chip, PageHead, useShared, useView, type D } from './kit'
import { Entry } from './entry'
import { roleScreen } from './role-navigation'
import { groupedSections, offeredSections, onThisComputer, sectionPath, SETTINGS_GROUPS } from './settings-sections'

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
const connection = (flows: D | undefined, id: string) => flows?.services?.find((s: D) => s.id === id)

/** Statuses from the reads the index already has: the shared state for everyone, and the
 * owner's data-flows read (refused for anyone else, and for an owner on another session kind). */
function status(slug: string, state: D, flows: D | undefined) {
  const s = state.settings
  switch (slug) {
    case 'you': return state.actor.name
    case 'people': { const n = (s.members ?? []).filter((m: D) => m.active).length; return n ? count(n, 'person', 'people') : null }
    case 'business': return s.entity?.legal_name ?? s.business?.name ?? null
    case 'dimensions': { const d = state.dimensions?.settings; return d ? (d.classes_enabled || d.locations_enabled || d.projects_enabled ? <Chip tone="good">On</Chip> : <Chip>Off</Chip>) : null }
    case 'stripe': case 'payroll': { const c = connection(flows, slug === 'stripe' ? 'stripe' : 'gusto'); return c ? (c.connected ? <Chip tone="good">Connected</Chip> : <Chip>Not set up</Chip>) : null }
    case 'receipts': return connection(flows, 'model')?.connected ? <Chip tone="good">AI reading on</Chip> : null
    case 'agents': { const n = (s.agents ?? []).filter((a: D) => a.active).length; return n ? count(n, 'agent', 'agents') : null }
    case 'api': {
      if (!flows) return null
      const credentials = flows.integrations.filter((i: D) => i.active).length, hooks = flows.webhooks.length
      return credentials + hooks ? [credentials && count(credentials, 'credential', 'credentials'), hooks && count(hooks, 'webhook', 'webhooks')].filter(Boolean).join(', ') : 'None yet'
    }
    case 'hosting': return <Chip>This computer</Chip>
    default: return null
  }
}

export function SettingsIndex() {
  const { state } = useShared(), owner = state.actor.can.owner
  // The index's one read beside the shared state; its refusal is never shown.
  const { data: flows } = useView<D>(owner ? 'data-flows' : null)
  const groups = groupedSections(offeredSections(state, onThisComputer()))
  const activity = roleScreen(state.actor.role, '/app/activity', state.actor.policy?.bankAccounts != null)
  const card = (names: string[]) => {
    const shown = groups.filter(g => names.includes(g.group))
    return shown.length > 0 && <section className="card settings-index-card"><div className="card-body">{shown.map(({ group, sections }) => <div className="settings-group" key={group}>
      <h2>{group}</h2>
      <ul className="settings-rows">{sections.map(s => { const value = status(s.slug, state, flows); return <li key={s.slug}><Entry to={sectionPath(s.slug)} className="settings-row">
        <span className="settings-row-title">{s.title}</span>{value && <span className="settings-row-status">{value}</span>}
      </Entry></li> })}</ul>
    </div>)}</div></section>
  }
  return <>
    <PageHead title="Settings" lead="Your account, your people and how these books connect." actions={activity && <Link className="btn btn-secondary" to="/app/activity">Activity</Link>} />
    <div className="settings-index">{card(SETTINGS_GROUPS.slice(0, 3))}{card(SETTINGS_GROUPS.slice(3))}</div>
  </>
}
