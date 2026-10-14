Your books live in the folder where you run Pantry. An export is one archive holding the whole book: the ledger, documents byte for byte, reconciliations, close state, approvals and the move-in journal.

## Export

Stop Pantry so nothing can change during the backup, then export:

```sh
rer dev --stop
rer export --output exports/pantry-books.rer
```

The archive is saved in the `exports` folder with an integrity receipt. Copy it somewhere safe, away from this computer. Sign-ins, the local outbox and private settings are not part of it.

## Restore

A restore goes into an empty installation. In a fresh clone of Pantry, or after resetting this one, import the archive, then set up the owner again:

```sh
rer import --input exports/pantry-books.rer --yes
rer setup --owner-email you@example.com
rer dev
```

Pantry checks the archive before restoring it and refuses one whose posted entries do not balance.

## Start over in this folder

`rer reset --yes` removes this installation's local data, owner and sessions, and keeps your exports. Export first if you want to keep the books:

```sh
rer dev --stop
rer export --output exports/pantry-books.rer
rer reset --yes
rer import --input exports/pantry-books.rer --yes
rer setup --owner-email you@example.com
```
