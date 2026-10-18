**Reports** reads one set of books in several ways: the trial balance, general ledger, profit and loss, balance sheet, cash flow, receivables and payables aging, sales tax by state and 1099 contractors. Every report is calculated from posted lines when you open it; nothing is typed in as a total.

## Every figure opens to its records

On the **Profit and loss** and the **Balance sheet**, choose any account line or total. Pantry lists the lines behind it: the date, the invoice, bill, payment or journal entry it came from, the documents attached, and the bank statement lines it was matched to. The list adds up to the figure, and the page says so. Choose a record to open it with its lines, journal entry, payments, documents and statement lines, and use the trail at the top to go back to the figure or the report. The address of each step can be bookmarked or sent to your accountant.

## Cash or accrual, one switch

Pantry keeps accrual books. The **Cash** and **Accrual** switch on the trial balance, general ledger, profit and loss, balance sheet and sales tax report changes only how the books are read; the ledger never changes. Reports open on the tax method declared in the business settings.

On the cash basis:

- an invoice counts as income when it is paid, and a bill counts as an expense when it is paid;
- a partial payment counts in proportion across the document's lines, tax included, so a fully paid invoice always counts exactly its lines;
- a credit applied to an invoice settles that share of both, and a reversed payment takes its share back out on the reversal date;
- unpaid invoices and bills, and the sales tax on them, stay off the balance sheet. Money received or paid but not yet applied stays in receivables or payables;
- payments, bank items, journal entries and opening balances read the same on both bases. Receivables and payables moved in open from another system stay at their opening value.

The cash profit and loss ends with a bridge from accrual net income to cash net income. Every report, the general ledger CSV (a **Basis** column, and `-cash` in the file name) and the accountant package name their basis.

### A worked example

October 2026 for a New York design studio:

| Record | Amount |
| --- | --- |
| INV-0001, Oct 5: website design $600.00 taxed at 8.875% ($53.25), brand workshop $400.00 exempt | $1,053.25 |
| Payment on INV-0001, Oct 20 | $500.00 |
| INV-0002, Oct 10: retainer, exempt, paid Nov 5 | $2,000.00 |
| Bill BL-1042, Oct 2: software, paid by check Oct 15 | $640.00 |
| Bill R-1026, Oct 1: rent, unpaid | $1,300.00 |
| Bank fee journal, Oct 31 | $12.00 |

**Accrual, October:** income $600.00 + $2,000.00 (service) + $400.00 (workshop) = $3,000.00; expenses $1,300.00 + $640.00 + $12.00 = $1,952.00; net income **$1,048.00**.

**Cash, October:** the $500.00 payment covers 500.00 / 1,053.25 of INV-0001. Each line's exact share is design 600.00 × 500 / 1,053.25 = 284.8326, tax 53.25 × 500 / 1,053.25 = 25.2789 and workshop 400.00 × 500 / 1,053.25 = 189.8885. Rounded down they are 284.83, 25.27 and 189.88, which leaves 2 cents; they go to the largest remainders (tax .89, workshop .85), giving **$284.83 design, $25.28 tax and $189.89 workshop**, exactly $500.00. INV-0002 and the rent are unpaid and drop out. Income $284.83 + $189.89 = $474.72; expenses $640.00 + $12.00 = $652.00; net income **−$177.28**.

The bridge: accrual $1,048.00 − invoices and bills recorded in October ($3,000.00 − $1,940.00 = $1,060.00) + their shares paid in October ($474.72 − $640.00 = −$165.28) = **−$177.28**.

The balance sheet at October 31: on the accrual basis receivables are $2,553.25, payables $1,300.00 and sales tax $53.25; on the cash basis receivables and payables are $0.00 and sales tax is $25.28, with $9,848.00 in the bank either way. November's cash report counts the rest of INV-0001 when its $553.25 arrives (design $315.17, tax $27.97, workshop $210.11, so each line totals exactly its invoice amount) and INV-0002 in full.

## Sales tax by state

**Sales tax by state** lists, for the dates you choose, each state and each tax code in it with taxable sales, tax charged on invoices (less credits), tax collected from customers in the period and tax owed. On the accrual basis tax is owed when an invoice is issued; on the cash basis when the customer pays. Exempt sales are shown on their own line. The report ties to the ledger: for each sales tax liability account it shows the opening balance, the tax from invoices and credits (which must equal the tax owed above), payments to the state and other entries, and the closing balance.

Each tax code belongs to a state, set when you add it under **Books › Sales tax**; codes made before this report start in the business's own state and can be moved. Pantry uses the rates you enter and files no returns.

## 1099 contractors

Mark a vendor you pay for services as a **1099 contractor** and keep its W-9 details: legal name, TIN and address. The TIN is shown only as its last four digits everywhere in Pantry.

For each calendar year Pantry totals what you paid each contractor:

- **Box 1** counts check, ACH, wire and cash payments;
- card and payment-network payments (such as PayPal) are left out, because the processor reports them on Form 1099-K;
- reversed payments are left out;
- a payment whose method was never recorded is shown apart until you set it; record the method when you record a payment.

A contractor at or over the year's threshold is flagged as the year goes on. The threshold is $600 for payments made in 2025 and earlier, and $2,000 for payments made in 2026 (raised by the One Big Beautiful Bill Act); the IRS adjusts it for inflation from 2027. Vendors not marked as contractors who were paid that much by check, ACH, wire or cash are listed so you can decide.

After December 31, **1099-NEC forms** lists each form's recipient, box 1 and box 4 ($0.00: Pantry records no backup withholding), and the owner or someone with the posting grant downloads a filing CSV with the full TINs. Every download is in the activity log. **Pantry does not file with the IRS**: file the CSV through the IRS or a filing service by January 31. Whether a vendor needs a 1099 at all is your and your accountant's call.

## Statement of cash flows

Choose **Cash flow** on Reports and set any From and To dates. The indirect statement starts from accrual net income, adjusts for changes in working capital and noncash activity, then shows investing and financing. Its net change equals closing cash less opening cash on the balance sheet. Opening cash is the day before From. Transfers between cash accounts have no net effect; entries with no net cash are excluded from investing and financing and shown as noncash adjustments where needed.

Cash defaults to asset accounts with the bank role; other assets default to investing, equity and other liabilities to financing, and the remaining accounts to operating. Under **Cash-flow account classes**, an accountant or another person allowed to record can change those classes, including identifying cash equivalents. Classes apply to all periods; income and expenses always start in net income, with classified cash activity moved to its chosen section.

Choose any amount, including a section total, net change or cash balance, to see its contributing ledger entries. Open an entry to see its accounts and linked evidence. **Cash-flow CSV** exports the selected range; the monthly accountant package also includes the statement in JSON and as `cash-flow.csv`. The statement uses the indirect method regardless of the basis selected for other reports.
