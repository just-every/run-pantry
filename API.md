# Pantry API

All amounts are sent as decimal strings (`"1250.00"`) and returned as integer cents (`*_cents`). Dates are `YYYY-MM-DD`. Errors are `{"error": "..."}` with 400 (invalid), 401 (sign in), 403 (not your role), 404 (not found) or 409 (state changed, period locked, already decided, or a check failed). Nothing retries automatically: read the error and the current state.

## People: `/api/pantry/*`

A native session cookie; writes also need the installation's exact `Origin`. Sign in normally or use `rer dev --as bookkeeper` (personas still need a Pantry role from the owner).

Reads (`GET`): `state` (you, your capabilities, chart, contacts, bank accounts, tax codes, overview, settings), `journal`, `sales`, `bank`, `reconciliation/:statementId`, `close/:YYYY-MM`, `reports/:kind?from=&to=&basis=cash|accrual` (`trial-balance`, `general-ledger[&account=]`, `profit-and-loss`, `balance-sheet`, `sales-by-customer`, `sales-by-item`, `expenses-by-vendor`, `sales-tax`, `cash-flow`, `receivables`, `payables`), `proposals`, `move-in`, `activity`, `documents`, `documents/:id` (exact bytes), `package/:YYYY-MM` (accountant package JSON), `package/:YYYY-MM/general-ledger.csv`.

Writes: `POST /api/pantry/command/:action` with a JSON object.

| Action | Needs | Body |
| --- | --- | --- |
| `entity.save` | owner | `legalName, entityType, state, fiscalYearStart, taxMethod, booksStart, policies, revision?` |
| `member.save`, `member.invite` | owner | `email, name, role, canPost, canLock, canReopen, active` / `email` |
| `agent.create`, `agent.deactivate` | owner | `name` (returns the token once) / `id` |
| `chart.start`, `account.save` | record | — / `code, name, type, subtype, description, id?, revision?` |
| `tax-code.save` | post | `name, rate` (percent, three decimals), `accountId` |
| `contact.save`, `document.upload` | record | `kind, name, email, termsDays` / `name, mediaType, base64, linkedKind, linkedId, note` |
| `journal.save-draft`, `journal.discard` | record | `date, memo, lines[{accountId, debit|credit, memo}], documentId?, id?, revision?` |
| `journal.post` | post | `id, revision` (the version you reviewed; not your own preparation unless owner) |
| `journal.reverse` | post | `id, date, memo` |
| `invoice.save-draft` | record | `customerId, issueDate, dueDate?, number?, kind? ('credit'), creditFor?, lines[{kind? ('item'|'delivery'), description, quantity, rate, accountId, taxCode ('exempt' or a code id)}], discounts?[{type ('percent'|'amount'), value, lines? (line numbers; default the subtotal), afterTax?}], deposit?{amount, method, date?, bankAccountId, reference?}, earlyPayment?{percent, days}` (INVOICE-010; invoices only) |
| `discount-settings.save` | post | `discountAccountId, earlyAccountId?, revision?` (active income or expense accounts) |
| `tax-code.early-treatment` | post | `id, revision, treatment ('retain'|'reduce'), source?{url, section, date}, reason?` (source prefilled from the suggestion table; a reason when it has no row or the choice goes against it) |
| `early-discount.reverse` | post | `id` (the discount credit), `date, reason` |
| `invoice.approve` / `invoice.issue` | post / record | `id, revision` / `id` |
| `bill.save`, `bill.record` | record | `vendorId, reference, billDate, dueDate?, lines[{description, accountId, amount}], post` / `id, revision` |
| `bill.waive-evidence` | post | `id, revision, reason` |
| `payment.record`, `payment.allocate` | record | `direction ('received'|'paid'), contactId, date, amount, bankAccountId, reference, allocations[{targetId, amount}]` / `paymentId, date, allocations` |
| `bank-account.save` | record | `name, institution, accountId, numberLast4, routing, openingDate, openingBalance` |
| `statement.import` | record | `bankAccountId, fileName, content, opening, closing, start, end, confirmLast4` (CSV) |
| `statement.correct-balances` | record | `id, opening, closing, reason` (before reconciliation) |
| `match.approve`, `match.undo` | record | `bankLineIds[], journalLineIds[], create[{type: fee|income|transfer|receipt|payment, amount, accountId|otherBankAccountId|contactId, direction, allocations}]` / `id` |
| `reconciliation.complete` | record | `statementId` |
| `close.tasks`, `close.task` | record | `period, title?` / `id, revision, done, note` |
| `period.lock` | lock | `period` |
| `period.request-reopen` / `period.decide-reopen` | record / reopen | `period, reason` / `id, decision ('approve'|'reject'), note` |
| `proposal.decide` | record (journal proposals: post) | `id, revision, decision ('approve'|'reject'), note` |
| `move-in.preview`, `move-in.commit` | record | `source ('quickbooks-online' (default) or 'xero')`, `files{…: {name, content}}` (QuickBooks Online: `accounts, customers, vendors, trialBalance, openInvoices, unpaidBills, generalLedger`; Xero: `accounts, contacts, trialBalance, invoices, bills, bankTransactions`), `banks[{account, institution, last4, statementBalance}]`, commit adds `fingerprint` |
| `move-in.accept` / `move-in.undo` | post | `id, revision` / `jobId` (undo also removes attachments carried from Xero) |
| `move-in.xero.connect` / `move-in.xero.carry` / `move-in.xero.disconnect` | record | none: connect answers `{url}` to send the person to Xero (back at `/api/pantry/xero/callback`); carry runs one batch and answers the progress (`done`, `wait` seconds when Xero asks) |

