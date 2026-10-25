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
