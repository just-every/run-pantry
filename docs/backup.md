Your books live in the folder where you run Pantry. An export is one archive holding the whole book: the ledger, documents byte for byte, reconciliations, close state, approvals and the move-in journal. A hosted Pantry keeps its own books on your Cloudflare account; back those up as in [Back up a hosted Pantry](#back-up-a-hosted-pantry).

## Export

Stop Pantry so nothing can change during the backup, then export:

```sh
rer dev --stop
rer export --output exports/pantry-books.rer
```

The archive is saved in the `exports` folder, with its checksums inside it: `rer import` checks them before restoring. Copy it somewhere safe, away from this computer. Sign-ins are not part of it: after a restore you set up the owner again. Keys Pantry keeps sealed with this installation's own secret (Stripe, the AI key, Gusto and bank feed connections) only open in this installation, so after a restore into a fresh install, connect them again in People & settings and Bank.

## Back up a hosted Pantry

`rer export` saves only the books on this computer, and refuses when you name a hosted address. To keep the hosted books, run this in the `run-pantry` folder you deploy from:

```sh
rer run hosted-backup --env-file .env.pantry
```

Add `--environment NAME` if you deployed with one. The command establishes the database's stable erasure-journal identity if this is its first backup, then takes Cloudflare's SQL snapshot and converts it to a private, checksum-verified `.rer` archive. The receipt lists table counts, exclusions, archive hash and content hash. The same Pantry policy as local export removes credentials and disables restored connections and standing consent. Documents travel byte for byte from the D1 recovery mirror, including hosted originals served from private R2 storage.

Restore the resulting archive with the ordinary `rer import` command below. Supply the latest post-erasure archive with `--journal` when restoring an older backup. This uses ERASURE-001's existing journal fence; a fresh destination without that later journal cannot discover erasures made after its backup.

The command accepts a mode-0600 deploy file or injected `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`. It never prints provider diagnostics or credentials. Each default filename contains the full timestamp, and an existing output is refused. A failed conversion retains its private SQL snapshot and names its location. To retry conversion without another provider call:

```sh
node scripts/hosted-archive.mjs --input-sql /path/to/snapshot.sql --output exports/recovered.rer
```

Only use a snapshot produced after the source installation established its erasure identity. A legacy SQL file without that identity is refused: retain it and take a new backup from the source rather than assigning an unrelated identity.

For an owner-controlled scheduler, run the same command from the exact deployed checkout, with its private deploy file, once per day. Keep the archive directory on encrypted storage outside the deployed database, monitor the command's exit status, and copy successful archives to a separate failure domain. The command returns nonzero on provider or conversion failure and never replaces an earlier archive. Example scheduler command:

```sh
cd ./run-pantry && node scripts/hosted-backup.mjs --env-file ./pantry-deploy.env --environment production
```

New own-account hosted deploys provision a private `PANTRY_BACKUPS` R2 binding. The existing half-hour Cron starts one complete archive per UTC day and advances at most 32 archive parts per tick. A durable lease prevents overlapping ticks from publishing duplicates. Multipart uploads keep memory bounded; failed uploads are aborted. Failed work retries on a later tick, and erasure invalidates an unfinished snapshot before a fresh snapshot is taken. No archive is deleted automatically.

A saved archive job can disappear when an owner erases personal data. The next scheduled tick replaces that missing job with a fresh snapshot through the same erasure fence, finishes the oldest incomplete day, then continues later days. A provider upload failure retains a valid completed snapshot for retry.

The installation's `pt_hosted_backup_runs` table records completion, the object key, content hash and a value-free failure code. Download a completed archive using the owner's Cloudflare R2 tools, then restore it as below. Keep the bucket private. Existing deployments without the binding continue their accounting schedule and need redeployment to enable it. A backup remains in the same Cloudflare account; copy it elsewhere for independent disaster recovery.

Hosted deployments also provision a private `PANTRY_DOCUMENTS` bucket. Successful app mutations copy up to 32 pending originals to R2 and verify their hashes; the half-hour schedule drains remaining uploads. Downloads use the verified object through the existing session or scoped integration door, never a public bucket URL. Missing or corrupted committed objects are refused. D1 keeps a byte-for-byte recovery mirror so existing local export and import remain self-contained. Restored books rebuild their installation-local object receipts and copy originals into the new bucket on later mutations or scheduled ticks.

Owner-confirmed erasure deletes the corresponding R2 objects before a successful command response. Failed provider deletions retain their receipts for retry; erased documents cannot be downloaded. An upload racing erasure rechecks the journaled document state and deletes its copy. Earlier completed recovery archives retain the existing later-journal requirement. A fresh hosted deployment drill and the large-business report timing proof remain OPS-001 work.

## Restore into a fresh install

A restore goes into an installation with no books yet. On the new computer (or in a new folder), get Pantry, put the archive in its `exports` folder, import it, then set up the owner:

```sh
git clone https://github.com/just-every/run-pantry.git
cd run-pantry
mkdir -p exports
cp /path/to/pantry-books.rer exports/
rer import --input exports/pantry-books.rer --yes
rer setup --owner-email you@example.com
rer dev
```

Import before setup: `rer import` installs what Pantry needs by itself. Pantry checks the archive before restoring it and refuses one whose posted entries do not balance. People you invited keep their roles; they sign in again by email.

## Start over in this folder

`rer reset --yes` removes this installation's local data, owner and sessions, and keeps the `exports` folder. Export first, then reset and restore:

```sh
rer dev --stop
rer export --output exports/pantry-books.rer
rer reset --yes
rer import --input exports/pantry-books.rer --yes
rer setup --owner-email you@example.com
rer dev
```

## If a restore is refused

A refused restore changes nothing, and your archive stays where it was.

- **`target_not_empty`**: the folder already holds Pantry books, so the restore would mix two sets of books. Either restore into a fresh install (above), or replace the books here: export them first if you want to keep a copy (`rer export --output exports/books-before-restore.rer`), then `rer reset --yes` and import again.
- **`content_checksum` or `archive_checksum`**: the file was damaged or changed after export. Use another copy.

Do not run `rer setup` in place of a restore that was refused: setup starts a new, empty book. Run it once `rer import` reports `import: complete`.
