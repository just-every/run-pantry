Connect the Stripe account customers pay you through and the Gusto company you run payroll in, and Pantry books what they move by itself: Stripe charges, fees and refunds posted through clearing at their event dates, and each Gusto payroll as one balanced entry. Both are matched to the bank line that shows the money when it arrives.

## Stripe payouts

Stripe pays out the money it collected less its fees and any refunds. Pantry books the whole of it, not just the deposit.

1. Connect Stripe under **People & settings → Online payments (Stripe)** by pasting your Stripe secret key (the same connection invoices use for card and ACH payment).
2. Under **Stripe payouts**, choose the bank account Stripe pays out to, the income account for sales, and the activity start date. Choose **Book Stripe payouts**.

Pantry reads Stripe’s balance transactions independently of paid payouts. Each USD charge, refund, dispute or fee posts at its provider creation date (UTC), with its own provider ID. Invoice-link payments use their existing receipt and fee entries, so the charge is never also booked as sales. A payout moves money from **Stripe balance** to the receiving bank on its provider event date; the expected arrival date is used to match its bank deposit. The payout view retains its gross sales, fees and refund totals.

**Stripe clearing** on the dashboard, settings and close compares the current posted clearing ledger with Stripe’s reported USD available plus pending balance and names every missing, changed, unsupported, reversed or held provider item. The observation time is shown. An incomplete provider inventory cannot establish a tie. Re-reading is idempotent, and repairing a missing event clears its exception only when the actual ledger agrees; Pantry creates no unexplained balancing adjustment.

Prior payout entries stay immutable and their constituent provider IDs are associated with those entries before new recognition. Native invoice receipts are adopted once. The configured activity start date keeps otherwise-unowned earlier activity in a named historical review queue; use the accountant’s existing correction/opening-entry process to resolve a historical difference. Locked event dates remain held until an approved reopening permits their posting.

Payouts are read every few hours and when you choose **Read payouts now**. Manual, unsupported and non-USD movements remain named items for review. Pantry keeps USD books.

## Gusto payroll

1. Under **People & settings → Payroll (Gusto)**, choose **Connect Gusto**, sign in to Gusto as a company admin and choose the company.
2. Back in Pantry, choose the bank account Gusto debits (it is chosen for you when you have one) and the first check date to post.

Each processed payroll posts as one balanced entry on its check date: gross wages to **Wages and salaries**, the employer's taxes to **Payroll taxes**, company benefit contributions and reimbursements to their expense accounts; out of the bank, Gusto's net pay debit and its tax debit (the taxes withheld from employees and the employer's taxes, each on its own line); and what you still owe others (paper checks, benefit and other deductions) to **Payroll liabilities**. Pantry matches the entry to Gusto's debits when they arrive, whether Gusto took them as one debit or one per kind. A payroll whose totals do not add up waits for you with the difference named. Payrolls entered in Gusto only for its records (external payrolls) are not posted.

Gusto works through a Gusto developer app of your own, separate from your payroll account. Until it is set up, the **Payroll (Gusto)** card says so and shows the steps, with your Pantry's redirect address filled in; they are also in [Connections and keys](/docs/connections#payroll-gusto).

## On RER Managed

RER Managed installations cannot reach Stripe or Gusto until RER adds a relay for provider connections, and both cards say so in one line. A self-hosted Pantry connects them today.
