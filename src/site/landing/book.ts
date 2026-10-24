// One business's October, the records every homepage section draws: Alder Street Builders (a remodeling
// contractor; owner Maya, accountant Jordan Kim, CPA) from the Sep 30 move-in to the Nov 2 lock and the Nov 3
// reports. Dates follow the 2026 calendar (Oct 1 is a Thursday). The hero (HeroCards.tsx) shows the same records:
// Chase ••4417 at $6,320.24, the Home Depot receipt, the Stripe payout, INV-0231 and net income of $11,040.

export const CHASE = 'Chase ••4417'
export const AMEX = 'Amex ••1009'
export const ACCOUNTANT = 'Jordan Kim, CPA'

/** Day of the week for a 2026 date (0 = Sunday), so weekends are greyed from the calendar, not from a drawing. */
export const weekday = (month: number, day: number) => new Date(Date.UTC(2026, month - 1, day)).getUTCDay()
export const isWeekend = (month: number, day: number) => [0, 6].includes(weekday(month, day))

// ---------- The ribbon: October, then the lock ----------
export type Tone = 'green' | 'apricot' | 'red' | 'navy'
export type Moment = { month: number; day: number; label: string; detail: string; tone: Tone; below?: boolean; lock?: boolean }
export const MOMENTS: Moment[] = [
  { month: 10, day: 1, label: 'Oct 1', detail: '2,847 transactions backfilled', tone: 'green' },
  { month: 10, day: 4, label: 'Oct 4', detail: 'INV-0231 sent · $3,200', tone: 'navy', below: true },
  { month: 10, day: 9, label: 'Oct 9', detail: '$2,000 transfer, no memo', tone: 'apricot' },
  { month: 10, day: 13, label: 'Oct 13', detail: 'Home Depot receipt · $312.48', tone: 'green', below: true },
  { month: 10, day: 20, label: 'Oct 20', detail: `${AMEX} sign-in expired`, tone: 'red' },
  { month: 10, day: 27, label: 'Oct 27', detail: 'Agent closes 3 loose ends', tone: 'navy', below: true },
  { month: 10, day: 31, label: 'Oct 31', detail: 'Books up to date', tone: 'green' },
  { month: 11, day: 2, label: 'Nov 2', detail: `Locked by ${ACCOUNTANT}`, tone: 'green', below: true, lock: true },
]
/** Days the Amex feed was down (sign-in needed) and the days after the re-link and backfill. */
export const FEED_DOWN = [20, 22] as const
export const FEED_BACK = [23, 31] as const

// ---------- Moving in (Sep 30) ----------
export const TRIAL_BALANCE = '$184,220.18'
export const TIE_OUT: [string, string, string][] = [
  ['Open invoices', '14', '14'],
  ['Open bills', '9', '9'],
  ['Bank and card balances', '2', '2'],
  ['Attachments', '1,206', '1,206'],
]
// The one start line every Run Edit Run page shows, then the alternative for people who already have Node, as a comment.
export const SETUP = ['curl -fsSL https://runeditrun.com/install.sh | sh -s -- dev just-every/run-pantry', '# Already have Node 22 or later? npx -y @runeditrun/rer dev just-every/run-pantry']

// ---------- The ledger (Oct 1–19) ----------
export type LedgerRow = { date: string; account: string; payee: string; amount: string; inflow?: boolean; coded: string; how: string; flag?: 'coded' | 'how'; receipt?: boolean; split?: [string, string][] }
export const STRIPE_SPLIT: [string, string][] = [['Sales', '$4,953.50'], ['Stripe fees', '−$141.20'], ['Net to bank', '$4,812.30']]
export const LEDGER: LedgerRow[] = [
  { date: 'Oct 2', account: CHASE, payee: 'Brightline Dental', amount: '+$1,450.00', inflow: true, coded: 'INV-0228', how: 'Matched to invoice' },
  { date: 'Oct 3', account: AMEX, payee: 'Adobe', amount: '−$59.99', coded: 'Software', how: 'By rule' },
  { date: 'Oct 7', account: CHASE, payee: 'Ridgeline Lumber', amount: '−$1,850.00', coded: 'Deposit?', how: 'For Jordan', flag: 'coded' },
  { date: 'Oct 9', account: CHASE, payee: 'Transfer to ••2290', amount: '−$2,000.00', coded: 'Uncategorized', how: 'Needs review', flag: 'how' },
  { date: 'Oct 13', account: CHASE, payee: 'Home Depot', amount: '−$312.48', coded: 'Tools & Equipment', how: 'Receipt attached', receipt: true },
  { date: 'Oct 14', account: CHASE, payee: 'Stripe payout', amount: '+$4,812.30', inflow: true, coded: 'Sales', how: 'Split', split: STRIPE_SPLIT },
  { date: 'Oct 15', account: CHASE, payee: 'Gusto', amount: '−$2,890.00', coded: 'Wages and taxes', how: 'Payroll journal' },
  { date: 'Oct 19', account: CHASE, payee: 'Brightline Dental', amount: '+$3,200.00', inflow: true, coded: 'INV-0231', how: 'Paid via ACH' },
]

// ---------- Receipts (Oct 13) ----------
export const LOWES = { from: 'Forwarded by Maya', subject: 'Fwd: Your Lowe’s order #8841207', match: ['Lowe’s', 'Oct 21', '$486.20', `matched to ${AMEX}`] }

