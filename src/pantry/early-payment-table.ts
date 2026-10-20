// Suggested early-payment discount treatments by state (INVOICE-010), recorded
// from each state's primary source. A suggestion never applies itself: someone
// with the post grant records a code's treatment, and a choice against a row is
// allowed with a reason and labelled. This is not tax advice.
export const TREATMENT_TABLE_VERSION = '2026-10-20'
export const TREATMENT_TABLE_NOTE = "Recorded from each state's primary source on 20 October 2026. Your accountant confirms before deciding. Local home-rule jurisdictions are not covered."

export type Treatment = 'retain' | 'reduce'
export type Suggestion = { state: string; suggested: Treatment; required: boolean; other: string; source: { url: string; section: string; date: string } }

const checked = '2026-10-20'
export const SUGGESTIONS: Suggestion[] = [
  { state: 'CA', suggested: 'reduce', required: false, other: 'Retain is lawful without claiming the deduction.', source: { url: 'https://cdtfa.ca.gov/lawguides/vol1/sutr/1671-1.html', section: 'Reg. 1671.1(b)(1); Reg. 1700(b)(5)(A)1; CDTFA filing instructions and Schedule Q', date: checked } },
  { state: 'WA', suggested: 'reduce', required: false, other: 'Retain is lawful, with no retail sales tax deduction.', source: { url: 'https://app.leg.wa.gov/RCW/default.aspx?cite=82.08.010', section: 'RCW 82.08.010(1)(b); WAC 458-20-108(7)', date: checked } },
  { state: 'TX', suggested: 'reduce', required: false, other: 'Reduce only with the discount separately identified to the customer; retain is lawful and the full amount collected is owed.', source: { url: 'https://tcss.legis.texas.gov/resources/TX/htm/TX.151.htm', section: 'Tax Code §151.007(c)(1); §111.016(a)', date: checked } },
  { state: 'NY', suggested: 'retain', required: true, other: 'Reduce goes against the source.', source: { url: 'https://www.tax.ny.gov/pubs_and_bulls/tg_bulletins/st/taxable_receipt.htm', section: 'Tax Law §1101(b)(3)(i); TB-ST-860', date: checked } },
  { state: 'FL', suggested: 'retain', required: true, other: 'Reduce goes against the source.', source: { url: 'https://flrules.org/gateway/ruleNo.asp?id=12A-1.018', section: 'Rule 12A-1.018(2); Fla. Stat. §212.02(16)', date: checked } },
  { state: 'PA', suggested: 'retain', required: true, other: 'Reduce goes against the source.', source: { url: 'https://www.pacodeandbulletin.gov/Display/pacode?file=/secure/pacode/data/061/chapter33/s33.2.html', section: '61 Pa. Code §33.2(b)(2)', date: checked } },
]

export const suggestionFor = (state: string) => SUGGESTIONS.find(s => s.state === state) ?? null
