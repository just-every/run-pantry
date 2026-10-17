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
- `xero/`: Xero's standard exports for the same business moving from Xero at
  31 August 2026: the chart of accounts and contacts (Xero's CSV exports;
  contact columns Pantry does not read are left out), all sales invoices and
  all bills (Xero's CSV exports, one row per line item, in every status:
  awaiting payment, paid, draft, voided, after the cutover date, a credit
  note), and the Trial Balance and Account Transactions reports saved as CSV
  in the layout those reports export (title rows, group headings, `Name (code)`
  accounts, `Total …` rows, opening and closing balances). The trial balance
  balances at 96,360.58; its receivables (9,183.45) and payables (2,317.08)
  equal the open items, and each bank account's transactions reach its balance.
- `xero-api/`: Xero API responses in the shapes Xero's OpenAPI description
  (XeroAPI/Xero-OpenAPI, `xero_accounting.yaml`) documents: the token answer
  (an access token carrying `authentication_event_id`), `GET /connections` (an
  older organisation and the one just chosen), `GET /Invoices` for the open
  items (with another supplier's bill sharing a number), each invoice's
  `GET …/Attachments` list (one file over 1.5 MB), and the files themselves
  (`files/`, small PDFs and a PNG). Tests serve them at the network edge only.
- `bank/operating-checking-2026-09.csv`: a business checking statement CSV in
  the column layout Chase's download uses (Details, Posting Date, Description,
  Amount, Type, Balance, Check or Slip #). Opening 24,813.52, closing 27,797.02.
- `bank/savings-2026-09.ofx`: an OFX 1.0.2 (SGML) savings statement for the
  account ending 7730, closing ledger balance 2,001.25.
- `bank/operating-checking-2026-10.csv`: October for the same checking account
  (opening 27,797.02, closing 28,623.51) with routine card charges (Adobe,
  Staples, Google, Comcast) for the bank-rules flow.
- `plaid/`: Plaid API responses in the shapes Plaid's API reference documents
  for its sandbox institution First Platypus Bank (`ins_109508`): Link token,
  public token exchange, accounts, three `/transactions/sync` pages (history,
  then a pending charge posting, a removal and a modification) and the
  `ITEM_LOGIN_REQUIRED` error. Tests serve them at the network edge only.
