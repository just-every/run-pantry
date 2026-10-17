# Changelog

## Unreleased

- **Online invoice payment works on a new Stripe account**: a Stripe account opened now starts on Stripe's newest API version, which refused Pantry's Checkout with "The `payment_method_types` parameter is no longer supported", so customers could not pay by card from the invoice link. Pantry now names the Stripe API version it is tested against (`2026-09-30.endive`) on every Stripe call and on the webhook it creates, and chooses card or ACH for a Checkout with `allowed_payment_method_types`. On a US account, ACH bank debit must also be turned on in Stripe's payment method settings for customers to use it.

## 0.2.0 (17 Oct 2026)

Pantry 0.2.0 takes a v0.1.0 book from statement files and recorded payments to connected bookkeeping. Bank and card lines can arrive on their own and routine ones file themselves; receipts are read and attached; invoices go out by email and are followed up; every report figure opens to what is behind it. A v0.1.0 owner keeps every entry, document, reconciliation, sign-in and locked month.

### What a v0.1.0 owner gets

- **Bank feeds and rules.** Connect banks and cards through Plaid with your own Plaid keys; transactions arrive when the bank tells Plaid there is news and every few hours besides, without duplicating lines you also import from a file. Bank rules (payee, description, amount, direction) preview what they would file, file routine lines marked "Filed by rule" with an undo, and never touch a locked month or a reconciled statement. A bank that needs re-linking says so at the top of Bank. Statement files work as before.
- **Receipts.** Take a photo, upload a file or forward the email to the Pantry address. Pantry keeps it byte for byte, reads the vendor, date, total, tax and category with your own AI key, and attaches it to the matching line, bill or payment when you accept. Without a key you type the details and attach it the same way.
- **Invoices out.** Send an invoice by email with its PDF and a customer page. Pantry records when it was sent and first opened, sends reminders on your schedule until it is paid, and repeats invoices from weekly to yearly. Invoice numbers and due dates are filled from the sequence and the customer's terms. A deposit that names the invoice and equals its amount matches itself. With your own Stripe account, customers pay by card from the link, and the payment and Stripe's fee are recorded; ACH bank debit is built for US Stripe accounts. Without online payment, the customer page tells the customer how to pay rather than how the business is set up.
- **Reports.** Every P&L and balance sheet figure opens to its postings, source records, documents and bank statement lines, marked reconciled or matched, including expenses filed from the bank by a rule or by hand. Every report runs on the cash or the accrual basis, with an accrual-to-cash bridge. Sales tax is reported by state and 1099 contractors by form and box; card and payment-network payments stay out of 1099-NEC totals.
- **Pantry's questions.** About hourly, Pantry checks for a deposit nothing explains, money out left unfiled or without its receipt, a payment made twice, or a bank balance the books cannot reach. It asks you each question once, by email first, and shows what each answer changes before anything moves. Close shows the month's questions, and the month locks only once they are answered.
- **Connected payouts and payroll.** Stripe payouts are split into sales, fees and refunds and matched to their bank deposit. Gusto payrolls post as one balanced entry, through your own Gusto developer app, and match their bank movement.
- **Move in from Xero** beside QuickBooks Online, with the attachments on open invoices and bills carried over Xero's API through your own Xero app.
- **Close and people.** The accountant package is a ZIP of CSVs with a README, on Close and Reports. Close also checks that payments are applied to their invoices and bills. Add person also sends the person's sign-in invitation (emailed when Pantry is hosted); on your own computer, Switch person → Sign in as and `rer dev --as their@email` work for them at once.
- **Everyday fixes.** "+ Expense or fee" files everyday charges from a bank line. A line to file opens for filing when you click it or its **File it** button, and Match review comes into view. The payment form fills in the open bill or invoice the amount pays, so recording a vendor payment marks the bill paid in one step, and it asks for a bank account in Bank first when there is none.
- **Running and hosting.** Pantry starts with one line, `npx -y @runeditrun/rer dev just-every/run-pantry`, or the `install.sh` installer for computers without Node. **People & settings → Put Pantry online** never fills the deploy lines with a placeholder owner such as `owner@pantry.test`: it asks for your own email, fills the lines with it, and says to stop Pantry (`rer dev --stop`) before `rer deploy`. A hosted Pantry chooses its mail provider (Resend or SendGrid) and sender in `.env.pantry`. `scripts/hosted-backup.mjs` saves the hosted database, receipts and documents included, to a file only you can read. Every key card (Plaid, Gusto, Stripe, AI, mail, receipt forwarding) can be completed from its page alone, behind its **Set up …** disclosure.
- Pinned `@runeditrun/rer` 0.2.43.

