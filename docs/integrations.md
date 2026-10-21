Give a sibling book such as Pier, Cabin or Coffer its own credential to read and write selected records in Pantry. Requests go to `/api/pantry/integration/v1/` on your Pantry installation.

## Create a credential

The owner opens **People & settings → Integration credentials**, names the connection and ticks the scopes it needs. Use a separate credential for each connection so you can stop one without stopping the others.

Choose **Create integration credential** and copy the value into the sibling book's private configuration. It is shown once. Pantry stores only its hash and cannot show it again. Anyone holding the value can use its scopes; keep it out of source files, logs and shared commands.

The credential cannot sign in as a person. It keeps working after the owner signs out or their session expires, until the owner chooses **Revoke**. Revocation takes effect immediately. To rotate it, create a replacement, put that replacement in the sibling book, then revoke the old credential. If a credential is lost or exposed, revoke it and create another.

## Choose what the connection can do

| Scope | Allows |
| --- | --- |
| `contacts:write` | Read contacts through `state` and create vendors or customers. |
| `invoices:write` | Read and create invoices and credits. |
| `bills:write` | Read and create bills; mark a posted bill received or ready to pay. |
| `journals:write` | Read and create journal entries. |
| `documents:write` | Read document records and upload documents. |
| `payments:read` | Read payments and their allocations to bills or invoices. |
| `payments:write` | Read payments and record external payments and their allocations, with the additional `post` grant. |
| `vendor-credits:read` | Read vendor credits, their allocations and remaining credit. |
| `vendor-credits:write` | Read, record and allocate vendor credits, with the additional `post` grant for writes. |
| `reports:read` | Read the 23 financial reports listed below, with native basis, range, column and filter semantics. |
| `post` | In addition to a record's write scope, post bills, journals, external payments or vendor credits, allocate vendor credits, or issue invoices and credits. |

