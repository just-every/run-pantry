# Move in from QuickBooks Online or Xero

Pantry has two move-in kits on one shared core (`src/pantry/cutover/`): QuickBooks Online (`qbo.ts`) and Xero (`xero.ts`). Each parses its exports into the same records, so the tie-outs, the import plan, undo and sign-off (`plan.ts`, `commands.ts`) are one code path. A preview names its `source` (`quickbooks-online`, the default, or `xero`).

## QuickBooks Online

The QuickBooks Online kit takes a **cutover package** from QuickBooks Online (QBO): the chart, customers and vendors, an accountant-approved trial balance on the cutover date, the open invoices and unpaid bills behind its receivable and payable balances, and a general-ledger history kept read-only. It is built on Base's import kit (`src/modules/import-kit`): every upload is planned as a dry run, committed as one journaled import job with the exact uploaded bytes kept, and undone by the kit while nothing it wrote has changed.

QBO's export help (Settings → Export data) describes reports and lists exported as Excel files in one .zip, attachments exported as a separate .zip, and points to third-party apps for a full backup. Pantry therefore moves balances and open items, not transaction history: the history file is kept for reference only.

### The seven files

Run each report in QBO for the cutover date and export it unchanged; save each Excel report as CSV (one sheet, values unchanged). This release reads CSV, not .xlsx. Pantry reads the layout those exports use: title rows (company, report name, date), one header row, data rows, a `TOTAL` row and a footer naming the basis and time; grouped reports put a group heading row before each group and a `Total for …` row after it.

| File | QBO report | Columns Pantry reads |
| --- | --- | --- |
| Account List | Reports → Account List | `Account #` (optional), `Full name` (or `Account`), `Type`, `Detail type`, `Description` |
| Customer Contact List | Reports → Customer Contact List | `Customer`, `Email` |
| Vendor Contact List | Reports → Vendor Contact List | `Vendor`, `Email` |
| Trial Balance | Reports → Trial Balance, "As of" the cutover date | account name (first column), `Debit`, `Credit` |
| Open Invoices | Reports → Open Invoices, as of the cutover date, grouped by customer | `Date`, `Num`, `Due date`, `Amount`, `Open balance` |
| Unpaid Bills | Reports → Unpaid Bills, as of the cutover date, grouped by vendor | `Date`, `Num`, `Due date`, `Amount`, `Open balance` |
| General Ledger | Reports → General Ledger for the history you want kept, grouped by account | `Date`, `Transaction Type`, `Num`, `Name`, `Memo/Description`, `Split`, `Amount` |

Account types map as: Bank → asset (bank); Accounts receivable (A/R) → asset (receivable control); Other Current Assets, Fixed Assets, Other Assets → asset; Accounts payable (A/P) → liability (payable control); Credit Card, Other Current Liabilities, Long Term Liabilities → liability; Equity → equity (detail type Retained Earnings → retained earnings); Other Current Liabilities with detail type Sales Tax Payable → sales tax liability; Income, Other Income → income; Cost of Goods Sold, Expenses, Other Expense → expense. Any other type is refused with its row. Accounts without a number get one in their type's range.

For each Bank account on the trial balance, enter its bank, last four digits and **reconciled statement balance at cutover**; it must equal the trial balance. If it does not (outstanding cheques or deposits at cutover), clear or choose a cutover date where book and statement agree; outstanding items at cutover are not imported in this release.

The synthetic files in [`fixtures/quickbooks-online`](fixtures/quickbooks-online) are written in this layout.

## Xero

