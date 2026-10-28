<!-- Generated from CONTRACT.md by contract-docs. Edit CONTRACT.md, then regenerate. -->

# Pantry product homepage claims

A claim is done when every clause behind it is done, missing when every one is missing, and partial otherwise.

| # | Section | Claim | Clauses | Status |
| --- | --- | --- | --- | --- |
| 1 | Hero | "pulls in your bank and cards" | `BANK-001` partial; `BANK-003` done; `CONNECT-001` partial; `PAN-07` done | partial |
| 2 | Hero | "catches every receipt" | `PAN-17` done; `CAPTURE-001` partial; `CAPTURE-002` partial; `CAPTURE-003` partial | partial |
| 3 | Hero | "gets invoices paid" | `INVOICE-002` partial; `INVOICE-004` done; `PAY-001` partial; `PAY-003` done | partial |
| 4 | Hero | "closes the month with your accountant" | `PAN-13` done; `CLOSE-003` partial | partial |
| 5 | Hero | "100% free, open source" | `OWN-001` partial | partial |
| 6 | Hero cards | Net income · October, the P&L | `PAN-12` done; `REPORT-001` done | done |
| 7 | Hero cards | Chase Business ••4417 feed, 2,847 transactions | `BANK-001` partial; `BANK-004` done | partial |
| 8 | Hero cards | Home Depot receipt read into vendor, date, category | `PAN-17` done; `CAPTURE-003` partial | partial |
| 9 | Hero cards | Stripe payout matched to 23 charges, fees split | `PAN-19` done; `PROC-001` partial | partial |
| 10 | Hero cards | INV-0231 "Paid via ACH" | `PAY-004` done | done |
| 11 | Hero cards | "Looks right, closing October · Reviewed by your accountant" | `PAN-13` done | done |
| 12 | A month in the books | "one bank, one card, Stripe, Gusto and an accountant" | `BANK-001` partial; `PAN-19` done; `PAN-01` done | partial |
| 13 | A month in the books | "Oct 1 · 2,847 transactions backfilled" | `BANK-002` done | done |
| 14 | A month in the books | "Oct 20 · Amex ••1009 sign-in expired" | `BANK-004` done | done |
| 15 | A month in the books | "Oct 27 · Agent closes 3 loose ends" | `PAN-18` done; `AGENT-002` partial; `NOTIFY-001` partial | partial |
| 16 | A month in the books | "Oct 31 · Books up to date", "Nov 2 · Locked by Jordan Kim, CPA" | `PAN-13` done | done |
| 17 | Bring your books with you | "Import from QuickBooks Online or Xero" | `PAN-16` done; `MIGRATE-001` partial; `MIGRATE-002` partial | partial |
| 18 | Bring your books with you | "Balances, open items … tie out before you switch" (trial balance matched to the cent, signed off by the accountant) | `PAN-16` done | done |
| 19 | Bring your books with you | "… and attachments tie out" | `PAN-16` done; `MIGRATE-001` partial; `MIGRATE-005` partial | partial |
| 20 | Bring your books with you | Terminal: `git clone …run-pantry.git pantry`, `cd pantry`, `rer install`, `rer setup`, `rer dev` | `OWN-001` partial | partial |
| 21 | Every transaction, already in. | "Chase, Amex, Stripe and Gusto land in one ledger" | `BANK-001` partial; `PAN-19` done; `RULE-001` done | partial |
| 22 | Every transaction, already in. | "Rules code the routine" | `RULE-002` done | done |
| 23 | Every transaction, already in. | "Payouts and payroll split into real entries" | `PAN-19` done; `PROC-001` partial; `PAYROLL-001` partial | partial |
| 24 | Every transaction, already in. | Ledger with "Needs review 2", "Matched to invoice", "Receipt attached" | `RULE-001` done; `PAY-003` done; `PAN-17` done | done |
| 25 | Every transaction, already in. | "Deposit? · For Jordan" | `AGENT-002` partial | partial |
| 26 | Snap it or forward it. | Snap a photo or forward the email | `PAN-17` done; `CAPTURE-001` partial; `CAPTURE-002` partial | partial |
| 27 | Snap it or forward it. | "reads the vendor, date and total, finds the card charge" | `PAN-17` done; `CAPTURE-003` partial; `CAPTURE-004` done | partial |
| 28 | Snap it or forward it. | "files each receipt once" ("Emailed copy skipped · already attached") | `CAPTURE-005` done | done |
| 29 | Sent. Reminded. Paid. Matched. | "Email the invoice with a card … link" | `INVOICE-002` partial; `PAY-001` partial | partial |
| 30 | Sent. Reminded. Paid. Matched. | "Reminders go out on schedule" | `INVOICE-004` done | done |
| 31 | Sent. Reminded. Paid. Matched. | "the payment matches itself" (emailed, viewed, reminded, paid by ACH bank transfer, matched) | `INVOICE-002` partial; `INVOICE-003` done; `PAY-003` done; `PAY-004` done | partial |
| 32 | Sent. Reminded. Paid. Matched. | Recurring INV-0240; Receivables aging | `INVOICE-005` done; `REPORT-004` done | done |
| 33 | Sent. Reminded. Paid. Matched. | "… or ACH link" | `PAY-001` partial | partial |
| 34 | When a feed breaks, you see it. | Connection status, last successful sync, the plain-words sign-in error and Re-link | `BANK-004` done | done |
| 35 | When a feed breaks, you see it. | "Next sync" | `BANK-004` done | done |
| 36 | When a feed breaks, you see it. | "Pantry flagged the gap that morning"; "October close · 1 exception" | `BANK-004` done; `NOTIFY-001` partial | partial |
| 37 | When a feed breaks, you see it. | "backfilled every missed day once Maya re-linked"; "no duplicates" | `BANK-002` done; `BANK-003` done; `BANK-004` done | done |
| 38 | Loose ends, chased down. | "follows each mismatch across your bank … and inbox until the ledger and the evidence agree" | `PAN-18` done; `AGENT-002` partial; `CAPTURE-008` partial | partial |
| 39 | Loose ends, chased down. | "… across your … payroll" ("Payroll off by $50.00") | `PAYROLL-001` partial; `AGENT-004` partial | partial |
| 40 | Loose ends, chased down. | "Asked Maya by text" | `AGENT-002` partial; `NOTIFY-001` partial | partial |
| 41 | Loose ends, chased down. | "Each fix shows what it changed in the report" | `PAN-18` done; `AGENT-003` done | done |
| 42 | Closed with your accountant. | "Everything reconciles before Jordan opens it" | `PAN-09` done; `PAN-13` done; `PAN-17` done; `PROC-003` done; `PAYROLL-002` missing | partial |
| 43 | Closed with your accountant. | "One judgment call, one answer, and October is locked." | `PAN-18` done; `PAN-13` done; `CLOSE-003` partial | partial |
| 44 | Closed with your accountant. | The accountant answers the deposit question in the close | `AGENT-002` partial; `AGENT-005` partial | partial |
| 45 | Click any number. | "P&L, balance sheet … on cash or accrual" | `REPORT-002` done | done |
| 46 | Click any number. | "… and cash flow" | `REPORT-003` done | done |
| 47 | Click any number. | "Every figure opens to the bills, receipts and vendors behind it" | `REPORT-005` done | done |
| 48 | Click any number. | Aging tab | `REPORT-004` done | done |
| 49 | Click any number. | 1099-NEC · 2026, "W-9 on file", "under $2,000" | `TAXFORM-001` done; `TAXFORM-002` partial; `TAXFORM-003` done | partial |
| 50 | Interlude | "Books up to date · Oct 31" | `PAN-13` done | done |
| 51 | Closing | "Open source accounting for US small businesses" / "Free and open source, MIT licensed" | `OWN-001` partial | partial |

Claims: 51; 21 done, 30 partial, 0 missing.
