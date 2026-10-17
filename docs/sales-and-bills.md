**Sales & bills** keeps your invoices, credits, bills, payments, customers and vendors. Every amount you enter posts to the same ledger your reports read.

## Invoices

1. Choose **Create invoice**, pick the customer and the issue date, and add lines with a description, quantity, rate and income account.
2. Give every line a sales tax code or mark it exempt. Pantry never assumes a zero rate: a line without a tax decision stops approval until someone decides.
3. Someone other than the preparer, holding the post grant, chooses **Approve**. Approval covers that exact version; if anyone edits the invoice afterwards, it returns to draft and its editor becomes the preparer, so they cannot approve their own change.
4. Choose **Issue**. Pantry posts the receivable, the income and any sales tax.

An issued invoice never changes. To correct one, choose **Issue a credit**, which is approved and issued the same way and reduces what the customer owes.

## Send it, and Pantry follows up

Open an issued invoice and choose **Send invoice**. Pantry emails it to the customer's address (or the addresses you type) with the PDF attached and a link to the invoice's own page, where the customer can read it, download the PDF and pay. The panel shows when it was **sent** and when the customer first **viewed** it; opening the link yourself while signed in does not count.

Reminders follow the schedule in **People & settings → Sending invoices and reminders**, for example 3 days before the due date, on the due date and 7 days after (`-3, 0, 7`). Each step goes once, at most one a day, and they stop as soon as the invoice is paid. Pause them for one invoice from its panel. Every invoice and reminder Pantry sends is listed under **Deliveries** with the mail provider's answer; "accepted" means the provider took the message, not that the customer read it.

Pantry on your own computer sends no email. Once it is [online](/docs/hosting) with a mail provider account of your own ([Connections and keys](/docs/connections#mail)), invoices and reminders are emailed.

## Recurring invoices

Under **Recurring**, choose **New recurring invoice**: the customer, how often (weekly, every two weeks, monthly, every three months or yearly), the first date, an optional last date and the lines. The next date is shown on the list.

Each invoice is either **created as a draft**, which is approved like any invoice, or **issued and emailed automatically**. Automatic sending starts only after someone other than the preparer, holding the post grant, approves the recurring invoice; any edit sends it back for approval. If a tax rate changes so an invoice no longer matches the approved amounts, that invoice waits as a draft instead. Pantry creates each occurrence once, whether it runs from its schedule or while people use the app, and lists every run with any reason it failed.

## Payments that match themselves

When you import a bank statement, a deposit for exactly an open invoice's amount that names the invoice number, or the customer's **bank statement reference** (set on the customer, for example `CEDAR STUDIO LLC`), is recorded as the customer's payment and matched to the line. It shows as **Matched automatically** on the reconciliation screen with an **Undo**, which removes the payment and reopens the invoice. A deposit that fits more than one invoice, or names neither, is left for you, with the reason beside the line.

## Customers pay by card or ACH

Connect your own Stripe account in **People & settings → Online payments (Stripe)** by pasting its secret key. Pantry checks the key, adds a webhook when your install is reachable from the internet, and adds two accounts to your chart: **Stripe balance** and **Stripe fees**. The invoice page then offers **Pay by card** and, for a US Stripe account, **Pay by bank account (ACH)**. Customers pay on Stripe's own page; card and bank details never reach Pantry. Pantry records the payment against the invoice in Stripe balance and books Stripe's fee. An ACH payment shows as processing for a few business days and counts as paid when it clears.

On RER Managed installs online payment is not available yet: they cannot reach Stripe until RER adds a relay, and the invoice page says so.

## Bills

Record a vendor's bill with its reference, date and lines, and post it to payables. Attach the receipt or vendor invoice under **Attach source document**; it is kept exactly as uploaded. A posted bill without a document stays on the close checklist until a document is attached, or until someone with the post grant records why there is none.

## Payments

Pantry records payments; it never moves money itself. Payments made through the invoice link are recorded for you. Record any other payment received or made, choose the bank account, and allocate it to one or more open invoices or bills, wholly or in part. Money not yet applied stays visible as a credit. Reversing a payment reopens what it paid.

## Locked months

Invoices, credits, bills and payments dated in a locked month are refused, drafts included. Date the work in an open month, or ask for the month to be reopened as described in [Close the month](/docs/close).
