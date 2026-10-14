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

In **People & settings**, under **People**, enter their name, email and role, tick their grants and choose **Add person**, then **Send sign-in invitation**. While you run Pantry on your own computer, invitations go to the local outbox rather than to their mailbox; `rer dev` prints how to open it.
