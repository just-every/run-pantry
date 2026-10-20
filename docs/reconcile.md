Your bank statement is the bank's record. Reconciling proves that your books agree with it, line by line, before you close the month.

## Import the statement

1. Download the statement from your bank as OFX (also called Web Connect or QFX) or CSV.
2. In **Bank**, under **Import a statement**, choose the bank account and the file.
3. For a CSV file, enter the opening and closing balances printed on the statement, its start and end dates, and the account's last four digits, because a CSV file does not name the account. An OFX file carries its own account and closing balance.
4. Choose **Import statement**.

Importing the same file again adds nothing, and an overlapping download adds only the lines Pantry does not already have. Statement lines never post anything by themselves.

## Match each line

Choose **Reconcile** beside the statement. Pantry shows **Statement lines** beside **Ledger postings**, with the statement's balances and the **Difference** above them.

1. Select one or more statement lines and the postings they correspond to.
2. If the books are missing something, such as a bank fee, interest, a transfer between your accounts, a customer receipt or a vendor payment, add it in **Match review** with **+ Expense or fee**, **+ Bank income**, **+ Transfer**, **+ Customer payment** or **+ Vendor payment**. An expense is titled with the account you file it to, for example "Software and subscriptions — ADOBE *CREATIVE CLD".
3. When the statement and ledger totals agree, choose **Approve match**.

A payment you already recorded is cleared by its bank line without being posted twice. A line or posting is matched only once.

## Finish the reconciliation

**Finish reconciliation** stays unavailable until every line is matched and the ledger's bank balance, less items not yet on a statement, equals the closing balance. Until then **Before you can finish** lists each remaining difference. Once finished, the reconciliation keeps its proof and its matches are frozen.

If you typed a balance from the statement wrongly, correct it with a reason before you finish.

## When your agent proposes a match

Lines your agent has matched show **Proposed by agent**. Review the proposal under the tables and choose **Approve match** or **Reject**. Approving re-checks every line and posting it used. See [Agent work](/docs/agent-work).

## Reconcile a connected account

Under **Bank → Statements → Reconcile existing feed lines**, choose the connected account and enter the dates and balances printed on the bank statement. Existing categories and matches stay in place; no transactions are invented or uploaded again. The typed-only evidence is clearly labelled as a local record of your entries.

Where the institution supports Plaid Statements, enter the period dates and choose **Enable statement PDFs through Plaid** to authorize Statements on the existing connection (your Plaid agreement's fees apply). Then choose **Find Plaid statement PDFs** for statements already extracted, select the month, and enter the dates and balances from that PDF. Plaid returns PDF bytes rather than parsed balances. Pantry stores the original PDF with its SHA-256 and links it from the reconciliation's **Statement evidence** card. A failed download or checksum mismatch creates no statement.

The bank's current balance shows its provider as-of time and Pantry's observation time. An undated balance is labelled as such. Only a provider-stated date equal to statement end can block completion when its balance disagrees (card debt is negative in the proof). Earlier or later balances are context, never substitutes for the printed balance. All ordinary proof rules and locked-period protections still apply.
