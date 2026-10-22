# Adopt the seed Verify workflow

New foundation compositions and standalone reference exports receive
`.github/workflows/verify.yml` from Base's `export/verify.yml`. Existing editions
own their workflows: copy or merge the template into that path, preserving their
product-specific checks and supported Node and package-manager versions.

The template installs the frozen dependencies, runs the seed's `deps` script to
prepare its declared RER tools, installs Chromium, and runs its real `verify`
script. These package scripts work with both contained and packaged RER. Its application Node
version remains 22.20.0; the pinned checkout and setup-node v7 actions run their
own code on Node 24. Action runtime upgrades do not change application engines.

Edition-owned seeds retain `edition.json`, `sources.lock.json`,
`.edition/sources/` and their pinned `scripts/edition-authoring/` tools. The
workflow runs `node scripts/edition-authoring/cli.mjs check` before installing
dependencies whenever either edition manifest or source lock is present. A
missing counterpart or tool fails the job. Intentional source or workflow edits
require staging new files, inspecting `changes`, and running `lock` locally;
commit the resulting lock and retained snapshots. CI never rewrites the lock.

Technical foundation/reference exports have composition or reference provenance
instead of an edition-owned source lock, so this authoring check becomes active
when they adopt the edition-owned protocol. Read Base's
`edition-authoring/README.md` for that adoption; the workflow does not convert an
existing product or create a source recipe.

The action pins were checked against the official
[checkout v7.0.1 release](https://github.com/actions/checkout/releases/tag/v7.0.1)
and [setup-node v7.1.0 release](https://github.com/actions/setup-node/releases/tag/v7.1.0).
Their pinned `action.yml` files declare `runs.using: node24`.

Pantry partitions verification in `scripts/verify.mjs`: source checks, five API
file groups and eight browser jobs. The long move-in and report suites each get
their own API job; the remaining API files divide across three more jobs. Browser jobs 1–5 divide the literal top-level
journeys in `tests/app/app.test.mjs`; jobs 6–8 divide every other browser test
file. New registrations and matching files are included automatically, exactly
once. Each browser job builds the real Worker before its journeys. The
15-minute job limit and final requirement that every shard and restore succeeds
remain unchanged. Refresh the edition lock after an intentional plan change.

Files within each API/browser file group run sequentially. This prevents concurrent test processes from racing their local Worker proxy port reservations; independent jobs remain parallel. Server startup errors fail the job, with no assertion retry.

The shared API and provider-backed browser harnesses bind Miniflare to port 0 and keep that socket while setting AUTH_ORIGIN to its assigned origin. They no longer release a reserved port before Worker startup. Startup failure still fails the test without retrying assertions.