// ---------- Invoices (Oct 4–19) ----------
export const INVOICE = {
  number: 'INV-0231', customer: 'Brightline Dental', due: 'Due Oct 16', paid: 'Paid Oct 19', total: '$3,200.00',
  lines: [['Operatory 2 cabinet install', '$2,400.00'], ['Quartz countertop', '$800.00']] as [string, string][],
}
export const ACTIVITY: [string, string, boolean][] = [
  ['Emailed with card and ACH pay link', 'Oct 4, 9:12 AM', false],
  ['Viewed by Brightline Dental', 'Oct 5, 8:47 AM', false],
  ['Reminder sent', 'Oct 15, 9:00 AM', false],
  ['Paid by ACH bank transfer', 'Oct 19, 6:02 AM', true],
  [`Matched to ${CHASE} deposit`, 'Oct 19, 6:15 AM', true],
]
export const AGING: [string, string, number][] = [['Current', '$1,550', 1550], ['1–30', '$1,200', 1200], ['31–60', '$0', 0], ['61+', '$0', 0]]

// ---------- When a feed breaks (Oct 20–23) ----------
export type Feed = { name: string; ok: boolean; last: string; next: string }
export const FEEDS: Feed[] = [
  { name: CHASE, ok: true, last: 'Oct 22, 6:00 AM', next: 'Oct 22, 12:00 PM' },
  { name: 'Stripe', ok: true, last: 'Oct 22, 6:00 AM', next: 'Oct 22, 12:00 PM' },
  { name: 'Gusto', ok: true, last: 'Oct 22, 5:45 AM', next: 'Oct 22, 11:45 AM' },
  { name: AMEX, ok: false, last: 'Oct 19, 11:58 PM', next: 'After you sign in' },
]
export const BACKFILL: [string, string, string, string, string][] = [
  ['Oct 20', 'Shell', '−$84.12', 'Fuel', 'By rule'],
  ['Oct 21', 'Lowe’s', '−$486.20', 'Materials', 'Receipt attached'],
  ['Oct 22', 'Ace Hardware', '−$41.67', 'Materials', 'By rule'],
]

// ---------- The books agent (Oct 9–27) ----------
// The vendor's name never breaks at its hyphen (U+2011), and an amount stays on the line of the words it closes (U+00A0).
const SHERWIN = 'Sherwin\u2011Williams'
export type Case = { icon: 'bank' | 'doc' | 'clip'; tone: 'green' | 'apricot' | 'lavender'; title: string; when: string; outcome: string; steps: string[]; result?: string }
export const CASES: Case[] = [
  { icon: 'bank', tone: 'green', title: '$2,000 transfer, no memo', when: 'Oct 9', outcome: 'Recoded · owner draw',
    steps: [`${CHASE} → ••2290, Maya’s personal savings`, 'Asked Maya by text · Oct 9, 4:10 PM', 'Reply: owner draw · Oct 27'], result: 'Net income Oct: $9,040\u00a0→\u00a0$11,040' },
  { icon: 'doc', tone: 'apricot', title: 'Payroll off by $50.00', when: 'Oct 15', outcome: 'Split',
    steps: ['Gusto journal $2,840.00 · Chase debit $2,890.00', 'Found in Gusto: D. Park mileage\u00a0$50.00'], result: 'Split: Wages $2,840.00 · Vehicle $50.00' },
  { icon: 'clip', tone: 'lavender', title: `Receipt missing · ${SHERWIN}\u00a0$228.40`, when: '', outcome: 'Attached',
    steps: ['Not in inbox or uploads', 'Asked Maya by text · Oct 26', 'Photo received Oct 27, 11:02 AM, total matches'] },
]
export const FOR_JORDAN = 'For Jordan: $1,850 Ridgeline Lumber deposit for a November job. Prepaid or October cost?'

// ---------- Month-end close (Nov 2) ----------
export const CLOSE: [string, string][] = [
  [`${CHASE} reconciled`, '$6,320.24'],
  [`${AMEX} reconciled`, '$4,187.33'],
  ['Stripe clearing', '$0.00'],
  ['Gusto payroll tied out', '2 runs'],
  ['Receipts attached', '212 of 212'],
]
export const LOCKED = 'October locked · Nov 2, 10:15 AM'

// ---------- Reports (Nov 3) ----------
export const PL: [string, string][] = [['Revenue', '$24,893.00'], ['Cost of goods sold', '($6,210.00)'], ['Operating expenses', '($7,012.00)'], ['Other', '($631.00)']]
export const NET_INCOME = '$11,040.00'
export const COGS: [string, string, string][] = [
  ['Oct 21', 'Lowe’s · receipt', '$486.20'],
  ['Oct 22', 'Ace Hardware · receipt', '$41.67'],
  ['Oct 24', `${SHERWIN} · receipt`, '$228.40'],
  ['Oct 28', 'Acme Electric · bill · 1099', '$3,400.00'],
]
export const COGS_MORE: [string, string] = ['+ 10 more', '$2,053.73']
export const COGS_TOTAL = '$6,210.00'
export const CONTRACTORS: [string, string, string, string, 'green' | 'apricot' | 'lavender'][] = [
  ['A', 'Acme Electric', '$18,400', 'W-9 on file', 'green'],
  ['R', 'R. Diaz Tile', '$4,950', 'W-9 on file', 'apricot'],
  ['K', 'K. Moss', '$1,450', 'under $2,000', 'lavender'],
]
