# Pantry acceptance record

**Purpose and minimum outcome.** An owner, bookkeeper and outside accountant move one US service business from an opening position through recorded sales, bills and payments, reconciled bank statements and a reviewed, locked month, and leave with a restorable archive and an accountant package. The sixteen clauses are in [CONTRACT.md](CONTRACT.md).

**Status: all sixteen first-release clauses are LOCAL PROVEN.** Each has one flow test through the public HTTP door of the real Worker on Miniflare with a real D1 database, every migration applied and genuine native sign-ins (`pnpm run test:pantry`, files under `tests/api/`). The browser journey (`pnpm run test:browser`, `tests/browser/`) repeats the flows in the screens from fresh clones through the `rer` verbs at 1440 and 390 pixels wide, then exports, restores into a second installation and compares the books. LOCAL PROVEN means exercised locally; it is not hosted, provider, accountant or tax acceptance.

| # | What a person can do | Test | Status |
| --- | --- | --- | --- |
| PAN-01 | Set up the business (legal name, entity type, state, fiscal year, books start, declared tax method, policies); add people with roles and grants; every role enforced by the server on every request, including a removed role on a live session and cross-site writes. | `ledger.test.mjs` › `PAN-01 a business is set up with declared policies and each role is enforced by the server` | LOCAL PROVEN |
| PAN-02 | Start or build a chart with one control account each; post reviewed opening balances only through a second person; keep a used account's type. | `ledger.test.mjs` › `PAN-02 …opening balances post only after review by a second person` | LOCAL PROVEN |
| PAN-03 | Keep customers and vendors with terms; upload documents whose exact bytes and SHA-256 come back. | `ledger.test.mjs` › `PAN-03 …document bytes returned exactly` | LOCAL PROVEN |
| PAN-04 | Draft, approve (second person, exact version) and issue invoices; unknown tax treatment stops approval; credits apply to the invoice; receivables agree to control. | `subledgers.test.mjs` › `PAN-04 invoices are drafted, approved and issued; unknown tax stops approval; credits reduce what is owed` | LOCAL PROVEN |
| PAN-05 | Record bills posted to payables with their evidence; a missing document is a close exception until attached or explained by someone with the post grant. | `subledgers.test.mjs` › `PAN-05 bills post to payables with their evidence…` | LOCAL PROVEN |
| PAN-06 | Record payments made outside Pantry and allocate them wholly or partly; unapplied money stays visible; reversing a payment reopens the bill. | `subledgers.test.mjs` › `PAN-06 payments made outside Pantry are recorded and allocated…` | LOCAL PROVEN |
| PAN-07 | Import CSV and OFX statements against the right account; repeats and overlaps add no duplicates; cross-format overlaps refused; file kept exactly. | `bank.test.mjs` › `PAN-07 CSV and OFX statements import against the right bank account, and repeats create no duplicates` | LOCAL PROVEN |
| PAN-08 | Match through one-to-one, split deposits, fees, transfers, vendor payments and partial settlements; a recorded payment is never posted twice; unbalanced or repeated matches refused. | `bank.test.mjs` › `PAN-08 statement lines match… never posting a recorded payment twice` | LOCAL PROVEN |
| PAN-09 | Reconcile only with a proven balance; a statement mismatch blocks with the difference explained; completed proof freezes its matches; outstanding items carry to the next statement. | `bank.test.mjs` › `PAN-09 a statement reconciles only when its balances are proven…` | LOCAL PROVEN |
| PAN-10 | Post a balanced journal approved by someone other than its preparer for the exact revision reviewed; immutability enforced by the database; agent tokens cannot post. | `ledger.test.mjs` › `PAN-10 a journal entry posts balanced, approved by someone other than its preparer…` | LOCAL PROVEN |
| PAN-11 | Correct a posted entry with a linked, dated reversal; both stay in the ledger. | `ledger.test.mjs` › `PAN-11 a posted entry is corrected by a linked reversal and its history survives` | LOCAL PROVEN |
| PAN-12 | Trial balance, general ledger, P&L, balance sheet and ageing from the same posted lines; subledgers tie to control accounts; book cash equals the reconciled statement. | `close.test.mjs` › `PAN-12 trial balance, general ledger, profit and loss, balance sheet and ageing all come from the same ledger` | LOCAL PROVEN |
| PAN-13 | Close a month through calculated checks and named review tasks; lock it; locked dates refuse people, agents and the database itself; reopen only by an approved request from someone else. | `close.test.mjs` › `PAN-13 a period closes through its checklist and lock…` | LOCAL PROVEN |
| PAN-14 | Download the accountant package and GL CSV; export and restore the complete books (reports, ledger, reconciliations, close state and approvals, reversal links, document bytes, move-in journal) into a fresh installation. | `close.test.mjs` › `PAN-14 the accountant package holds…`; `tests/browser/run.mjs` export → second fresh install → `rer import` → identical snapshot | LOCAL PROVEN |
| PAN-15 | An agent reads its context and files match, journal, close-packet and variance proposals; a person approves; stale citations, missing evidence, missing grants and turned-off tokens are refused; approvals recorded. | `agent.test.mjs` › `PAN-15 an agent prepares matches, entries and close work that a person approves…`; the browser journey drives `scripts/pantry-agent.mjs` | LOCAL PROVEN |
| PAN-16 | Preview a QuickBooks Online cutover (counts, refused rows, tie-outs, missing documents), import it as staged records with originals kept, undo it, re-import, and post it by accountant sign-off; undo refused afterwards. | `move-in.test.mjs` › `PAN-16 a QuickBooks Online cutover is previewed, imported as staged records, undone or signed off by the accountant` | LOCAL PROVEN |

## Evidence and decision rule

`rer verify` runs every clause's flow test on each push in the Verify workflow; run the browser journey with `pnpm run test:browser`. A clause stays LOCAL PROVEN only while its named test passes on the head being released.

## Not yet established

- A real QuickBooks Online package (only documented-shape synthetic fixtures were used), `.xlsx` reading and the separate attachments `.zip`.
- A real accountant's review of a close, and any tax-method, state or sales-tax correctness.
- Hosted deployment, mail delivery of invitations (suppressed locally), bank-feed or model providers.
- Accessibility beyond the keyboard and label conventions built in (no audit run).
