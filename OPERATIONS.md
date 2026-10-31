# Foundation operations

Run all first-party operations from the composed, runnable edition checkout
with `rer`. To get a runnable checkout, run
`npx -y @runeditrun/rer dev just-every/run-pantry` (set up only:
`npx -y @runeditrun/rer setup just-every/run-pantry`; without Node:
`curl -fsSL https://runeditrun.com/install.sh | sh -s -- dev just-every/run-pantry`).
Inside that checkout, `rer dev` alone launches it for review. The detailed flags and effects are in
`RUN-LOCALLY.md` and `SEED-COMMAND-CONTRACT.md`.

```sh
rer install
rer setup --owner-email you@example.com
rer dev
```

Use the setup prompt instead of the owner-email flag when entering the real
mailbox. Open the `RER_OPEN` link `dev` prints; no email is sent. Stop `dev` with
`rer dev --stop` or Ctrl-C, and stop `preview` with
`rer preview --stop` before build or verification.

```sh
rer verify
rer reset --yes
rer export --output exports/installation.rer
rer import --input exports/installation.rer --yes
rer deploy
rer describe
```

Use `rer describe` to inspect the checkout's actual
capabilities. `rer check --profile first-party` validates the
declared command contract; it does not run application journeys or contact a
provider.

## Local data and recovery

Setup and development use explicit owner identity and real local migrations.
Dev and preview use the same owner and canonical `.wrangler/state`. Any process
with access to the machine can read the checkout's dev key and sign in as the
owner. Private settings are
kept in `.dev.vars` with mode 0600 and are not copied into build output.

Local export creates a private archive with an integrity receipt and explicit
exclusions. The foundation has no product-domain tables or background jobs; an
edition's archive contains the supported domain tables and resources that its
adapter declares. Owner/auth, bookkeeping, private settings and
transient runtime state are excluded. Import validates and restores atomically
into an empty destination; confirmed reset preserves export archives. Run setup
after restore to establish a fresh owner. Each first-party seed verifies local
export/import/export equivalence across its supported resources. Remote transfer
is available only when the adapter declares complete resource coverage.

Preserve ambiguous state and applied migration history. Never place a remote
credential, owner secret or local resource ID in source. A schema change needs
a forward migration and verified transition/recovery.

## Deployment

`rer deploy --dry-run` validates the real owner-account
deployment declaration and builds locally without provider requests. Real
deployment requires privately supplied `CLOUDFLARE_ACCOUNT_ID` and
`CLOUDFLARE_API_TOKEN`, the declared owner/session/setup secrets, and a real
verified mail sender in `deploy.json`. Follow the owner-account deploy-kit
instructions under `node_modules/@runeditrun/rer/modules/deploy-kit`; account scope,
resource ownership, migrations, receipt and health checks are defined there.
Local validation does not prove hosted acceptance, provider delivery or remote
health.

## Receipts: AI reading and the Pantry address

Both are set up by the owner on **Settings → Receipts**; no deploy setting is
needed. The AI key is stored in the installation's database sealed with a key
derived from `SESSION_SECRET`: rotating that secret, or importing the books
into another installation, leaves the key unreadable and the card asks for it
again. The Pantry address needs a domain in the same Cloudflare account: turn
on Email Routing for it, add a routing rule for the receiving address with the
action **Send to a Worker** (this installation's Worker, whose `email` handler
is in `src/server.ts`), turn on **Subaddressing**, then enter the address on the
page. A domain that keeps Subaddressing off routes the dash spelling the card
shows (`receipts-<tag>@`) with a rule of its own instead. Mail to anything but the tagged address is refused unread. RER Managed
hosting (`MAIL_PROVIDER=rer`) has neither an outbound connection for AI
providers nor a domain for mail yet; both cards say so in one line.

## Run Edit Run delivery

`rer-project.json` declares the existing setup, build and verification commands.
`packaging.json` is the source policy for its deployment artifact. After
`pnpm run build`, run:

```sh
node scripts/delivery/base/cli.mjs artifact --config packaging.json
```

It writes `delivery-artifact/rer-worker-artifact.json` and its hashed payload
files, using the actual Worker, browser assets and unchanged D1 migrations.
The producer is exported from the published Base source at
`11f94fec479228d71ba6d7dd6ea7796c0d42c544` (rer 0.2.80), matching this
checkout's package and recorded Base copies. Its generated workflow pins the
trusted delivery workflow; production credentials are absent from the build.
`base-copies.json` records only unchanged producer files and schema support.
The exported setup module rewrites its two schema references; its Base origin
and the adapted development server's origin are comparison baselines in
`edition.json`, with snapshots retained by the source lock. They do not claim
byte equality. The exported `scripts/delivery/base/packaging.json` is the
seed-owned copy of the root packaging policy, written by the exporter.
The optional bank, payroll, payments and attachment-provider accounts are not
needed to build or list Pantry. A catalogue listing and a qualified platform
source pin are separate release steps; a valid descriptor alone does not
establish that hosting is offered.

To regenerate the descriptor and workflow after an intentional policy change,
use the producer's `package` command with a fresh output directory and copy its
generated files. Keep `rer-setup.json` canonical: its exact bytes are bound by
the descriptor's setup digest. Do not change applied migrations to package them.

The public repository import also requires the committed projection at
`management/integration/deployment-spec.json`. After a build or policy change,
run `pnpm delivery:spec` to regenerate it and `pnpm check:deployment-spec` to
check it against the actual build. Commit the projection with its source
changes. The import validates this specification and the digest-bound setup
manifest before offering configuration; the artifact alone is insufficient.
