**Close** brings the month to an end: a checklist calculated from the books, review tasks done by named people, and a lock that stops every change dated in the month.

## The checklist

Pantry calculates each check from your books; nobody ticks them by hand.

- **Bank accounts reconciled** through the month end.
- **No unposted drafts** dated in the month.
- **Bills have source documents**, or a recorded reason.
- **Receivables and payables agree to control accounts.**
- **Trial balance balances.**
- **No agent proposals waiting.**
- **Pantry's questions answered**: every question Pantry asked about the month is answered, or settled by the books (see [Questions from Pantry](/docs/questions)).

A check that fails shows **Not yet** with a link to the screen where you fix it.

## Receipts

Every entry keeps its receipt. The **Receipts** card lists each expense paid from a bank account in the month that has no receipt, and each bill without a document. Choose **Photo** or **File** on its row to add the receipt right there, or, with the post grant, **No receipt needed** and say why (a bank fee shown on the statement, say). See [Receipts](/docs/receipts).

## Pantry's questions

The **Pantry's questions** card is the month's questions as one thread: the next open one to answer right there, then every other one with its answer, or why it is still open (emailed with no answer yet, or your answer waits for your yes).

## Review tasks

Choose **Add the standard review tasks** to add reviewing the trial balance, the receivables and payables aging and the adjusting entries, or add your own. Each person marks their task with **Mark done**, and Pantry records who did it and when.

## Lock the month

When every check has passed and every task is done, someone with the lock grant chooses **Lock** for the month. From then on drafts, postings, invoices, bills, payments, matches and agent proposals dated in that month are refused, for people and agents alike.

## Reopen a month

If a locked month must change, choose **Request reopening** and say why. Someone else with the reopen grant chooses **Approve reopening** or **Decline**. Every lock and reopening appears under **Approval history**.

## Hand over the month

Once the month is locked, choose **Download the accountant package** on **Close**, or **Accountant package** in **Reports**, which offers the last locked month until you choose other dates. It is a ZIP your accountant opens in any spreadsheet program: the trial balance, profit and loss for the month and the year to date, the balance sheet, the general ledger, both agings, the reconciliations, the close checklist and an index of documents, each as a CSV, with a README saying what is where. `pantry-package.json` inside holds the same package, with approvals, reversals, notes and each reconciliation's proof, for software. **General ledger CSV** downloads the ledger alone.