The Xero kit takes six of Xero's standard exports at a cutover date. Lists are Xero's CSV exports; reports are exported to Excel and the sheet saved as CSV, values unchanged. Header names are read without case or the `*` Xero marks required columns with; columns Pantry does not read are ignored. Dates are read as MM/DD/YYYY (a US organisation's exports), YYYY-MM-DD or `31 Aug 2026`.

| File | Xero export | What Pantry reads |
| --- | --- | --- |
| Chart of accounts | Accounting → Chart of accounts → Export (CSV) | `*Code`, `*Name`, `*Type`, `Description` |
| Contacts | Contacts → All contacts → Export (CSV) | `*ContactName`, `EmailAddress` |
| Trial Balance | Reports → Trial Balance, as at the cutover date | title row `As at 31 August 2026` (or `As of August 31, 2026`); `Account` as `Name (code)` (or an `Account Code` column), `Debit`, `Credit`; group headings, `Total …` rows and `YTD` columns are skipped |
| Sales invoices | Sales → Invoices → All → Export (CSV), one row per line item | `*ContactName`, `*InvoiceNumber`, `*InvoiceDate`, `*DueDate`, `Total`, `InvoiceAmountDue`, `Type`, `Status` |
| Bills | Purchases → Bills → All → Export (CSV), one row per line item | as sales invoices; a bill with no number is told apart by supplier, date and total |
| Account Transactions | Reports → Account Transactions, bank accounts, period ending on the cutover date | title row `For the period … to 31 August 2026`; per account heading `Name (code)`: `Opening Balance`, lines (`Date`, `Source`, `Description`, `Reference`, `Debit`, `Credit`), `Closing Balance` |

Account types map as: Bank → asset (bank); Accounts Receivable → asset (receivable control); Current Asset, Fixed Asset, Non-current Asset, Inventory, Prepayment → asset; Accounts Payable → liability (payable control); Current Liability, Liability, Non-current Liability, Credit Card, Wages Payable, Unpaid Expense Claims, Historical Adjustment, Rounding, Tracking Transfers → liability; Sales Tax → sales tax liability; Equity → equity; Retained Earnings → retained earnings; Revenue, Sales, Other Income → income; Expense, Direct Costs, Overhead, Depreciation → expense. Xero's system accounts keep their roles when an export shows only their broad type and they keep their default names (Accounts Receivable as Current Asset, Accounts Payable as Current Liability, Retained Earnings as Equity, Sales Tax as Current Liability). Any other type is refused with its row.

An invoice or bill comes in when its status is Awaiting Payment (`AUTHORISED`), its amount due is above zero and it is dated on or before the cutover date, at its amount due; its lines must agree on the document's contact, dates, total, amount due, type and status. The rest are counted under **What will not come in, and why**: paid, draft or awaiting approval, voided or deleted, dated after the cutover date, and credit notes. A credit note with credit left at cutover is refused, because credits are not brought in as open items. A contact is a customer, a vendor or both by the invoices and bills that name it, as Xero decides; contacts on neither are counted and left out. Bank lines are kept read-only as history, and a tie-out per bank account on the trial balance checks that its opening balance plus its lines reaches the trial balance (and the closing balance) with the report running to the cutover date.

Xero's exports show each invoice's amount due when exported. An invoice paid after the cutover date shows as paid, so receivables fall short of the trial balance and the import stops: export on the cutover date, or choose a later one.

### Attachments from Xero

Xero's CSV and report exports carry no attachments, so the Xero kit carries them over Xero's documented Accounting API once the import is staged (`xero-api.ts`, `xero-attachments.ts`):

1. **Connect** (bookkeeper or above): OAuth 2.0 authorization code flow with the installation's own Xero app, scopes `openid profile email offline_access accounting.invoices.read accounting.attachments.read`. These are Xero's granular read-only scopes; apps created since March 2026 have no broad `accounting.transactions`. The callback `/api/pantry/xero/callback` checks the state against the person who started it (15 minutes), exchanges the code at `identity.xero.com/connect/token`, and keeps the one organisation whose `authEventId` matches the access token's `authentication_event_id` (`GET api.xero.com/connections`). Tokens are sealed with the session secret, and the rotating refresh token is saved on each refresh.
2. **Carry** in batches of at most 40 Xero calls (Worker subrequests; Xero allows 60 a minute). Each imported invoice and bill is found by `GET /Invoices?InvoiceNumbers=…` (type `ACCREC` or `ACCPAY`, and the supplier for bills). Each one with `HasAttachments` is listed with `GET /Invoices/{InvoiceID}/Attachments`. Each file is fetched with `GET /Invoices/{InvoiceID}/Attachments/{AttachmentID}` (`Accept` its MIME type) and kept byte for byte with its SHA-256 as a document linked to the imported invoice or bill. A file over 1.5 MB, Pantry's document limit, is listed and not fetched. An HTTP 429 answers with Xero's `Retry-After`, and the page waits and continues.
3. **Undo** of the import deletes the carried documents with it. **Disconnect** deletes the tenant connection and revokes the refresh token.

A self-hosted installation sets `XERO_CLIENT_ID` and `XERO_CLIENT_SECRET` from a Xero Web app whose redirect URI is `<origin>/api/pantry/xero/callback`. RER Managed has no egress relay for integrations yet, so there the page and every call say carrying attachments is not available yet. Without the keys, the page says which keys to set.

The synthetic files in [`fixtures/xero`](fixtures/xero) are written in these layouts, and [`fixtures/xero-api`](fixtures/xero-api) holds Xero API responses in the shapes Xero's OpenAPI description documents.

## What happens (both kits)

1. **Preview (dry run).** Counts per dataset, every refused row with its file, row and reason, the tie-outs, and the missing-documents note. Nothing is written. The preview has a fingerprint covering the files, the bank details and the mapping.
2. **Import as staged records** (bookkeeper or above). Allowed only when every tie-out matches, no row is refused, the books are empty and the fingerprint is the one previewed. Writes accounts, customers and vendors, bank accounts, opening invoices and bills (their open balance, original amount in the memo), the opening entry as a **draft**, and the history archive. Opening items post nothing: they are the detail behind the trial balance's control balances, so nothing is counted twice.
3. **Undo** (post grant). Removes everything the import wrote, while nothing has been posted or edited. Records entered afterwards that use imported accounts or contacts block undo.
4. **Accountant sign-off** (post grant). Re-checks that open invoices still equal opening receivables, unpaid bills equal payables and each bank's opening statement balance equals its opening book balance, records the approval of that exact cutover version, and posts the opening entry. From then on, corrections are reversing or adjusting entries; undo is refused.

Keep the old system and its full archive available until a real close in Pantry is accepted by the accountant. The QuickBooks Online kit does not read QBO's separate attachments .zip: upload the source documents for open items in Documents.
