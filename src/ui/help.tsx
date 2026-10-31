import type { ReactNode } from 'react'

export function Help({ label, children }: { label: string; children: ReactNode }) {
  return <details className="details reference-help"><summary>{label}</summary>{children}</details>
}
