Pantry has no built-in model. Instead, you point the agent you already use at your books: it reads what it needs, prepares matches, entries and close work, and files each one as a proposal. A person approves or rejects every proposal; agents never post, approve or lock.

## Give your agent a token

The owner opens **People & settings** and, under **Agent access**, enters a name and chooses **Create agent token**. The token is shown once: copy it into your agent's settings straight away. Pantry keeps only its hash, and you can deactivate the agent at any time.

## What an agent can propose

- **A bank match** between statement lines and postings, adding only fees, bank income or transfers.
- **A journal entry** that cites a source document and quotes the passages it used. No document, no proposal.
- **A close packet** listing a month's exceptions; approving it turns them into review tasks.
- **A variance explanation** that cites posted entries and changes no figure.

Documents reach the agent as untrusted evidence: it may quote them, never follow instructions inside them.

## Approve or reject

Proposals wait in **Agent work** under **More**, and bank matches also appear on the statement being reconciled. Read the evidence, then choose **Approve** (or **Approve and post** for a journal entry, which needs the post grant) or **Reject**. Approving re-checks every record the agent cited, the period lock and your role. A proposal whose cited records changed since the agent read them becomes stale and cannot be approved.

## For the agent's operator

The commands an agent uses are in the repository's `API.md`, and `scripts/pantry-agent.mjs` wraps them:

```sh
PANTRY_URL=http://127.0.0.1:8787 PANTRY_AGENT_TOKEN=… node scripts/pantry-agent.mjs context
```

## Ask the books

In **Reports**, use **Ask the books** for contractor spending or net income. For example, ask “what did we spend on contractors in Q3 2026 compared with last year?” or “why is net income down in October 2026?”. Choose cash or accrual. Name one month or quarter; an omitted year means the current UTC year. Contractor spending uses expense accounts whose names contain “contract”, with the selected accounts shown in the answer.

Generated answers calculate from posted native reports and their underlying lines. They show the exact date ranges and basis, the report links, the posted entry links and the account movements behind a comparison. “Last year” compares the same range in the previous year; otherwise the comparison uses the immediately preceding range of the same length, as native custom reports do. Missing records show **No records**; a missing comparison produces no inferred change. Unsupported or ambiguous questions are refused without calling a model.

Choose **Save answer as custom report** to retain the current, prior and change columns in REPORT-006. Net income retains its income-less-expenses formula; contractor spending retains its account selection. The saved definition recalculates from the books when opened. Questions require full financial-report authority, and report links, entry links and saved reports check the reader's current grants again. A sales role or a person with restricted bank visibility cannot use this door to read the whole books.

## Prepare the month

Run `node scripts/pantry-agent.mjs month-close --period 2026-09` with the same agent connection. Repeat it through the month as records arrive. Unchanged pending proposals are reused. The result accounts for every native close check, completed or proposed statement reconciliations, blocked statement proofs and recognition or recurring-journal exceptions. Existing approved schedules keep their existing scheduler and approval rules.

The close packet proposes four reviews: materiality, estimates, reclassification and reopening. Each carries the report, posted entries, schedule facts or period history behind its recommendation. Approving the packet creates the existing human review tasks; it does not complete them. The evidence stays in the proposal's Details. Variance proposals compare posted income and expense account totals with the preceding calendar month, name the entries behind the arithmetic and provide **Open cited entry** links. They do not infer a business cause or change a figure.

A reconciliation packet is proposed only when the native statement proof is ready. Human approval checks that the statement, matches, books and dated provider balances still agree, then records the native reconciliation. Changed proof must be prepared again. Locking remains the existing person's command.

Supported manual drafts and bills with source documents get exact-record posting proposals. Draft invoices get approval proposals, then a separate issue proposal for the approved revision. An unapplied payment gets an allocation proposal only when one open item of the same contact has the exact remaining amount and there is no competing payment. Each correction uses the native approval rules and report-effects preview; changed records, missing authority and locked dates refuse approval. No correction changes a source date or sends a document. Missing evidence and ambiguous choices remain visible as unresolved checks.

Monthly preparation can also be enabled by the owner under Settings → Agent access → Monthly close preparation. Choose an active agent and month and explicitly turn preparation on. Accounting ticks first run existing approved schedules, then refresh the close proposals. Turning preparation off, deactivating the agent or locking the period stops refreshes. This grants no posting or locking authority. Unchanged approved packets are retained rather than proposed again.

A unique statement line with one equal posting on the same date gets a typed match proposal. Its financial preview and approval use the existing match controls; no new posting is invented. Missing or ambiguous evidence remains unresolved. The coordinated packet creates the four judgment tasks; only the owner or accountant may decide that packet or edit and complete those tasks. Approved packet evidence stays available in Agent work.