### Upgrading from 0.1.0

Nine new migrations, `0015_owner_signin` to `0023_connected`, apply in order on top of v0.1.0's `0001` to `0014`, which are unchanged. They add tables and columns. Three of them rebuild a table to widen it, copying every row: `0018` lets bank lines arrive without a statement, `0020` lets Pantry itself appear in the audit trail, and `0022` lets a move-in come from Xero. `0018` sets matched bank lines aside while it rebuilds and puts them back, so books with reconciled statements update. Nothing is removed. Migrations run once, forward only, so **back up first**.

**On your own computer**, in your `run-pantry` folder:

```sh
rer dev --stop
rer export --output exports/pantry-books-0.1.0.rer
git pull
rer dev
```

`rer dev` installs the new dependencies, including rer 0.2.43, and applies the new migrations before it opens Pantry.

**Hosted**, from the `run-pantry` folder you deploy from (with the same `.rer` folder and `.env.pantry`):

```sh
rer queue hosted-backup -- node scripts/hosted-backup.mjs --env-file .env.pantry
git pull
rer deploy --env-file .env.pantry
```

Add `--environment NAME` to both commands if you deployed with one. `rer deploy` applies the migrations to the hosted database and keeps your books and sign-ins. `rer export` saves only the books on this computer, so use the hosted backup command for a hosted Pantry.

- **If you set your mail provider in `deploy.json`** for v0.1.0 (its `MAIL_PROVIDER` and `MAIL_FROM` lines) and committed it, `git pull` stops with a conflict in `deploy.json`. Pantry now reads both from `.env.pantry` ([Hosting](/docs/hosting#3-write-the-deploy-file)): put `MAIL_PROVIDER=` and `MAIL_FROM=` there, keep the new `deploy.json`, and deploy:

  ```sh
  git checkout --theirs deploy.json
  git add deploy.json
  git commit --no-edit
  rer deploy --env-file .env.pantry
  ```

- **If an earlier update stopped at `0018_bank_rules_feeds.sql`** with `FOREIGN KEY constraint failed` (a hosted copy updated from main between v0.1.0 and this release), Cloudflare rolled that step back and your books are as they were, but the unfinished step is still recorded, so the next deploy says the database "holds migration history this build does not match". Clear that record once with your Cloudflare token from `.env.pantry`, then deploy:

  ```sh
  set -a; . ./.env.pantry; set +a
  npx wrangler d1 execute pantry-production-db --remote --command "DELETE FROM d1_migrations WHERE name='0018_bank_rules_feeds.sql' AND state='applying'"
  rer deploy --env-file .env.pantry
  ```

  With `--environment NAME`, the database is `pantry-NAME-db` and the deploy takes `--environment NAME` too. A hosted copy that applied the earlier `0018` without stopping needs nothing: `migrations/rewrites.json` declares the reviewed rewrite, and it keeps deploying.

After upgrading, features that use an outside account stay off until you add its key in **People & settings** or **Bank**: Plaid, Stripe, Gusto, Xero, an AI key or a mail provider. The books work without any of them. A release check (`pnpm run verify:release --from v0.1.0`) builds a v0.1.0 book with matched and reconciled lines, upgrades it and compares it; it runs on release tags and nightly.
