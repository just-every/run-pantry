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
