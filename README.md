# Pantry

Books and close for one US service business: a USD ledger kept by the owner, a bookkeeper and an outside accountant, fed by your bank, reconciled to statements, closed each month and handed over as an accountant package. Invoices send and follow up; payments match themselves; every report opens to the records behind it, on the cash or accrual basis. Your own agent can prepare matches, entries and close work; a person approves each one. MIT licensed: nothing to buy, no account to create.

Website and guides: [run-pantry.com](https://run-pantry.com) · [docs](https://run-pantry.com/docs) · [Run Pantry](https://run-pantry.com/run).

## Start Pantry on your computer

You need macOS, Linux or Windows with WSL2, and git. One line gets Pantry and starts it:

```sh
curl -fsSL https://runeditrun.com/install.sh | sh -s -- dev just-every/run-pantry
```

This brings its own Node; you do not need to install Node first. `rer` is the Run Edit Run command that installs, starts, backs up and restores Pantry. If you already have Node, you can instead run:

```sh
npx -y @runeditrun/rer dev just-every/run-pantry
```

It clones Pantry into a `run-pantry` folder, installs it (a few minutes the first time) and starts it in the background. When it is ready it prints:

- `RER_READY` with the address Pantry answers on, such as `http://127.0.0.1:8787`;
- `RER_OPEN` with a link that opens Pantry signed in as you, the owner. Open it in your browser on the same computer, and treat it like a password.

The first time, confirm the owner on **Finish setup**, and Pantry opens **Overview** with five setup steps: the business, the chart and opening balances, customers and vendors, your bank, and your first close ([Your first month](https://run-pantry.com/docs/first-month)).

Stop Pantry with `rer dev --stop`. To start it again, run `cd run-pantry && rer dev`. If the first start says it could not find a free port, run `cd run-pantry && rer dev` again.

## Working with others

Add your bookkeeper and accountant in **Settings → People and permissions**, with their role and grants ([People and roles](https://run-pantry.com/docs/people)). Pantry on your own computer sends no email: to work as another person here, add them (adding records their invitation), then **More → Sign out or switch person → Switch person** and **Sign in as** them, or run `rer dev --as their.email@example.com` ([Work as someone else on your own computer](https://run-pantry.com/docs/people#work-as-someone-else-on-your-own-computer)). To let them sign in from anywhere and to email invoices, [put Pantry online](https://run-pantry.com/docs/hosting) on your own Cloudflare account with `rer deploy`.

## Bank feeds, payroll, Xero and email

Each works through an account of your own with that provider (Plaid, Gusto, Xero, Resend or SendGrid). The card in Pantry says when one is not set up yet and shows where to get the keys and where to put them: [Connections and keys](https://run-pantry.com/docs/connections). Stripe and the AI receipt reader are set up inside Pantry, in **Settings**.

## Back up and restore

```sh
rer dev --stop
rer export --output exports/pantry-books.rer
```

Pantry stores uploaded document and receipt bytes in D1, including ordered parts for files up to 25 MB. It does not configure R2. The archive holds the whole book, documents included. Restore it into a fresh clone, or start over in the same folder: [Back up and restore](https://run-pantry.com/docs/backup).

## For developers

- What Pantry does and the rules it keeps: [CONTRACT.md](CONTRACT.md); proof of each clause: [ACCEPTANCE.md](ACCEPTANCE.md).
- HTTP and agent commands: [API.md](API.md) and `node scripts/pantry-agent.mjs`. Moving in from QuickBooks Online or Xero: [MOVE-IN.md](MOVE-IN.md). Synthetic example files: [fixtures/](fixtures/README.md).
- Every `rer` command, local data custody, ports and personas: [RUN-LOCALLY.md](RUN-LOCALLY.md). Deployment and operations: [OPERATIONS.md](OPERATIONS.md).
- Tests: `pnpm run test:pantry` (one flow per clause on the real Worker and D1), `pnpm run test:app` (the built app in a browser at 1440 and 390 wide), and `rer verify` for the full wall.
- Built with Hono, TanStack Start, Vite, React and Cloudflare Workers with D1. Source: [just-every/run-pantry](https://github.com/just-every/run-pantry).
