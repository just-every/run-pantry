# Changelog

## Unreleased

- **Updating from v0.1.0**: books with matched bank lines (every reconciled statement) now update. Migration `0018_bank_rules_feeds.sql` failed with `FOREIGN KEY constraint failed` on them, on your own computer and hosted, and the update stopped there; it now sets matched lines aside while it rebuilds the bank lines table and puts them back. Hosted copies that already applied the earlier 0018 keep deploying (the rewrite is declared in `migrations/rewrites.json`). A hosted update that already stopped at 0018 needs its unfinished step cleared once ([Hosting](/docs/hosting#keep-it-current)). A release check now upgrades a book made on the previous release tag and compares it, on release tags and nightly (`pnpm run verify:release`).
- **Put Pantry online** (People & settings, on your own computer) never fills the deploy file with a placeholder owner such as `owner@run-pantry.test`. While you sign in with one, the card asks for your own email and shows the deploy lines with it, so the hosted Pantry's sign-in email reaches you. It also says to stop Pantry (`rer dev --stop`) before `rer deploy`.
- **Reports**: drilling into a P&L figure shows the bank statement line behind an expense filed from the bank by a rule or by hand, marked reconciled or matched, instead of "Not matched".
- **People**: Add person also records the person's sign-in invitation (emailed when Pantry is hosted), so they can sign in straight away; on your own computer, Sign in as and `rer dev --as their@email` work for them at once.
- **Payments**: the payment form says to add a bank account in Bank first when there is none, and fills in the open bill or invoice the amount pays, so recording a vendor payment marks the bill paid in one step.
- **Bank**: a line to file opens for filing when you click it or its **File it** button, not only through its checkbox, and Match review comes into view.
- **Customer invoice page**: without online payment it tells the customer how to pay, rather than how the business is set up.
- **Hosting and backup docs**: stop Pantry before deploying; take-down shows the hosted backup command and `--environment`; `rer export` saves only local books. The hosted backup file is now readable only by you.
- Pinned `@runeditrun/rer` 0.2.43.
