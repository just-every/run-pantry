import type { ReactNode } from 'react'

/** Keep the choices folded; only applied filters take space beside the control. */
export function ListFilters({ children, active = [] }: { children: ReactNode; active?: { label: string; clear: () => void }[] }) {
  return <div className="list-filters">
    <details><summary className="btn btn-secondary">Filters</summary><div className="filter-fields">{children}</div></details>
    {active.map(filter => <button key={filter.label} type="button" className="btn btn-secondary filter-chip" aria-label={`Clear ${filter.label}`} onClick={filter.clear}>{filter.label} <span aria-hidden="true">×</span></button>)}
  </div>
}