Read-only connections select the explicit record-type grants in [Record-type readers](#record-type-readers), including contacts:read, invoices:read, bills:read, journals:read and documents:read. A `:write` scope includes reading its existing record type. It does not grant access to the other record types. The `post` scope alone grants no record access. Without `post`, created bills, invoices and journals stay drafts for a person to review and post or issue in Pantry.

Payment recording needs both `payments:write` and `post`: it records money that already moved outside Pantry. Payments have no draft state. These credentials cannot move money, sign in, manage users, lock a period or reopen one. A sibling book still needs to map its records to Pantry's accounts, bank accounts, tax codes and contact IDs; the item catalogue is available with items:read, while contact matching remains governed by the existing native write rules.

Recording or allocating vendor credits needs both `vendor-credits:write` and `post`. Vendor credits have no draft state. A read-only vendor-credit credential can read credits without the `post` grant.

## Send a request

Send `Authorization: Bearer` with the credential on every request. JSON writes also need `Content-Type: application/json` and an `Idempotency-Key`. A person's session cookie is not needed.

Amounts in request bodies are decimal strings, such as `"482.00"`. Returned money fields use integer cents, such as `total_cents` and `open_cents`. Dates are `YYYY-MM-DD`. Successful writes return the record itself, with no extra `data` wrapper.

Every HTTP call with a recognized credential is audited, including failed calls and replays. The owner can see recent calls, the credential name, request path and HTTP status under **Integration credentials**.

### Keep a key for each write

Choose a unique `Idempotency-Key` for each intended write and keep it with that operation. The key is at most 200 characters and belongs to the credential across all write endpoints.

Sending the same key, operation and JSON body again returns the same record with its current values. JSON object property order does not matter: Pantry compares canonical JSON. Changing the operation or body while reusing a successful key returns `409`. A bill key therefore cannot also be its readiness key.

Parallel copies of the same request create only one record. Failed writes do not claim the key. Successful keys are retained, so keep using the original key when checking whether an uncertain request succeeded. After a failure, read the error and current record before deciding what to send. Pantry does not schedule retries.

## Read the books

All paths below follow `/api/pantry/integration/v1/`. List responses contain the named array and `nextCursor`. Use `limit` up to `100`; when `nextCursor` is present, send it as `cursor` with the same filter to get the next page. Filters are exact matches, not searches. URL-encode their values.

| GET path | Scope | Response |
| --- | --- | --- |
| `state` | A granted record scope | `accounts`, `taxCodes`; also `contacts` when `contacts:write` is granted and `bankAccounts` when `payments:read` or `payments:write` is granted. |
| `contacts?name=…` or `contacts?id=…` | `contacts:read` or `contacts:write` | `{ "contacts": […], "nextCursor": … }` |
| `bills?reference=…` or `bills?id=…` | `bills:read` or `bills:write` | `{ "bills": […], "nextCursor": … }` |
| `invoices?number=…` or `invoices?id=…` | `invoices:read` or `invoices:write` | `{ "invoices": […], "nextCursor": … }` |
| `journals?memo=…` or `journals?id=…` | `journals:read` or `journals:write` | `{ "entries": […], "nextCursor": … }` |
| `documents?name=…` | `documents:read` or `documents:write` | `{ "documents": […], "nextCursor": … }` |
| `documents/:id` | `documents:read` or `documents:write` | The original document bytes, as a download. |
| `payments?billId=…`, `payments?invoiceId=…`, `payments?id=…` or `payments?reference=…` | `payments:read` or `payments:write` | `{ "payments": […], "nextCursor": … }`, including allocations and `reversal_id`. |
| `vendor-credits?id=…`, `vendor-credits?vendorId=…` or `vendor-credits?reference=…` | `vendor-credits:read` or `vendor-credits:write` | `{ "vendorCredits": […], "nextCursor": … }`, including allocations and `unallocated_cents`. |
| `vendor-credits/:id` | `vendor-credits:read` or `vendor-credits:write` | The exact native credit, including allocations and `unallocated_cents`; an unknown ID returns `404`. |
| `reports/trial-balance?to=YYYY-MM-DD&basis=cash` | `reports:read` | The trial-balance rows through that date, on the selected basis. Omitting basis uses the business’s declared tax method (accrual when undeclared); an explicit choice wins. |

Bill and invoice readbacks include `open_cents`. Read payment allocations to see which payment was applied to which record. A reversed payment has a `reversal_id`; its allocations no longer reduce the open balance, so the bill or invoice reopens for that amount. Do not infer payment from a bill's readiness flag.

Each `bankAccounts` row contains `id`, `name`, `account_id`, `institution`, `number_last4`, `ledger_code` and `ledger_name`. Have the owner select the existing bank or Stripe clearing account that received the money, then use its `id` as `bankAccountId`. This route does not create accounts or expose routing details.

### Financial reports (API-001 / REPORT-002)

`GET reports/:kind` requires `reports:read`. It returns the corresponding native report object, with integer-cent figures and source links. Source links open the native app and still require a person's authorized session. The supported `kind` values are:

| Group | Report kinds |
| --- | --- |
| Statements and ledger | `trial-balance`, `general-ledger`, `profit-and-loss`, `balance-sheet` |
| Sales, expenses and tax | `sales-by-customer`, `expenses-by-vendor`, `sales-by-item`, `sales-tax` |
| Cash and open items | `cash-flow`, `receivables`, `payables`, `receivables-summary`, `payables-summary`, `open-invoices`, `unpaid-bills`, `customer-balances`, `vendor-balances` |
| Financial report library | `transactions`, `journal`, `deposits`, `check-detail`, `reconciliations`, `contractor-summary` |

`to` defaults to today in UTC; `from` defaults to the first day of that month. Dates are inclusive; as-of reports use `to`. `basis=cash|accrual` overrides the declared tax method; an undeclared method defaults to accrual. Open items and reconciliations retain their accrual labels, the contractor summary uses payment basis, and indirect cash flow starts from accrual net income. Invalid bases are refused, including for fixed-basis reports.

`general-ledger` accepts `account`. The `transactions` and `journal` library reports accept `account` and `payee` (an exact contact ID). Statements accept `columns=single|prior-period|prior-year|months|quarters|ytd`; profit-and-loss also accepts `customer`. These use the same validation and calculations as native reports. Calculated reports are not record lists and have no cursor pagination.

For example, read `reports/profit-and-loss?from=2026-10-01&to=2026-10-31&basis=cash&columns=prior-period`. The OpenAPI document names every supported report path and its parameters. Reads use the same credential budget and call history as the other v1 routes. They create no journal or idempotency claim.

This transport does not expose the native audit-history report, full-TIN filing CSV, custom-report shares, close packages or native export routes. A report credential cannot use the people API or write records. Record-type read grants and their projections are documented below; outbound webhook delivery has its own owner configuration.

## Write records

Every POST below needs its own `Idempotency-Key`.

| POST path | Body |
| --- | --- |
| `contacts` | `externalId`, `kind` (`vendor` or `customer`), `name`, optional `email`, `termsDays` |
| `bills` | `vendorId`, `reference`, `billDate`, optional `dueDate` and `memo`, `post`, `lines[{description, accountId, amount}]` |
| `invoices` | `customerId`, optional `number`, `issueDate`, optional `dueDate`, `post`, `lines[{description, quantity, rate, accountId, taxCode}]`; for a credit add `kind: "credit"` and `creditFor` (the invoice ID). |
| `journals` | `date`, `memo`, `post`, `lines[{accountId, debit}]` and `lines[{accountId, credit}]`; debits and credits must balance. |
| `documents` | `name`, `mediaType`, `base64`, `linkedKind` (for example `bill`), `linkedId`, `note` |
| `bills/:id/readiness` | `received` and `readyToPay` booleans |
| `payments` | `direction` (`received` or `paid`), `contactId`, `date`, `amount`, `bankAccountId`, `reference`, `allocations[{targetId, amount}]`; optional `method`, `memo`, `post: true` |
| `vendor-credits` | `vendorId`, `date`, `amount`, `reference`, `accountId`; optional `allocations[{targetId, amount}]`, `post: true` |
| `vendor-credits/:id/allocations` | Nonempty `allocations[{targetId, amount}]`; optional `date` (default credit date), `post: true` |

Each write needs the corresponding `:write` scope. Set `post: true` to post or issue at creation, with the additional `post` scope. Use decimal strings for bill amounts, invoice quantities and rates, and journal debits and credits. Invoice `taxCode` is `"exempt"` or a tax-code ID from `state`.

Invoice creation also accepts the native INVOICE-010 fields: delivery lines (`kind: "delivery"`), `discounts`, `deposit` and `earlyPayment`, as described by `InvoiceInput` in OpenAPI. Subtotal discounts exclude delivery charges; an explicitly selected line can include delivery. Before-tax discounts reduce the taxable base, while after-tax discounts leave tax unchanged. A deposit records money already received into the named bank account; it does not request a charge. The deposit is posted once at issue and counts toward an invoice's frozen early-payment offer. The balance paid within the window takes the linked discount credit once, using the approved per-code tax treatment. Missing discount accounts, undecided tax treatment at issuance, invalid terms, locked periods and missing posting grants are refused through the same native rules. A refused create leaves its idempotency key available for a repaired retry.

`destinationState` and the applicable exemption certificate snapshot are preserved on drafts and issued invoices. Certificate validity is guarded inside the posting batch. Retiring a certificate leaves the prior snapshot intact, prevents its use on new invoices, and requires an existing draft to be reviewed before approval, just as in Pantry's native invoice door.

`payments` always needs `payments:write` and `post`, even when the body omits `post`. `post: false` is refused because payments cannot be drafts. Use decimal strings for the payment and allocation amounts. A received payment allocates to issued invoices belonging to the customer; a paid payment allocates to posted bills belonging to the vendor. Allocations cannot exceed the payment or each item's open balance. Payment writes use Pantry's native balanced posting and locked-period checks. Successful writes and replays return the payment itself, including its allocations.

Keep a stable reference such as the Stripe payment intent ID and keep the original idempotency key. If a response is lost, retry with that key and unchanged body, or find the payment through the exact `reference` filter and check its allocations. References are not unique; a reference lookup does not replace the idempotency key. Inspect all pages and verify the contact, amount and allocated invoice before adopting a recovered record.

Contact upserts remember the sibling's `externalId`. On the first upsert from a connection or replacement credential, Pantry links an existing contact with the same kind and exact name. Omitted email and payment terms stay as they are; an inactive contact waits for the owner to reactivate it.

Document uploads preserve the exact decoded bytes and have a 1.5 MB file limit. Base64-encode the file; do not send a path or a download URL.

Readiness needs `bills:write` and a posted bill. A bill must be received before it can be ready to pay; sending both flags as `true` records both together. This records readiness only. It creates no payment or money movement. Writes still respect Pantry's period locks; a locked-period conflict returns `409`.

### Vendor credits

`POST vendor-credits` records a posted vendor credit against the original active expense or asset `accountId`. Bank, receivable and payable accounts are refused. Send the vendor's credit reference and the credit date, with decimal strings for `amount` and any allocation amounts. The reference is unique for that vendor. Omit `allocations` to retain the whole amount as unapplied credit, or supply bill IDs as `targetId` to apply it at creation.

`POST vendor-credits/:id/allocations` applies remaining credit to one or more bills. It requires a nonempty allocation list. Its optional `date` defaults to the original credit date and cannot precede that date. Both POST routes require `vendor-credits:write` **and** `post`, even if `post` is omitted from the body. `post: false` is refused.

Every target must be an open posted bill for the same vendor. Total allocations cannot exceed the credit's remaining amount or any bill's open balance, including amounts already settled by payments or other credits. Native locked-period and accounting guards run inside the atomic write. Allocating a credit reduces the bill's open balance without recording a payment or moving money.

Each write needs its own `Idempotency-Key`, including later allocations on the same credit. Keys and domain changes are committed together: concurrent duplicates apply once, failed writes leave the key available, and a successful key reused with a different path or body returns `409`. A replay returns the current native credit, including allocations added since the original request. Keep the original body and key for an uncertain request; a repeated allocation with a new key is a new write.

Read credits through `GET vendor-credits` with exact `id`, `vendorId` and `reference` filters, which can be combined. Lists use the same exclusive stable record-ID `cursor` and `limit` (default and maximum `100`) as other record lists. The response is `{ "vendorCredits": […], "nextCursor": … }`; `GET vendor-credits/:id` returns the native credit itself. Both accept `vendor-credits:read` or `vendor-credits:write`.

Credit responses use native field names such as `vendor_id`, `credit_date`, `account_id`, `journal_id`, integer `amount_cents` and `unallocated_cents`, and `allocations`. Each allocation contains `id`, `source_kind: "credit"`, `source_id`, `target_kind: "bill"`, `target_id`, integer `amount_cents`, `allocation_date`, `created_by` and `created_at`. Reads and writes use the existing credential budget and call log. Vendor-credit writes remain limited to their existing native posting and allocation pipeline.

## Example: send a bill, mark it ready and read payments

This example uses `curl` and `jq`. Give this connection `contacts:write`, `bills:write`, `payments:read` and `post`. Supply `PANTRY_TOKEN` through your private environment or secret manager using the value copied at creation. Replace the installation URL, dates and sibling record identifiers below. Keep the keys unchanged if you repeat these same operations.

```sh
export PANTRY_URL='https://your-pantry.example'
: "${PANTRY_TOKEN:?Supply the credential in your private environment}"
API="$PANTRY_URL/api/pantry/integration/v1"

VENDOR_EXTERNAL_ID='sibling-vendor-42'
BILL_REFERENCE='SUPPLIER-2026-042'
BILL_DATE='2026-10-17'
CONTACT_KEY='sibling-vendor-42-create'
BILL_KEY='sibling-bill-42-create'
READINESS_KEY='sibling-bill-42-ready'

# Read the chart and tax codes. Choose the real expense or asset account ID.
curl --fail-with-body --silent --show-error \
  -H "Authorization: Bearer $PANTRY_TOKEN" "$API/state" | jq .
EXPENSE_ACCOUNT_ID='replace-with-the-account-id-from-state'

# Create the vendor. The response is the contact record itself.
VENDOR=$(curl --fail-with-body --silent --show-error \
  -H "Authorization: Bearer $PANTRY_TOKEN" \
  -H 'Content-Type: application/json' -H "Idempotency-Key: $CONTACT_KEY" \
  --data "$(jq -n --arg externalId "$VENDOR_EXTERNAL_ID" \
    '{externalId: $externalId, kind: "vendor", name: "Example supplier", termsDays: 30}')" \
  "$API/contacts") || exit 1
VENDOR_ID=$(printf '%s' "$VENDOR" | jq -er '.id') || exit 1

# Record the bill using Pantry's account ID and the returned vendor ID.
BILL=$(curl --fail-with-body --silent --show-error \
  -H "Authorization: Bearer $PANTRY_TOKEN" \
  -H 'Content-Type: application/json' -H "Idempotency-Key: $BILL_KEY" \
  --data "$(jq -n --arg vendorId "$VENDOR_ID" --arg reference "$BILL_REFERENCE" \
    --arg billDate "$BILL_DATE" --arg accountId "$EXPENSE_ACCOUNT_ID" \
    '{vendorId: $vendorId, reference: $reference, billDate: $billDate, post: true,
      lines: [{description: "Supplies", accountId: $accountId, amount: "482.00"}]}')" \
  "$API/bills") || exit 1
BILL_ID=$(printf '%s' "$BILL" | jq -er '.id') || exit 1
printf '%s' "$BILL" | jq .

# Record that this posted bill is received and ready to pay.
curl --fail-with-body --silent --show-error \
  -H "Authorization: Bearer $PANTRY_TOKEN" \
  -H 'Content-Type: application/json' -H "Idempotency-Key: $READINESS_KEY" \
  --data '{"received":true,"readyToPay":true}' \
  "$API/bills/$BILL_ID/readiness" | jq .

# Read the bill again and check its current open balance.
curl --fail-with-body --silent --show-error --get \
  -H "Authorization: Bearer $PANTRY_TOKEN" \
  --data-urlencode "id=$BILL_ID" "$API/bills" | jq .

# Read payments allocated to the bill. This request creates no payment.
curl --fail-with-body --silent --show-error --get \
  -H "Authorization: Bearer $PANTRY_TOKEN" \
  --data-urlencode "billId=$BILL_ID" --data-urlencode 'limit=100' \
  "$API/payments" | jq .
```

Follow `nextCursor` to read further payment pages. A new bill can have no payments and its full amount still open. Paying it happens outside Pantry; a credential with `payments:write` and `post` can record that external payment, or a person can record it in Pantry.

## Record a Stripe receipt against an invoice

Give the connection `payments:write` and `post`, along with the contact and invoice scopes it needs. Once Stripe confirms the payment, POST a body such as this to `payments` with a stable `Idempotency-Key` for that Stripe payment. Replace the contact, invoice and bank account IDs with real Pantry IDs; choose the Stripe clearing account through `state`.

```json
{
  "direction": "received",
  "contactId": "the-pantry-customer-id",
  "date": "2026-10-18",
  "amount": "40.00",
  "bankAccountId": "the-selected-stripe-clearing-bank-account-id",
  "reference": "the-stripe-payment-intent-id",
  "method": "card",
  "allocations": [{ "targetId": "the-pantry-invoice-id", "amount": "40.00" }]
}
```

The response includes the allocation. Read the invoice again to confirm its `open_cents` is zero. Stripe fees and payout reconciliation are separate accounting records; this receipt records the gross invoice payment.

## Errors and connectivity

Errors return `{ "error": "…" }`. `400` means the request is invalid; `401` means the credential is missing, invalid or revoked; `403` means a scope is missing; `404` means the record or route was not found; `409` means a state or period check failed, or an idempotency key was reused for a different operation or body. Read the error before changing a request.

The inbound integration API does not need Pantry to make an outbound provider call. The sibling book must be able to reach your Pantry URL, which may require connectivity to your self-hosted installation.

RER Managed has no outbound provider connection for seed integrations and no relay. Provider calls there say plainly that they are not available yet. On a self-hosted Pantry, configured provider connections can make those calls. This is separate from access to the inbound integration API.

This page covers the versioned scoped business-record surface. People and proposal-only agent access are described separately in the repository's `API.md`.

## Machine-readable API description (API-001)

Fetch `GET /api/pantry/integration/v1/openapi.json` with the same bearer credential. The OpenAPI 3.1 document uses this installation's relative server URL, lists every current scoped v1 read/write route, request schemas, filters, pagination, the idempotency header, error responses and per-operation scope requirements. `x-pantry-scopes` describes the existing record scopes; it is not an OAuth scope grant. Schema discovery uses the existing credential/revocation checks and call log. It contains no business records, credential values or provider settings.

Record responses keep native fields (including integer cents); their schemas allow additional fields. Native accounting validation, approvals and locked periods still apply. POST success is `200`. Replays return the current record, including payments applied since the original write. A key is unique across paths for one credential; changing the path or body returns `409`. JSON object key order does not matter; array order does. Every list uses an exclusive stable record-ID cursor, a default page size of 100 and a maximum of 100. Filters match exact values. Payment `billId` takes precedence when both allocation filters are supplied.

### Request budget

Every valid, non-revoked integration credential has **120 requests per fixed UTC minute**, shared across all v1 paths and Worker instances. The minute starts at Unix seconds divisible by 60. Reads, writes, OpenAPI discovery, idempotent replays, refused scopes, invalid request bodies and unknown v1 paths all consume one request. The budget is stored in D1 and admitted atomically, so concurrent requests share the same limit. Different credentials have separate budgets even from the same client address. Native session routes are outside this integration budget.

Admitted responses carry `X-RateLimit-Limit` (120), `X-RateLimit-Remaining` (the balance after admission) and `X-RateLimit-Reset` (Unix seconds at the next minute boundary), including domain refusals. Concurrent responses can arrive out of admission order. An exhausted credential gets `429` with the same headers, zero remaining, a JSON error and `Retry-After` in whole seconds (at least 1). Excess requests do no domain work, reserve no idempotency key and never extend the window. Wait for `Retry-After`, then retry a write with its original key and unchanged body. Missing, unknown and revoked credentials return `401` before admission. Host/provider capacity limits can also apply.

The integration call audit includes throttled requests and remains an owner-only request log. Business event metadata is a separate scoped resource; neither record-read grant exposes webhook subscriptions or delivery history.


## Record-type readers

Every scope below is an independent, unchecked owner selection. Granting one does not grant another. Child occurrences and safe child references belong to their listed parent record scope. These new record readers are GET-only; there is no command proxy, security action, report-share mutation or new write/post grant.

| Explicit scope | GET collection paths |
| --- | --- |
| `business:read` | `business` |
| `accounts:read` | `accounts` |
| `tax-codes:read` | `tax-codes` |
| `items:read` | `items` |
| `contacts:read` | `contact-deliveries`, `contact-aliases`, `contact-history` |
| `exemptions:read` | `exemptions` |
| `contractors:read` | `contractors` |
| `nexus-alerts:read` | `nexus-alerts` |
| `nexus-decisions:read` | `nexus-decisions` |
| `receipts:read` | `receipts`, `capture-drafts` |
| `receipt-rules:read` | `receipt-rules` |
| `cutovers:read` | `cutovers`, `historical-lines` |
| `bank-accounts:read` | `bank-accounts` |
| `statements:read` | `statements` |
| `bank-lines:read` | `bank-lines`, `line-decisions` |
| `matches:read` | `matches` |
| `transfers:read` | `transfers`, `transfer-halves` |
| `reconciliations:read` | `reconciliations`, `reconciliation-undos` |
| `bank-rules:read` | `bank-rules` |
| `recurring-invoices:read` | `recurring-invoices`, `recurring-invoice-runs`, `recurring-prices` |
| `recurring-bills:read` | `recurring-bills`, `recurring-bill-runs` |
| `recurring-journals:read` | `recurring-journals`, `recurring-journal-runs` |
| `recognition:read` | `recognition-schedules`, `recognition-runs`, `recognition-milestones` |
| `budgets:read` | `budgets` |
| `checks:read` | `checks`, `check-batches` |
| `periods:read` | `periods`, `reopen-requests` |
| `close-tasks:read` | `close-tasks` |
| `findings:read` | `findings` |
| `questions:read` | `questions` |
| `proposals:read` | `proposals`, `management-notes` |
| `journals:read` | `review-notes`, `reclassifications` |
| `custom-reports:read` | `custom-reports` |
| `management-packages:read` | `management-packages` |
| `audit-events:read` | `audit-events` |
| `approvals:read` | `approvals` |
| `feed-balances:read` | `feed-balances` |
| `feed-history:read` | `feed-history` |
| `feed-exceptions:read` | `feed-exceptions` |
| `processor-payments:read` | `processor-payments` |
| `processor-payouts:read` | `processor-payouts` |
| `processor-clearing:read` | `processor-clearing` |
| `processor-balances:read` | `processor-balances` |
| `payrolls:read` | `payrolls` |

All these collections return `{ "records": [...], "nextCursor": null | "..." }`. Each also supports `GET path/:id`, returning one projected record or `404`. Use `limit=1..100` (default 100) and the exclusive ID `cursor` for stable pages, including composed IDs on schedule occurrences. Keep filters unchanged when following a cursor. All accept exact `id`; OpenAPI lists each type's additional exact filters, such as `bankAccountId`, `statementId`, `customerId`, `vendorId`, `period`, `status`, `recurringId` or `scheduleId`. Supplied filters combine with AND. Unknown filters on these new collections return `400`.

The established contacts, invoices, bills, journals and payments readers also have `GET path/:id`; documents/:id remains an original-byte download. Their list envelope names stay contacts, invoices, bills, entries, documents, payments and vendorCredits. Contacts accept kind/active, invoices accept customerId/status/date, bills accept vendorId/status/date, and journals accept status/date, in addition to their existing exact filters. Their new read grants cannot POST, including when a caller supplies post:true or an idempotency key. Existing writes continue through the same native Prepared pipeline with its approval, posting and period-lock guards.

`GET year-end/:year` separately requires `year-end:read` and calls the native fiscal-year reader. It projects fiscal dates, monthly lock/readiness and task counts, and named readiness checks. It excludes tax identities, payroll records and opening/closing financial statement snapshots. Calculated financial statements and report-library results remain exclusively on `reports/:kind` under `reports:read`, using the existing REPORT-002 basis choice and labels. Budgets, saved definitions and provider observations are records, not replacement calculations.

### Read consent and projections

An owner-issued record scope delegates business read consent for that named type. In particular custom-reports:read and management-packages:read let the connection read all saved definitions of that type. This delegation is separate from native-person ownership and role sharing: the person's existing share, export, edit and figure routes still enforce their native session rules. The integration response contains no shared-role configuration or creator identity. Package definitions contain report IDs, cover and commentary; reading a referenced report definition still needs custom-reports:read. Calculated package exports stay native.

OpenAPI enumerates the explicit projected fields for each new record. Banking reads expose only last-four account digits; routing and full account numbers, print/positive-pay exports and reconciliation proof snapshots stay native. Match child rows contain line IDs and active state. Recurring and recognition runs retain their occurrence, revision, status and result references without historical execution snapshots. Budgets include account/month/cents child cells. Recognition definitions include the native installment plan, without inventing calculated remaining balances.

Contacts include business profile, billing contacts/roles, addresses, payment offerings and internal business notes under contacts:read. Contact history lists invoice/credit/bill/payment activity and email/certificate metadata; contact-deliveries includes recipient, subject, time and outcome, with no provider detail or hosted links. Full sibling financial records and certificate document bytes still require their respective record/document grants. Contractor reads include filing identity/address and tin_masked, never the full TIN or filing CSV.

Questions expose the discussion and answers but omit reply tokens, mail detail, model facts/choices and pending actions. Proposals expose decision/result metadata, with payloads and cited snapshots omitted. Business audit and approval readers expose subject references, revision, event/decision and time; they omit actor identities, authority credentials, before/detail snapshots and owner/security/credential/erasure/retention/subscription events. Receipt reads expose accounting and duplicate metadata, with raw model and mail snapshots omitted.

Provider read grants select financial observation types independently: feed balances/history/change notices, processor payment/payout/clearing/balance observations and summarized payrolls. They omit source connections, source credentials, sealed values, routing/account numbers, hosted-link or payment tokens, raw source snapshots and provider errors. A record reference never grants access to its target.

Owner/member/auth/session/passkey/agent/integration/provider credentials, erasure and retention records/settings, security and approval policies, and webhook subscriptions/history remain native-owner only. The compatibility state route retains its existing limited chart/tax mapping behavior; it does not confer access to these new collections. Revocation, durable rate limits and owner call history apply to every route here, including exact lookups and discovery.

## Webhook receivers

The native owner manages webhooks in Settings, independently of integration credentials. [API.md](https://github.com/just-every/run-pantry/blob/main/API.md) documents exact payload bytes, HMAC verification, the five-minute timestamp limit, 24-hour rotation overlap, retry schedule, consent cancellation and safe restore behavior. The settings data declaration lists only destination hosts, selected event types and the thin payload fields. Record details require their own granular read grant.
