Connect the Stripe account customers pay you through and the Gusto company you run payroll in, and Pantry books what they move by itself: each Stripe payout split into sales, fees and refunds, and each Gusto payroll as one balanced entry. Both are matched to the bank line that shows the money when it arrives.

## Stripe payouts

Stripe pays out the money it collected less its fees and any refunds. Pantry books the whole of it, not just the deposit.

1. Connect Stripe under **People & settings → Online payments (Stripe)** by pasting your Stripe secret key (the same connection invoices use for card and ACH payment).
2. Under **Stripe payouts**, choose the bank account Stripe pays out to, the income account for sales, and the first arrival date to book. Choose **Book Stripe payouts**.

Pantry reads each paid payout with the charges, refunds and fees inside it and posts one entry on its arrival date: the deposit to your bank account, Stripe's fees to **Stripe fees**, refunds and lost disputes to **Refunds and disputes**, and gross sales to the income account you chose. A charge that paid one of your invoices from its link is already in the books, so its money comes out of **Stripe balance** instead of being booked as a second sale. When the deposit's bank line arrives, from a feed or a statement file, Pantry matches it, marked **Matched automatically** with an undo.

Payouts are read again every few hours and when you choose **Read payouts now**; a payout is booked once however often it is read. Pantry leaves a payout for you, with the reason, when Stripe does not itemize it (a manual payout) or it holds something Pantry does not book by itself. Pantry keeps US-dollar books, so a Stripe account that pays out in another currency shows its payouts split but books none.

## Gusto payroll

1. Under **People & settings → Payroll (Gusto)**, choose **Connect Gusto**, sign in to Gusto as a company admin and choose the company.
2. Back in Pantry, choose the bank account Gusto debits (it is chosen for you when you have one) and the first check date to post.

Each processed payroll posts as one balanced entry on its check date: gross wages to **Wages and salaries**, the employer's taxes to **Payroll taxes**, company benefit contributions and reimbursements to their expense accounts; out of the bank, Gusto's net pay debit and its tax debit (the taxes withheld from employees and the employer's taxes, each on its own line); and what you still owe others (paper checks, benefit and other deductions) to **Payroll liabilities**. Pantry matches the entry to Gusto's debits when they arrive, whether Gusto took them as one debit or one per kind. A payroll whose totals do not add up waits for you with the difference named. Payrolls entered in Gusto only for its records (external payrolls) are not posted.

Gusto uses this installation's own Gusto app. Set `GUSTO_CLIENT_ID` and `GUSTO_CLIENT_SECRET` (and `GUSTO_ENV=production` once Gusto approves the app; `demo` is the default) as deploy secrets, or in `.dev.vars` locally, and add the redirect address the card shows to the app in Gusto's developer portal.

## On RER Managed

RER Managed installations cannot reach Stripe or Gusto until RER adds a relay for provider connections, and both cards say so in one line. A self-hosted Pantry connects them today.
