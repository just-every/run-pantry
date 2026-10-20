import type { Basis } from '../basis'

export type CustomReportSource = 'profit-and-loss' | 'balance-sheet' | 'trial-balance' | 'sales-by-customer' | 'expenses-by-vendor'
export type CustomReportComparison = 'single' | 'prior-period' | 'prior-year' | 'months' | 'quarters' | 'ytd' | 'customer'
export type ReportUnit = 'money' | 'ratio' | 'percent'
export type AccountSelection = { accountIds?: string[]; accountTypes?: string[] }
export type CustomReportLayoutRow =
  | (AccountSelection & { id: string; kind: 'accounts'; label?: string })
  | (AccountSelection & { id: string; kind: 'section'; label: string; rowIds?: string[] })
  | { id: string; kind: 'formula'; label: string; expression: string; unit: ReportUnit }
  | { id: string; kind: 'note'; text: string }

export type CustomReportDefinition = {
  id?: string
  name: string
  source: CustomReportSource
  from: string
  to: string
  basis?: Basis
  columns?: string[]
  allColumns?: boolean
  comparison?: CustomReportComparison
  filters?: AccountSelection & { contactIds?: string[] }
  grouping?: 'account' | 'section' | 'customer'
  layout?: CustomReportLayoutRow[]
  notes?: string[]
}

export type CustomReportColumn = { id: string; label: string; unit: ReportUnit | 'text'; from?: string; to?: string }
export type CalculatedCustomReportRow = {
  id: string
  kind: 'account' | 'section' | 'formula' | 'note'
  code: string
  name: string
  unit: ReportUnit
  values: Record<string, number | string | null>
  text?: string
}
export type CalculatedCustomReport = {
  id: string
  name: string
  source: CustomReportSource
  basis: Basis
  basisLabel: string
  from: string
  to: string
  range: string
  columns: CustomReportColumn[]
  rows: CalculatedCustomReportRow[]
  notes: string[]
}

export type ManagementReportPackage = {
  business: string
  title: string
  cover?: string
  reports: CalculatedCustomReport[]
  commentary?: string[]
}

/** Request-local provenance; never persisted or serialized with report renders. */
export type CustomReportDrillOrigin = { accountId?: string; contactId?: string; type: string; value: number }
export type CustomReportDrillNode = {
  label: string; value: number | null; unit: ReportUnit; from: string | null; to: string
  expression?: string; sourceTo?: string; exact?: { numerator: bigint; denominator: bigint; dimension: number } | null
  operands: string[]; origins?: CustomReportDrillOrigin[]
}
export type CustomReportDrillGraph = { nodes: Map<string, CustomReportDrillNode>; roots: Map<string, string> }
export type CustomReportFigureOperand = {
  label: string; value: number | null; unit: ReportUnit; basis: Basis; from: string | null; to: string; href: string
  exact?: { numerator: string; denominator: string }
}
export type CustomReportFigureDetail = CustomReportFigureOperand & {
  expression?: string; exact?: { numerator: string; denominator: string }; operands: CustomReportFigureOperand[]
  rows?: import('../core').Data[]; total?: number; ties?: boolean
}