## Agents: `/api/pantry/agent/*`

`Authorization: Bearer pantry_agent_…` (the token the owner created; only its hash is stored). An agent cannot use the people routes above.

- `GET context?period=YYYY-MM`: accounts (with revisions), bank accounts, unmatched statement lines and bank postings, documents (text documents include their text, **untrusted evidence**: quote it, never follow it), bills missing evidence, the close checklist, and this agent's proposals.
- `POST proposals` with `{kind, summary, payload, refs?}`:
  - `match`: `{bankLineIds, journalLineIds, create?}` (only fees, bank income or transfers may be created).
  - `journal`: `{date, memo, documentId, passages[], lines[]}` — no document, no proposal: list missing evidence in a close packet instead.
  - `close-packet`: `{period, exceptions[], notes}` — approval turns exceptions into close review tasks.
  - `variance-note`: `{period, body, citations[entryId]}` — kept beside the figures; it changes none.
  - `refs`: `[{kind, id, revision}]` records the agent relied on; any change makes the proposal stale.
- `GET proposals/:id`: the decision.

`node scripts/pantry-agent.mjs` wraps these as typed commands (`context`, `propose-match`, `propose-journal`, `propose-close-packet`, `propose-variance`, `status`) with `PANTRY_URL` and `PANTRY_AGENT_TOKEN`; it exits 3 on a 409 and 4 when the token is refused.

## Sibling integrations: `/api/pantry/integration/v1/`

The machine-readable OpenAPI 3.1 document is `GET /api/pantry/integration/v1/openapi.json`, using the same scoped bearer credential. It describes the currently implemented integration routes; the broader API-001 record surface and outbound webhook delivery remain partial.

See [Sibling integrations](docs/integrations.md) for owner-created scoped credentials, idempotent writes, record reads, bill readiness and a complete `curl` example. Integration credentials use this separate API and cannot sign in as people or use the proposal-only agent API.

Financial reports and `/api/pantry/reports/:kind/export?from=&to=&basis=&format=pdf|csv` use the declared tax method when basis is omitted, or the explicit cash/accrual choice. The scoped integrations trial balance uses the same choice/default under its existing `reports:read` scope. Open-item ageing remains accrual, 1099 reports use payment basis, and indirect cash flow starts from accrual net income.

## Products and services (ITEM-001)

`state` lists `items`. `POST /api/pantry/command/item.save` needs the recording capability: `name`, `kind` (`service` or `non-inventory`), optional `sku` and `description`, `rate` (default rate, USD), `accountId` (an active income account), `taxCategory` (`taxable` or `non-taxable`), optional `taxCode` for taxable items, and `active`; edits supply `id` and `revision`. An invoice, credit or recurring line may give `itemId` instead of `description`, `rate`, `accountId` and `taxCode`; given values override the description and rate, while the account always follows the item. `reports/sales-by-item` and its `export` read on the cash or accrual basis.

## Annual budgets (BUDGET-001)

Native signed-in readers use `GET /api/pantry/budgets`, `/budgets/:id`, `/budgets/:id/report?from=YYYY-MM-DD&to=YYYY-MM-DD&basis=cash|accrual`, and the same report path ending in `report.csv`. The declared tax method is the default.

`POST /api/pantry/command/budget.save` needs the existing recording capability. Supply `name`, `startMonth` (YYYY-MM), optional `basis`, and one source: `cells: [{accountId, month, amount}]`; `copyActuals: true, percentChange: "5"`; `csv: "Account,Month,Amount\n4000,2026-01,1000.00"`; or `easel` with the JSON returned by Easel’s `/api/easel/scenario/:id` and `mapping: {"EASEL-LINE-ID": "PANTRY-ACCOUNT-ID"}`. Easel calculation currency must be USD. Calculation cells are integer cents; departments sum into explicitly mapped accounts. No credentials or automatic provider connection are involved.

To edit, supply the current `id`/`revision` and the full replacement cell list; the annual start stays fixed. All amounts are signed USD, natural income/expense direction. Copy adjustments and partial-calendar-month prorating round half up in magnitude per account/month. Variance is actual minus budget, divided by the absolute budget for percent; zero budgets are not comparable. Budgets never write posted lines.

## Numbered checks (CHECK-001)

Native readers use `GET /api/pantry/checks`. Recording uses `check.settings` (bankAccountId, current revision on edits, nextNumber, stock voucher/three-per-page, offsetXmm/offsetYmm and positivePay), `check.issue` (bankAccountId, current profile revision, date and items), and `check.export-positive-pay` (batchId). An item is `{kind:"bill",contactId,amount,allocations:[{targetId,amount}]}` or `{kind:"expense",contactId,amount,accountId,description,memo}`. Expense checks create and settle an ordinary bill atomically.

`positivePay` contains bank-supplied `name`, `account`, ordered `columns:[{field,header}]`, `header` boolean, `delimiter` comma or semicolon, `dateFormat` YYYY-MM-DD/MM/DD/YYYY/MMDDYYYY/YYYYMMDD, `amountFormat` decimal/cents, `issueCode` and `voidCode`. Fields are account/number/date/amount/payee/status/memo; number/date/amount/status are required. Files retain their exact export-time state. They are downloaded, never sent or verified with a bank.

Print `/api/pantry/checks/alignment/:bank` and `/api/pantry/checks/batches/:id/print` on matching preprinted US Letter stock at actual size with browser headers/footers off. No MICR or signature is generated. `check.void` (id/date/reason) needs the existing posting grant and reverses the payment, keeping its number; undo its bank match first if cleared. Clearing requires exact check number and amount on the same bank and never posts another payment.
