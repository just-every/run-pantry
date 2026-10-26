Pantry's move-in kits bring your books across from QuickBooks Online or Xero at a cutover date: the chart of accounts, customers and vendors, an accountant-approved trial balance, the open invoices and unpaid bills behind it, and a read-only history. From Xero, the files attached to those open invoices and bills come too. Zoho Books is not supported yet.

Open **Move in from QuickBooks or Xero** under **More** and choose your old system.

For your own CSV or Excel files, choose the **Spreadsheet** tab. This tested route brings in lists and an opening, without claiming support for another provider's export package or API.

## From spreadsheets: templates and mappings

Use one file per list, with unique, nonempty headers in the first row. Download **template** beside each list; templates are CSV, and uploads accept CSV or `.xlsx`.

| Template | Fields |
| --- | --- |
| Customers | `externalId`, `name`, `email`, `termsDays` |
| Vendors | `externalId`, `name`, `email`, `termsDays` |
| Items | `externalId`, `name`, `kind`, `sku`, `description`, `rate`, `account`, `taxDecision`, `taxCode` |
| Chart of accounts | `externalId`, `name`, `code`, `type`, `subtype`, `description` |
| Open invoices | `externalId`, `number`, `party`, `date`, `due`, `open`, `original`, `account`, `taxDecision` |
| Open bills | `externalId`, `number`, `party`, `date`, `due`, `open`, `original`, `account`, `taxDecision` |
| Opening trial balance | `account`, `debit`, `credit`, `className`, `locationName`, `projectName` |

Headers may use your own names. Open **Map … columns**, select a header for each field, then **Save … mapping**. Each list keeps its own editable mapping. Preview also saves the selected mappings. Optional fields may stay unmapped; a header cannot supply two fields. If a later file removes a saved header, map that field again.

Name each chart account, give it a code and choose `asset`, `liability`, `equity`, `income` or `expense`. Its role (`subtype`) is `other`, `bank`, `receivable`, `payable`, `tax` or `retained`. Account references can use a name or code. Items use `service` or `non-inventory`, an income account and a rate; choose `taxable` or `non-taxable` explicitly. A taxable item can name an active Pantry tax-code ID.

Open items name a customer or vendor and the appropriate receivable or payable account. Their positive open amount cannot exceed the original amount. Choose `included` for tax already included in that opening amount, or `non-taxable`; Pantry does not charge the tax again. Use ISO dates or US `MM/DD/YYYY`, and dollar amounts with at most two decimal places.

Opening dimension columns are optional unless the account requires them. Enable the dimensions and create their active values in Pantry first. Separate rows can give one account different class/location/project amounts; bank and control tie-outs still use that account's combined opening.

## Spreadsheet limits and refusals

The page reads the first worksheet of an `.xlsx`; the API can select a named sheet. Replace formulas with values before uploading. Formula and Excel error cells are refused, and password-protected workbooks, legacy `.xls`, macros and external worksheet relationships are unsupported.

The implemented limits are 2,000,000 bytes per file, 10,000 data rows and 100 columns. Expanded workbook contents are limited to 12,000,000 bytes and 2,000 ZIP entries. The combined command request, including encoded workbook bytes, must fit within 8 MB. These are import limits, not a measured scale guarantee.

Set **Spreadsheet cutover date**, add the files and bank details, then choose **Preview spreadsheets**. The dry run writes no imported records. **Every row** shows its source file, row, values and ready, update, unchanged or refused result, with paging and filters. Refusals name duplicate or conflicting identities, unknown accounts, missing tax decisions, invalid dates/amounts, inactive or required opening dimensions, or an unbalanced opening.

Lists can move on their own. Open invoices or bills also need their opening trial balance. **Spreadsheet tie-outs** must show **All match**: the opening balances, accepted invoices equal receivables, accepted bills equal payables, bank openings equal the entered reconciled statements, and the control-account roles agree. Correct refused rows or explicitly choose **Leave … refused rows out of this import**. Leaving them out never overrides a failed tie-out. Changing files, mappings or relevant native records requires a fresh preview.

## Stage, re-import, undo and accept spreadsheets

Choose **Import spreadsheet records as staged** with the record grant. Pantry retains the original bytes, mapping and reviewed plan, and stages the records and opening draft. If interrupted, **Continue spreadsheet import** resumes the stored job; it does not start a second import. Refused rows remain listed in the outcome. Importing open items does not post them again on top of the opening trial balance.

Before sign-off, re-import updates records matched by external ID, or by name without an ID, case-insensitively. A stable external ID permits a rename. Invoices match by number; bills by vendor and number. Conflicting identities are refused. A changed financial opening needs the same cutover date and its full open-item lists; a lists-only update does not replace the opening.

Someone with the post grant can **Undo import** before acceptance. Undo restores exact previous values for updated records and removes newly imported ones. Undo newer imports first; native edits, postings or dependent records can refuse undo. Saved header mappings remain. **Continue undo** resumes a partially completed undo.

The owner, or someone with the post grant other than the importer, chooses **Accountant sign-off** after pending work finishes. Pantry rechecks the tie-outs, records approval and posts the opening. Undo and spreadsheet re-import are then refused; use normal accounting corrections.

