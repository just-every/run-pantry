Your books live in the folder where you run Pantry. An export is one archive holding the whole book: the ledger, documents byte for byte, reconciliations, close state, approvals and the move-in journal. A hosted Pantry keeps its own books on your Cloudflare account; back those up as in [Back up a hosted Pantry](#back-up-a-hosted-pantry).

## Export

Stop Pantry so nothing can change during the backup, then export:

```sh
rer dev --stop
rer export --output exports/pantry-books.rer
```

The archive is saved in the `exports` folder, with its checksums inside it: `rer import` checks them before restoring. Copy it somewhere safe, away from this computer. Sign-ins are not part of it: after a restore you set up the owner again. Keys Pantry keeps sealed with this installation's own secret (Stripe, the AI key, Gusto and bank feed connections) only open in this installation, so after a restore into a fresh install, connect them again in People & settings and Bank.

## Back up a hosted Pantry

`rer export` copies the books on this computer, even with `--origin` set to the hosted address (a fix is coming in rer); it never reads a hosted Pantry. To keep the hosted books, run this in the `run-pantry` folder you deploy from:

```sh
rer queue hosted-backup -- node scripts/hosted-backup.mjs --env-file .env.pantry
```

Add `--environment NAME` if you deployed with one. It saves the hosted database, every table plus every receipt, bill PDF and statement file stored in it, as one SQL file such as `exports/pantry-production-db-2026-10-17.sql`, and prints its size, fingerprint and how many journal entries, invoices, bills, bank lines and stored files it holds. It uses the Cloudflare account ID and token in `.env.pantry`; the hosted Pantry pauses for the few seconds the export takes. Keep the file somewhere safe; it is a complete copy you can open with any SQLite tool (`sqlite3 books.db < exports/pantry-production-db-2026-10-17.sql`). `rer import` does not read it yet.

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
