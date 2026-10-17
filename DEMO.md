# Pantry Demo

`rer demo` opens a fresh, signed-in Pantry with Juniper Lane Design's books.
Stop it with `rer demo --stop`. Each start uses a new `.rer/demo/` directory,
which is deleted on stop. The installation's `.wrangler/state` is untouched.
The app's nav and document title say **Pantry Demo**, without a demo bar or outbox.

The sample adapts `tests/api/scenario.mjs` and the QuickBooks fixtures into real
records with fixed IDs and dates relative to the start: customers and vendors,
a service-business chart, two bank accounts and a business card, opening balances, invoices, bills,
recorded payments, a statement to reconcile, a journal draft, review tasks,
source documents, approvals and an agent proposal a person can decide.
Bank shows this month's feeds (`src/demo/feeds.ts`): Chase checking and savings
connected and current with their balances, an American Express card that needs
re-linking, a pending card charge, an Adobe rule that files its line and a Cedar
Studio ACH that meets its invoice through Pantry's own rule and deposit code. The
connections hold no provider token and the demo calls no provider, so Sync now
and Re-link say that live feeds need setting up.
This month also carries the homepage's moments, each made by Pantry's own code
(`src/demo/sales.ts`, `src/demo/inbox.ts`): Dana Ruiz, a 1099 contractor over the
threshold, paid by ACH and matched; a 23-charge Stripe payout split into sales
and fees and matched to its deposit; a monthly recurring invoice drafted by its
due work, approved and issued; an invoice sent with its PDF and opened by the
customer; a Home Depot receipt read and attached by the owner's receipt rule and
a Paper & Pine receipt waiting to be accepted; and one pass of the books agent,
with a receipt question answered and the owner's own words about an unexplained
savings transfer read into an answer that shows its net-income change and waits
for "Yes, do it". Only a provider's answers are seeded as records (Stripe's payout
listing, the mail provider's acceptance, the customer's first view, the AI
model's readings), and the Stripe and AI connections hold no working key.
The month before last is closed the way a person closes it: `src/demo/close.ts`
matches its statement lines, completes both reconciliations and locks the
period through Pantry's own match, reconciliation and lock plans. Last month is
open, with its statement to reconcile. The owner is Priya Shah
(`ownerEmail` in `deploy-demo.json`). `src/demo.ts` is idempotent and never fetches.

Public reads run for real. Pantry has no public URL check, live bank feed or payment
initiation. Its invoice/payment commands record books locally; issuing an invoice
does not email it or move money. Sign-in and invitation mail use Base's
`demoEffect` delivery success and send nothing in demo mode. Optional identity
provider discovery and key reads stay real; external provider writes follow
Base's global demo effect guard. There is no capture or blocked-send UI.

The existing `/auth/owner-claim` accepts Base's signed owner claim only when its
issuer, installation ID and public keys are configured. No demo auth route is
added. Outside `RER_DEMO`, the worker keeps the real application behavior.

## Hosted demo

`deploy-demo.json` declares `demo.run-pantry.com`. Each visitor gets their own
native Worker Loader isolate with SQLite storage for Pantry's D1 database, on
Base's native demo host (rer 0.2.30). The `Run demo` workflow reads the `run-demo` environment;
manual dispatch with `test_only` uses a separate `demo.test.run-pantry.com` and
Cloudflare's published passing Turnstile test keys. Dispatch with both
`test_only` and `remove` to delete that test host and read back resource absence.
Test starts need the private `RER_DEMO_MEASUREMENT_TOKEN` as the `rer_demo_measure`
cookie. Production uses the environment's real Turnstile keys and the
environment variable `CLOUDFLARE_ACCOUNT_ID`.

Base ends each visitor's copy after 60 minutes or 15 idle minutes. Each start
gets its own owner/session and database, erased when the copy ends. The homepage links to production
only after its start page passes the live readback.
