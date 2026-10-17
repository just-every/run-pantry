Pantry's move-in kits bring your books across from QuickBooks Online or Xero at a cutover date: the chart of accounts, customers and vendors, an accountant-approved trial balance, the open invoices and unpaid bills behind it, and a read-only history. From Xero, the files attached to those open invoices and bills come too. Zoho Books is not supported yet.

Open **Move in from QuickBooks or Xero** under **More** and choose your old system.

## From QuickBooks Online: seven reports

In QuickBooks Online, run each report for the cutover date, export it, and save each sheet as CSV without changing its values:

1. Account List
2. Customer Contact List
3. Vendor Contact List
4. Trial Balance, as of the cutover date
5. Open Invoices, as of the cutover date, grouped by customer
6. Unpaid Bills, as of the cutover date, grouped by vendor
7. General Ledger, for the history you want kept, grouped by account

## From Xero: six exports

Export these from Xero on the cutover date, before you record anything dated later. Lists export as CSV; reports export to Excel, and you save the sheet as CSV without changing its values.

1. **Chart of accounts**: Accounting → Chart of accounts → Export.
2. **Contacts**: Contacts → All contacts → Export.
3. **Trial Balance**: Reports → Trial Balance, as at the cutover date.
4. **Sales invoices**: Sales → Invoices → All → Export.
5. **Bills**: Purchases → Bills → All → Export.
6. **Account Transactions**: Reports → Account Transactions, with your bank accounts selected, from the start of the month to the cutover date.

Pantry brings in the invoices and bills that were awaiting payment on the cutover date, at the amount still due. The others stay in Xero, and the preview counts each kind and says why: paid, draft, voided, dated after the cutover date, or a credit note already used. A contact becomes a customer or a vendor in Pantry the way Xero decides: by the invoices and bills that name it. A contact on neither is listed, so you can add it when you need it. The bank lines come in as read-only history. Pantry checks that each bank account's opening balance plus its lines reaches the trial balance.

## Bank balances

For each bank account on the trial balance you also need its bank, its last four digits and its reconciled statement balance at the cutover date, which must equal the trial balance.

## Preview first

Add the files and the bank details and choose **Preview (dry run)**. Nothing is written. The preview shows:

- how many accounts, contacts and open items come across;
- every refused row, with its file, row and reason;
- the **Tie-outs**: the trial balance balances, open invoices equal receivables, unpaid bills equal payables, each bank balance equals its statement, and there is one control account of each kind;
- **What will not come in, and why**.

If receivables differ from Xero's trial balance, an invoice was probably paid after the cutover date: Xero's export shows it as paid. Export again before recording later payments, or choose a later cutover date.

## Import as staged records

When every tie-out shows **All match** and no row is refused, choose **Import as staged records**. Pantry needs empty books for this.

The import writes the accounts, contacts, bank accounts, open items and the opening balances as a draft entry, and keeps the history read-only. Nothing posts yet. The page keeps what came in and what did not.

While nothing has been posted or edited, someone with the post grant can choose **Undo import** to remove all of it, attachments included.

## Attachments from Xero

Xero's exports carry no files, so after a Xero import the page offers **Connect Xero**.

1. Xero asks you to choose the organization you moved from. Pantry asks only to read invoices and their attachments.
2. Choose **Carry attachments over**. Pantry finds each imported invoice and bill in Xero by its number (and vendor, for bills) and keeps each attached file byte for byte as a document on that record.
3. The table lists every file and whether it was kept. A file over Pantry's 1.5 MB limit for one document is listed and not carried; keep it from Xero. A record Xero cannot find by its number is listed too.
4. Choose **Disconnect Xero** when you are done. This ends Pantry's access at Xero.

Attachments on paid or voided documents stay in Xero, because those documents do not come in.

Carrying attachments needs the installation's own Xero app:

1. At developer.xero.com, create a Web app.
2. Set its redirect URI to `https://<your Pantry address>/api/pantry/xero/callback`, or `http://localhost:<port>/api/pantry/xero/callback` on your own computer.
3. Give Pantry its client id and secret as `XERO_CLIENT_ID` and `XERO_CLIENT_SECRET`.

On RER Managed, carrying attachments over from Xero is not available yet: a managed installation cannot reach Xero until RER adds a provider relay, and the page says so. Upload the files in **Documents** instead.

QuickBooks Online exports attachments in a separate download that this kit does not read: upload the source documents for your open items in **Documents**.

## Accountant sign-off

Sign-off is by someone with the post grant who did not run the import, or by the owner. They choose **Accountant sign-off**. Pantry re-checks the tie-outs, records the approval and posts the opening balances, so Pantry's trial balance at the cutover date is the old system's, account by account. From then on, corrections are entries, never undo.

Keep your old system and its archive until your accountant accepts your first close in Pantry.