Spreadsheets do not bring provider history or original attachments. Upload supporting files in **Documents**, and keep the old system's archive through the first accepted close. Generic XLSX support does not establish a real QuickBooks, Xero, FreshBooks or other provider migration, or support for its attachment ZIP.

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

While nothing has been posted or edited, someone with the post grant can choose **Undo import** to remove staged records and attachments carried directly from Xero. Independently reviewed archive originals remain in Pantry and return to the placement queue when their transaction is removed.

## Attachments from Xero

Xero's exports carry no files, so after a Xero import the page offers **Connect Xero**.

1. Xero asks you to choose the organization you moved from. Pantry asks only to read invoices and their attachments.
2. Choose **Carry attachments over**. Pantry finds each imported invoice and bill in Xero by its number (and vendor, for bills) and keeps each attached file byte for byte as a document on that record.
3. The table lists every file and whether it was kept. A file over Pantry's 1.5 MB limit for one document is listed and not carried; keep it from Xero. A record Xero cannot find by its number is listed too.
4. Choose **Disconnect Xero** when you are done. This ends Pantry's access at Xero.

Attachments on paid or voided documents stay in Xero, because those documents do not come in.

Carrying attachments needs a Xero app of your own, made with your Xero login. Until it is set up, the **Attachments from Xero** card says so and shows the steps; they are also in [Connections and keys](/docs/connections#attachments-xero).

On RER Managed, carrying attachments over from Xero is not available yet: a managed installation cannot reach Xero until RER adds a provider relay, and the page says so. Upload the files in **Documents** instead.

Review a separate attachment download in **Document archive originals**. Files with exact moved source identities can be linked; the rest wait for owner placement.

## Accountant sign-off

Sign-off is by someone with the post grant who did not run the import, or by the owner. They choose **Accountant sign-off**. Pantry re-checks the tie-outs, records the approval and posts the opening balances, so Pantry's trial balance at the cutover date is the old system's, account by account. From then on, corrections are entries, never undo.

Keep your old system and its archive until your accountant accepts your first close in Pantry.


## Read a company from QuickBooks Online

On a self-hosted installation, the owner can use the advanced authenticated HTTP commands `move-in.qbo.connect` and `move-in.qbo.read` through the native command route. Set the installation’s own `QBO_CLIENT_ID` and `QBO_CLIENT_SECRET`; connect takes the authorized company ID, environment and Intuit refresh grant. Pantry verifies the selected company before permitting reads. The encrypted grant is excluded from book archives. `move-in.qbo.disconnect` forgets it; revoke the app in Intuit to invalidate authorization. A connection form, Pantry Connect and the browser OAuth callback remain unimplemented. The grant can permit writes, but these Pantry commands only read the company.

The reader pages through accounts, customers, vendors, invoices, bills and attachment inventory, and requests the accrual trial balance and general ledger. Its complete JSON snapshot enters `move-in.preview` as `files.apiSnapshot`, with a chosen history start, cutover date and independently reconciled bank details. The existing staged import, undo and sign-off apply. Current open balances must agree with the chosen trial balance; historical balances affected by later settlements are refused rather than guessed.

This remains a partial migration: history is reference data rather than replayed postings. Monthly comparisons, parallel-run detection, original downloads, reconciliation state, items, classes, locations, terms and tax-code replay are not implemented by this reader.

## Document archive originals

The owner can select a vendor ZIP or a JSON or CSV manifest with extracted originals. ZIPs support stored and deflated files, nested relative paths, and one embedded `manifest.json`, `attachments.json`, `documents.json` or CSV equivalent. Multiple embedded manifests require an explicit selection. Encrypted, corrupt or unsafe archives are refused. Each batch accepts at most 100 originals and 8 MB of original bytes.

A manifest can declare `provider`, `archiveKey` and `files`. Each file names its exact `path`, `sourceId` and optional `sourceSystem`, `transactionSourceId`, `kind` and `sha256`. Explicit QuickBooks attachment references and Xero invoice identities are also recognized. A path only locates bytes; filenames and party names never infer transaction links. Exact IDs are resolved against confirmed owner mappings and published moved history. Ambiguous and unknown identities stay visible for placement.

Preview the hashes and placement, then import the reviewed originals. The private journal preserves source IDs, original hashes, byte counts and mapping evidence. Owner placement can record the exact external source identity for subsequent archives. Originals are kept until owner deletion; undo detaches them from removed imported transactions. Restoring a book archive preserves these originals, mappings and the unplaced queue. Source-contact erasure retains original financial evidence until the owner confirms expiry. An original whose bytes were erased cannot be imported again under a new export identity.

## Export a closed year to another accounting system

Open **Export a closed year to another accounting system** under Move in. The owner or an accountant with unmasked access to all books can choose QuickBooks Online or Xero and a closed fiscal year. Review the manifest and download its ZIP. It includes provider CSV resources, native request templates, exact source records, posted history, trial balances, open balances and original documents with hashes. Source history needed for the closing balance is retained; draft entries are excluded.

The package names destination mappings and unsupported records explicitly. It sends nothing to either destination. Resolve every issue using actual destination accounts and IDs, use one import method for each resource, and compare the destination trial balance, open items and document hashes afterward. Generation of a package does not prove that either provider has accepted it.
