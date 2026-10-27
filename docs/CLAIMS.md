# Pantry homepage claims

Generated from the Homepage claims section in [CONTRACT.md](../CONTRACT.md) with `node scripts/contract-docs.mjs write`. The source retains the claim wording, clause links and current scope.

Every capability claimed on the homepage rebuilt on the owner-approved page structure (page-s1, 17 October 2026; branch `br/page`, 18 October 2026), in page order, mapped to the clauses that deliver it. The status is the claim's own: `done` where the claimed form runs today, `partial` naming what exists and what is missing, `missing` where the page shows the product this contract builds towards. `./docs/CLAIMS.md` gives the code path for each row.

| # | Section | Claim | Clause(s) | Status |
|---|---|---|---|---|
| 1 | Hero | "pulls in your bank and cards" | BANK-001, BANK-003, CONNECT-001, PAN-07 | done on installations holding their own Plaid keys (`./tests/api/feeds.test.mjs`); the production path without a developer account (CONNECT-001) is missing |
| 2 | Hero | "catches every receipt" | PAN-17, CAPTURE-001, CAPTURE-002, CAPTURE-003 | done (PAN-17, `./tests/api/receipts.test.mjs`); the Pantry Connect address is CONNECT-006 |
| 3 | Hero | "gets invoices paid" | INVOICE-002, INVOICE-004, PAY-001, PAY-003 | done on installations with their own mail provider and Stripe key (`./tests/api/invoices-out.test.mjs`) |
| 4 | Hero | "closes the month with your accountant" | PAN-13, CLOSE-003 | done (PAN-13) |
| 5 | Hero | "100% free, open source" | OWN-001 | done |
| 6 | Hero cards | Net income · October, the P&L | PAN-12, REPORT-001 | done (PAN-12) |
| 7 | Hero cards | Chase Business ••4417 feed, 2,847 transactions | BANK-001, BANK-004 | done on installations holding their own Plaid keys |
| 8 | Hero cards | Home Depot receipt read into vendor, date, category | PAN-17, CAPTURE-003 | done with the installation's own AI key (PAN-17) |
| 9 | Hero cards | Stripe payout matched to 23 charges, fees split | PAN-19, PROC-001 | done (PAN-19, `./tests/api/connected.test.mjs`) |
| 10 | Hero cards | INV-0231 "Paid via ACH" | PAY-004 | done: a deposit naming its invoice clears automatically with audit and undo; amount-only deposits await confirmation (`./src/pantry/automatch.ts`, `deposit-confirm.ts`) |
| 11 | Hero cards | "Looks right, closing October · Reviewed by your accountant" | PAN-13 | done |
| 12 | A month in the books | "one bank, one card, Stripe, Gusto and an accountant" | BANK-001, PAN-19, PAN-01 | done |
| 13 | A month in the books | "Oct 1 · 2,847 transactions backfilled" | BANK-002 | done for the provider's available history up to 730 days, with start-date choices, reference-only history and explicit duplicate decisions (`./src/pantry/feeds/history.ts`, `./tests/api/feeds.test.mjs` › BANK-002) |
| 14 | A month in the books | "Oct 20 · Amex ••1009 sign-in expired" | BANK-004 | done: the connection says so with Re-link |
| 15 | A month in the books | "Oct 27 · Agent closes 3 loose ends" | PAN-18, AGENT-002, NOTIFY-001 | partial: questions by email to the owner or an invited accountant, answered in Pantry or by email reply; by text is missing |
| 16 | A month in the books | "Oct 31 · Books up to date", "Nov 2 · Locked by Jordan Kim, CPA" | PAN-13 | done |
| 17 | Bring your books with you | "Import from QuickBooks Online or Xero" | PAN-16, MIGRATE-001, MIGRATE-002 | done (PAN-16, `./tests/api/move-in.test.mjs`) |
| 18 | Bring your books with you | "Balances, open items … tie out before you switch" (trial balance matched to the cent, signed off by the accountant) | PAN-16 | done |
| 19 | Bring your books with you | "… and attachments tie out" | PAN-16, MIGRATE-001, MIGRATE-005 | partial: reviewed ZIP and manifest originals, exact moved-source placement and retained undo; live Xero organisation proof pending |
| 20 | Bring your books with you | Terminal: `git clone …run-pantry.git pantry`, `cd pantry`, `rer install`, `rer setup`, `rer dev` | OWN-001 | done |
| 21 | Every transaction, already in. | "Chase, Amex, Stripe and Gusto land in one ledger" | BANK-001, PAN-19, RULE-001 | done |
| 22 | Every transaction, already in. | "Rules code the routine" | RULE-002 | done (`./tests/api/rules.test.mjs`) |
| 23 | Every transaction, already in. | "Payouts and payroll split into real entries" | PAN-19, PROC-001, PAYROLL-001 | done (`./tests/api/connected.test.mjs`) |
| 24 | Every transaction, already in. | Ledger with "Needs review 2", "Matched to invoice", "Receipt attached" | RULE-001, PAY-003, PAN-17 | done; RULE-001 stays partial for per-line splits |
| 25 | Every transaction, already in. | "Deposit? · For Jordan" | AGENT-002 | done: record-linked questions go to an invited accountant, in Pantry and by email reply |
| 26 | Snap it or forward it. | Snap a photo or forward the email | PAN-17, CAPTURE-001, CAPTURE-002 | done (PAN-17) |
| 27 | Snap it or forward it. | "reads the vendor, date and total, finds the card charge" | PAN-17, CAPTURE-003, CAPTURE-004 | done with the installation's own AI key |
| 28 | Snap it or forward it. | "files each receipt once" ("Emailed copy skipped · already attached") | CAPTURE-005 | done for receipt bytes and vendor&#47;date&#47;total, with Skip or an audited Keep both; the clause remains partial for invoice-number matching and other documents |
| 29 | Sent. Reminded. Paid. Matched. | "Email the invoice with a card … link" | INVOICE-002, PAY-001 | done for card through the business's own Stripe |
| 30 | Sent. Reminded. Paid. Matched. | "Reminders go out on schedule" | INVOICE-004 | done |
| 31 | Sent. Reminded. Paid. Matched. | "the payment matches itself" (emailed, viewed, reminded, paid by ACH bank transfer, matched) | INVOICE-002, INVOICE-003, PAY-003, PAY-004 | done for invoice-named deposits: automatic matching, audit and undo; amount-only deposits require one confirmation |
| 32 | Sent. Reminded. Paid. Matched. | Recurring INV-0240; Receivables aging | INVOICE-005, REPORT-004 | done |
| 33 | Sent. Reminded. Paid. Matched. | "… or ACH link" | PAY-001 | done: real US Stripe test Checkout, bank verification, processing, payment and fee recorded once |
| 34 | When a feed breaks, you see it. | Connection status, last successful sync, the plain-words sign-in error and Re-link | BANK-004 | done |
| 35 | When a feed breaks, you see it. | "Next sync" | BANK-004 | done: the stored next sync, or after Re-link |
| 36 | When a feed breaks, you see it. | "Pantry flagged the gap that morning"; "October close · 1 exception" | BANK-004, NOTIFY-001 | done: owner email and dashboard&#47;bank notices, feed-coverage close exceptions until caught up; actual Plaid sandbox login failure and signed consent warning proven |
| 37 | When a feed breaks, you see it. | "backfilled every missed day once Maya re-linked"; "no duplicates" | BANK-002, BANK-003, BANK-004 | done: sync resumes from its cursor, idempotent on Plaid transaction ids |
| 38 | Loose ends, chased down. | "follows each mismatch across your bank … and inbox until the ledger and the evidence agree" | PAN-18, AGENT-002, CAPTURE-008 | done for the bank and inbox checks and answers that file themselves (PAN-18) |
| 39 | Loose ends, chased down. | "… across your … payroll" ("Payroll off by $50.00") | PAYROLL-001, AGENT-004 | partial: a payroll that does not add up waits for a person; tracing it inside Gusto is missing |
| 40 | Loose ends, chased down. | "Asked Maya by text" | AGENT-002, NOTIFY-001 | missing |
| 41 | Loose ends, chased down. | "Each fix shows what it changed in the report" | PAN-18, AGENT-003 | done: net income before and after on each answer |
| 42 | Closed with your accountant. | "Everything reconciles before Jordan opens it" | PAN-09, PAN-13, PAN-17, PROC-003, PAYROLL-002 | done for reconciliation and the close checks; Stripe clearing comparison and named exceptions are done (PROC-003); payroll-liability checks (PAYROLL-002) remain missing |
| 43 | Closed with your accountant. | "One judgment call, one answer, and October is locked." | PAN-18, PAN-13, CLOSE-003 | done (PAN-18, PAN-13) |
| 44 | Closed with your accountant. | The accountant answers the deposit question in the close | AGENT-002, AGENT-005 | done: invited accountant answers assigned questions in the close or by email reply; open questions visibly prevent locking |
| 45 | Click any number. | "P&L, balance sheet … on cash or accrual" | REPORT-002 | done |
| 46 | Click any number. | "… and cash flow" | REPORT-003 | done: indirect statement, editable account classes, cash tie, entry drill-down and exports |
| 47 | Click any number. | "Every figure opens to the bills, receipts and vendors behind it" | REPORT-005 | done |
| 48 | Click any number. | Aging tab | REPORT-004 | done |
| 49 | Click any number. | 1099-NEC · 2026, "W-9 on file", "under $2,000" | TAXFORM-001, TAXFORM-002, TAXFORM-003 | done for tracking at the tax year's threshold; the online W-9 request (TAXFORM-003) is done under the ct-approved native scope; automatic request mail remains TAXFORM-004 |
| 50 | Interlude | "Books up to date · Oct 31" | PAN-13 | done |
| 51 | Closing | "Open source accounting for US small businesses" / "Free and open source, MIT licensed" | OWN-001 | partial; ownership and MIT licensing ship, provider-fee disclosure remains DATA-001 |
