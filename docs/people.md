Everyone in Pantry signs in as themselves, and the server checks their role and grants on every request.

## Roles

| Role | Can do |
| --- | --- |
| Owner | Everything: the business settings, people, agent tokens, locking and approving reopening. The owner may approve their own preparation. |
| Bookkeeper | Read the books; record contacts, documents, accounts, invoice and journal drafts, bills, payments, statement imports, matches, reconciliations and close tasks; request reopening. |
| Accountant | Everything a bookkeeper can, plus the grants the owner gives. |
| Viewer | Read the books, reports, documents and the accountant package. No changes. |

## Grants

The owner gives an accountant any of three grants:

- **Post and approve entries**: post journals prepared by someone else, approve invoices, decide journal proposals, sign off a move-in, record why a bill has no document, and reverse entries.
- **Lock periods**: lock a month once its checklist passes.
- **Approve reopening**: approve or decline a request to reopen a locked month.

## Two people for every approval

Someone other than the preparer approves journals, invoices and reopening requests, and someone other than the importer signs off a move-in, unless that person is the owner. Editing a draft makes you its preparer, so you cannot approve a version you changed yourself.

## Add a person

In **Settings → People and permissions**, under **Add a person**, enter their name, email and role, tick their grants and choose **Add person**. Adding someone also sends their sign-in invitation: a hosted Pantry emails them a one-time sign-in link, and **Send sign-in invitation** sends a fresh one if it expires. While you run Pantry on your own computer, no email is sent; the person can still be signed in as here (below).

## Work as someone else on your own computer

Pantry on your own computer sends no email, so a person you add signs in here through you:

1. Add them under **People**. Pantry records their invitation as it adds them, with no email sent.
2. Choose **More → Sign out or switch person**, then **Switch person**, and **Sign in as** them. Or stop Pantry and run `rer dev --as their.email@example.com`.
3. To come back, do the same and choose **Sign in as** yourself.

The sign-in page also lists **Dev bookkeeper**, **Dev accountant** and **Dev viewer** (`bookkeeper@dev.localhost` and so on; `rer dev --as accountant`). They have no role until you add their address under **People** with one.
