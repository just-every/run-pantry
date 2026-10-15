# Pantry Demo

`rer demo` opens a fresh, signed-in Pantry with Juniper Lane Design's books.
Stop it with `rer demo --stop`. Each start uses a new `.rer/demo/` directory,
which is deleted on stop. The installation's `.wrangler/state` is untouched.
The app's nav and document title say **Pantry Demo**, without a demo bar or outbox.

The sample adapts `tests/api/scenario.mjs` and the QuickBooks fixtures into real
records with fixed IDs and dates relative to the start: customers and vendors,
a service-business chart, two bank accounts, opening balances, invoices, bills,
recorded payments, a statement to reconcile, a journal draft, review tasks,
source documents, approvals and an agent proposal a person can decide.
`src/demo.ts` is idempotent and never fetches.

Public reads run for real. Pantry has no public URL check, bank feed or payment
initiation. Its invoice/payment commands record books locally; issuing an invoice
does not email it or move money. Sign-in and invitation mail use Base's
`demoEffect` delivery success and send nothing in demo mode. Optional identity
provider discovery and key reads stay real; external provider writes follow
Base's global demo effect guard. There is no capture or blocked-send UI.

The existing `/auth/owner-claim` accepts Base's signed owner claim only when its
issuer, installation ID and public keys are configured. No demo auth route is
added. Outside `RER_DEMO`, the worker keeps the real application behavior.

## Hosted demo

`deploy-demo.json` declares `demo.run-pantry.com`, with one isolated Cloudflare
Container per visitor. The `Run demo` workflow reads the `run-demo` environment;
manual dispatch with `test_only` uses a separate `demo.test.run-pantry.com` and
Cloudflare's published passing Turnstile test keys. Dispatch with both
`test_only` and `remove` to delete that test host and read back resource absence.
Production uses the environment's real Turnstile keys. No repository variable
is required for a manual deployment.

Base ends each visitor's copy after 60 minutes or 15 idle minutes. Each start
gets its own owner/session, database and disk. The homepage links to production
only after its start page passes the live readback.
