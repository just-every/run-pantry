Your books live in the folder where you run Pantry. An export is one archive holding the whole book: the ledger, documents byte for byte, reconciliations, close state, approvals and the move-in journal.

## Export

Stop Pantry so nothing can change during the backup, then export:

```sh
rer dev --stop
rer export --output exports/pantry-books.rer
```

The archive is saved in the `exports` folder with an integrity receipt. Copy it somewhere safe, away from this computer. Sign-ins are not part of it: after a restore you set up the owner again. Keys Pantry keeps sealed with this installation's own secret (Stripe, the AI key, Gusto and bank feed connections) only open in this installation, so after a restore into a fresh install, connect them again in People & settings and Bank.

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
