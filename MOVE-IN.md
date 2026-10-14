# Move in from QuickBooks Online

Pantry's first move-in kit takes a **cutover package** from QuickBooks Online (QBO): the chart, customers and vendors, an accountant-approved trial balance on the cutover date, the open invoices and unpaid bills behind its receivable and payable balances, and a general-ledger history kept read-only. It is built on Base's import kit (`src/modules/import-kit`): every upload is planned as a dry run, committed as one journaled import job with the exact uploaded bytes kept, and undone by the kit while nothing it wrote has changed.

QBO's export help (Settings → Export data) describes reports and lists exported as Excel files in one .zip, attachments exported as a separate .zip, and points to third-party apps for a full backup. Pantry therefore moves balances and open items, not transaction history: the history file is kept for reference only.

## The seven files

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

## What happens

1. **Preview (dry run).** Counts per dataset, every refused row with its file, row and reason, the tie-outs, and the missing-documents note. Nothing is written. The preview has a fingerprint covering the files, the bank details and the mapping.
2. **Import as staged records** (bookkeeper or above). Allowed only when every tie-out matches, no row is refused, the books are empty and the fingerprint is the one previewed. Writes accounts, customers and vendors, bank accounts, opening invoices and bills (their open balance, original amount in the memo), the opening entry as a **draft**, and the history archive. Opening items post nothing: they are the detail behind the trial balance's control balances, so nothing is counted twice.
3. **Undo** (post grant). Removes everything the import wrote, while nothing has been posted or edited. Records entered afterwards that use imported accounts or contacts block undo.
4. **Accountant sign-off** (post grant). Re-checks that open invoices still equal opening receivables, unpaid bills equal payables and each bank's opening statement balance equals its opening book balance, records the approval of that exact cutover version, and posts the opening entry. From then on, corrections are reversing or adjusting entries; undo is refused.

Keep QBO and its full archive available until a real close in Pantry is accepted by the accountant. This kit does not read QBO's separate attachments .zip: upload the source documents for open items in Documents.
