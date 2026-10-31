// Moving between Settings sections (B2, B4). Above 1180 px each section page keeps the index
// as a rail at the left of the white column, sticky under the header and scrolling within
// itself when taller than the window. At 1180 px and below a "Settings" link and a section
// select take its place. The layout stays mounted across sections, so the rail keeps its place.
import { Outlet, useNavigate, useRouterState } from '@tanstack/react-router'
import { useId } from 'react'
import { useShared } from './kit'
import { Entry } from './entry'
import { Icon } from './icons'
import { groupedSections, offeredSections, SECTIONS, sectionPath, type Section } from './settings-sections'

/** This viewer's sections, plus the one on screen should an old link open one not offered. */
function useSections(current: string) {
  const sections = offeredSections(useShared().state)
  return groupedSections(sections.some(s => s.slug === current) ? sections : [...sections, SECTIONS.find(s => s.slug === current)!].sort((a, b) => SECTIONS.indexOf(a) - SECTIONS.indexOf(b)))
}

function Rail({ current, groups }: { current: string; groups: { group: string; sections: Section[] }[] }) {
  const id = useId()
  return <nav className="settings-rail" aria-label="Settings sections">
    <Entry to="/app/settings" className="settings-rail-home">Settings</Entry>
    {groups.map(({ group, sections }, i) => <div className="settings-rail-group" key={group}>
      <span className="settings-rail-label" id={`${id}-${i}`}>{group}</span>
      <ul aria-labelledby={`${id}-${i}`}>{sections.map(s => <li key={s.slug}><Entry to={sectionPath(s.slug)} current={s.slug === current} className={`nav-link${s.slug === current ? ' active' : ''}`}>{s.title}</Entry></li>)}</ul>
    </div>)}
  </nav>
}

function Pick({ current, groups }: { current: string; groups: { group: string; sections: Section[] }[] }) {
  const navigate = useNavigate(), id = useId()
  return <div className="settings-pick">
    <Entry to="/app/settings" className="settings-back"><Icon name="back" />Settings</Entry>
    <div className="field"><label htmlFor={id}>Settings section</label>
      <select id={id} value={current} onChange={e => void navigate({ href: sectionPath(e.target.value) })}>
        {groups.map(({ group, sections }) => <optgroup key={group} label={group}>{sections.map(s => <option key={s.slug} value={s.slug}>{s.title}</option>)}</optgroup>)}
      </select>
    </div>
  </div>
}

/** /app/settings: the index alone, or a section page beside the rail. */
export function SettingsLayout() {
  const path = useRouterState({ select: s => s.location.pathname.replace(/\/$/, '') })
  const current = SECTIONS.find(s => path === sectionPath(s.slug))?.slug
  return current ? <SectionFrame current={current} /> : <Outlet />
}

function SectionFrame({ current }: { current: string }) {
  const groups = useSections(current)
  return <div className="settings-page">
    <Rail current={current} groups={groups} />
    <div className="settings-main"><Pick current={current} groups={groups} /><Outlet /></div>
  </div>
}
