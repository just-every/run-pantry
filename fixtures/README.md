# Fixtures

Synthetic files for one fictional business, Juniper Lane Design LLC, written in
the documented shapes of the real exports. They are test and demonstration
inputs only; no real company's data is used.

- `quickbooks-online/`: QuickBooks Online report exports saved as CSV, in the
  layout those reports export (title rows, one header row, grouped rows with
  "Total for …" rows, a TOTAL row and a basis/time footer): Account List,
  Customer Contact List, Vendor Contact List, Trial Balance as of the cutover
  date (August 31, 2026), Open Invoices, Unpaid Bills and General Ledger.
  The trial balance's receivables and payables equal the open items, and its
  checking balance equals the reconciled statement balance, so the move-in
  tie-outs pass.
- `bank/operating-checking-2026-09.csv`: a business checking statement CSV in
  the column layout Chase's download uses (Details, Posting Date, Description,
  Amount, Type, Balance, Check or Slip #). Opening 24,813.52, closing 27,797.02.
- `bank/savings-2026-09.ofx`: an OFX 1.0.2 (SGML) savings statement for the
  account ending 7730, closing ledger balance 2,001.25.
