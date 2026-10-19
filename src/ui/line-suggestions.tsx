import type { LineSuggestion as Suggestion, SuggestionRate, SuggestionSource } from '../pantry/line-suggestions'

const labels: Record<SuggestionSource, string> = { history: 'Your filing history', vendor: 'Vendor default', document: 'Source document' }

/** Informational only: the normal File it form owns every accounting choice. */
export function LineSuggestion({ suggestion }: { suggestion?: Suggestion | null }) {
  if (!suggestion) return null
  return <span className="filed">
    <small className="sub"><strong>Suggested: {suggestion.accountName}</strong>{suggestion.payee && <> · {suggestion.payee}</>}</small>
    <small className="sub">{suggestion.reason}</small>
    <small className="sub">{labels[suggestion.source]} · <span title={suggestion.confidenceReason}>{suggestion.confidence}% confidence score</span></small>
  </span>
}

export function SuggestionRates({ rates }: { rates?: SuggestionRate[] }) {
  if (!rates?.length) return null
  return <div className="table-wrap"><table className="ledger" aria-label="Suggestion acceptance by source">
    <thead><tr><th>Suggestion source</th><th>Accepted</th><th>Changed</th></tr></thead>
    <tbody>{rates.map(rate => <tr key={rate.source}>
      <td data-label="Suggestion source">{labels[rate.source]}</td>
      <td data-label="Accepted">{rate.total ? `${rate.accepted} (${rate.acceptanceRate}%)` : 'No decisions yet'}</td>
      <td data-label="Changed">{rate.total ? `${rate.changed} (${rate.changeRate}%)` : 'No decisions yet'}</td>
    </tr>)}</tbody>
  </table></div>
}
