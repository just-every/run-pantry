# Pantry homepage claims → code (run-site gate table)

Branch `br/style` on just-every/run-pantry, 17 Oct 2026; rows 21, 22, 32 and 42 updated on 17 Oct 2026 when their code landed (sd-pantry-reports). Every capability the homepage states, in page order, with the code that backs it today or **contract, not yet in code**. The copy is the design desk's (owner-accepted 16 Oct 2026) and is not watered down; this table is what the run-site gate reads before any deploy.

Note on "the contract": the brief describes Pantry's new contract (connected US small-business accounting replacing QuickBooks Online, Xero and FreshBooks). `CONTRACT.md` on `main` (last changed in v0.1.0, 7435b66) is still the first-release contract, which lists live bank feeds, payment initiation, invoice email, payroll and cash-basis reports under "Not in the first release". So every "contract, not yet in code" row below is backed only by the brief's description of the new contract, not by a file on `main`.

Status key: **code** = the capability exists and runs today; **partial** = a narrower version exists (named), the claimed form does not; **contract** = contract, not yet in code.

| # | Section | Claim on the page | Status | Code path / what exists |
|---|---|---|---|---|
| 1 | Hero | "pulls in your bank and cards" | partial | CSV/OFX statement import per bank account: `src/pantry/bank.ts`, `src/pantry/statement-files.ts` (PAN-07). No live bank or card feed. |
| 2 | Hero | "catches every receipt" | partial | Source documents kept byte for byte with SHA-256 and linked to records: `src/pantry/contacts.ts` (`documentInsert`), bills with evidence and the close exception for a bill without one: `src/pantry/payables.ts`, `src/pantry/close.ts`. No capture by photo or email. |
| 3 | Hero | "gets invoices paid" | partial | Invoices drafted, approved by a second person and issued: `src/pantry/invoices.ts`; payments received recorded and allocated: `src/pantry/payables.ts` (PAN-04, PAN-06). Pantry does not send invoices or collect money. |
| 4 | Hero | "closes the month with your accountant" | code | Close checklist, review tasks by named people, lock by the lock grant, reopen with a second approver: `src/pantry/close.ts`; accountant role and grants: `src/pantry/access.ts` (PAN-13). |
| 5 | Hero | "100% free, open source" | code | `LICENSE` (MIT). |
| 6 | Hero cards | Net income · October with its lines (P&L) | code | `src/pantry/reports.ts` (`profitAndLoss`), screen `src/ui/reports.tsx`. |
| 7 | Hero cards | Chase Business ••4417 feed, 2,847 transactions | contract | Statement lines exist only from imported files (row 1). |
| 8 | Hero cards | Home Depot receipt read into vendor, date, category | contract | Documents are stored as evidence (row 2); nothing extracts fields. |
| 9 | Hero cards | Stripe payout matched to 23 charges, fees split | partial | Matching one deposit across several receipts, and fees the books lack: `src/pantry/matching.ts` (PAN-08). No Stripe connection. |
| 10 | Hero cards | INV-0231 paid via ACH | partial | Payment recorded against the invoice (row 3); no ACH collection. |
| 11 | Hero cards | "Looks right, closing October · Reviewed by your accountant" | code | Review tasks marked done by named people and the lock: `src/pantry/close.ts`. |
| 12 | Live bank feeds | "Connect your bank and cards once. Transactions arrive on their own" | contract | File import only (row 1). |
| 13 | Live bank feeds | "your rules file the routine ones" (Adobe → Software "by rule") | contract | No bank rules in `src/pantry`. |
| 14 | Live bank feeds | "re-link to stay current" (Amex) | contract | No feed connections exist to re-link. |
| 15 | Receipts | "Take a photo or forward the email" | contract | Upload of a file exists (row 2); no camera capture, no inbound mail address for receipts. |
| 16 | Receipts | "Pantry reads the vendor, date and total, and attaches it to the right transaction" | contract | Attaching a document to a bill or journal by a person exists (`src/pantry/contacts.ts`, `src/pantry/journal.ts` cites documents); no reading or automatic attachment. |
| 17 | Invoices | "Send it and Pantry follows up" (sent, viewed, reminder) | contract | `CONTRACT.md` on main: "sending invoices or reminders by email" not in the first release. |
| 18 | Invoices | "Customers pay by card or ACH from the link" | contract | No payment links or processing. |
| 19 | Invoices | "the payment matches itself" | partial | A recorded payment is cleared by its bank line in matching (`src/pantry/matching.ts`), proposed by the agent or matched by a person; not automatic. |
| 20 | Invoices | "Repeats monthly" | contract | No recurring invoices. |
| 21 | Every number | "Every figure on your P&L opens to the bills, receipts and transactions behind it" | code | Every P&L and balance sheet line and total opens to its postings (or, on the cash basis, the settled shares of invoices, credits and bills) with the source record, its documents and matched bank statement lines; rows must add up to the figure: `src/pantry/drilldown.ts`, `src/pantry/records.ts`, screens `src/ui/reports.tsx`, `src/ui/report-detail.tsx`; test `tests/api/reports.test.mjs` (REPORT-005). |
| 22 | Every number | "Cash or accrual, one switch" | code | Cash-basis trial balance, general ledger, P&L (with an accrual-to-cash bridge), balance sheet and sales tax from the same accrual books; partial payments spread across lines and tax by largest remainder; basis named on every report, the GL CSV and the accountant package; the declared tax method picks the default: `src/pantry/basis.ts`, `src/pantry/reports.ts`, `src/pantry/package.ts`; worked example `docs/reports.md`; test `tests/api/reports.test.mjs` (REPORT-002). |
| 23 | Books agent | "Pantry follows up on what doesn't add up" | partial | The owner's own agent reads unmatched lines and files proposals: `scripts/pantry-agent.mjs`, `src/pantry/proposals.ts` (PAN-15). Pantry itself does not follow up, and does not text anyone ("Asked Maya by text"). |
| 24 | Books agent | "shows you the change before anything moves" (Approve / Not now) | code | Every agent proposal waits for a person's approval or rejection, re-checked at approval: `src/pantry/proposals.ts`. (The net-income before/after preview on the card is not drawn by the app today.) |
| 25 | Month-end close | "Reconcile" | code | `src/pantry/reconcile.ts` (PAN-09). |
| 26 | Month-end close | "answer the open questions" | partial | Review tasks and close exceptions in `src/pantry/close.ts`; no question thread with the owner. |
| 27 | Month-end close | "lock the month" | code | `src/pantry/close.ts` (`lockPlan`), enforced by database triggers in `migrations/core/0014_pantry.sql`. |
| 28 | Month-end close | "Your accountant signs off in the same place" | code | Accountant role with lock grant in the same app: `src/pantry/access.ts`, `src/pantry/close.ts`. |
| 29 | Interlude | "Books up to date · Oct 31" | code | Close status per period: `src/pantry/close.ts` (`closeState`). |
| 30 | Connected | "Payouts split into sales and fees" (Stripe) | contract | No Stripe connection; a person can match a deposit with its fee (row 9). |
| 31 | Connected | "payroll posts as one balanced entry" (Gusto) | contract | `CONTRACT.md` on main: payroll not in the first release. A person can post a balanced journal (`src/pantry/journal.ts`). |
| 32 | Connected | "sales tax tracks by state" | code | Each tax code belongs to a state; the sales tax report gives taxable sales, tax charged, collected and owed per state and per code for any period, on either basis, tied to each sales tax liability account: `src/pantry/sales-tax.ts`, `src/pantry/accounts.ts`, `src/ui/sales-tax.tsx`; test `tests/api/reports.test.mjs` (SALESTAX-002). Rates are still the business's own; no tax service or filing. |
| 33 | Move in | "Move from QuickBooks Online" | code | `src/pantry/cutover/qbo.ts`, `plan.ts`, `commands.ts` (PAN-16), `MOVE-IN.md`. |
| 34 | Move in | "or Xero" | contract | `CONTRACT.md` on main: the Xero kit comes after QuickBooks Online. |
| 35 | Move in | "with balances, open invoices" | code | Accountant-approved trial balance, open receivables and payables staged and signed off: `src/pantry/cutover/`. |
| 36 | Move in | "and attachments" | contract | `CONTRACT.md` on main: QuickBooks report exports carry no attachments. |
| 37 | Move in | "checked before you switch" (trial balance check, matches) | code | Dry run with tie-outs before import and sign-off: `src/pantry/cutover/plan.ts`. |
| 38 | Ownership | "Run Pantry on your own computer" (the five commands) | code | `rer install`, `rer setup`, `rer dev` via `@runeditrun/rer` 0.2.37 (`package.json`, `OPERATIONS.json`). |
| 39 | Ownership | "keep every record" / "Your books, your database" | code | Local D1 database under the checkout; documents kept byte for byte. |
| 40 | Ownership | "Export everything, any time" | code | `rer export` / `rer import` (PAN-14), accountant package and general-ledger CSV: `src/pantry/package.ts`. |
| 41 | Quiet details | Bank rules: "routine transactions file themselves" | contract | As row 13. |
| 42 | Quiet details | 1099 tracking: "Contractors flagged at the IRS threshold ($2,000 from 2026), forms ready in January" | code | Vendors marked as 1099 contractors with legal name, TIN (masked everywhere; full only in the audited filing CSV for the owner or the posting grant) and address; payments by method per calendar year, card and payment-network payments excluded; flagged at the tax year's threshold ($600 for 2025 payments, $2,000 for 2026); after year end the 1099-NEC figures and a filing CSV; Pantry does not file: `src/pantry/contractors.ts`, `src/ui/contractors.tsx`, `migrations/core/0017_pantry_reports.sql`; test `tests/api/reports.test.mjs` (TAXFORM-002). |
| 43 | Quiet details | Audit trail: "who, what and when" | code | `audit(...)` on every write (`src/pantry/db.ts`), Activity screen `src/routes/app.activity.tsx`. |
| 44 | Quiet details | Locked periods: "Closed months stay closed" | code | As row 27; reopening needs a second person with the reopen grant. |
| 45 | Quiet details | Attachments everywhere: "Every entry keeps its receipt or bill" | partial | Documents link to bills, invoices and journals (`src/pantry/contacts.ts`, `src/pantry/journal.ts`); not required on every entry. |
| 46 | Quiet details | Export everything: "CSV and a full database export, any time" | code | General-ledger CSV and package (`src/pantry/package.ts`), `rer export`. |
| 47 | Closing | "Open source accounting for US small businesses" / "Free and open source, MIT licensed" | code | USD-only US business book (`CONTRACT.md`), `LICENSE`. |

## Summary

47 claims: **23 code**, **9 partial**, **15 contract, not yet in code**. Counting the partial claims, whose claimed form is not built, 24 of 47 go beyond today's code. The largest gaps are live bank and card feeds, receipt capture and reading, invoice sending and payment collection, Stripe and Gusto connections, bank rules, Xero move-in and imported attachments.

"Try the demo" links `https://demo.run-pantry.com/`, Pantry's hosted demo (`deploy-demo.json`, `DEMO.md`), which answered 200 on 17 Oct 2026.
