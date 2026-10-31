#!/usr/bin/env node
// Typed commands for the owner's agent. The agent reads the books it may see
// and files proposals; a person approves them in Pantry. Nothing here can post,
// approve or lock. Set PANTRY_URL (for example http://127.0.0.1:8787) and
// PANTRY_AGENT_TOKEN (created in Settings → Agent access).
import { readFile } from 'node:fs/promises'

const USAGE = `pantry-agent <command> [options]

  month-close --period YYYY-MM                    prepare coordinated monthly close proposals
  context [--period YYYY-MM]                      what the agent may read, as JSON
  propose-match --summary TEXT --bank-line ID... [--posting ID...] [--fee AMOUNT --account ID]
  propose-journal --file PROPOSAL.json            {summary, date, memo, documentId, passages[], lines[]}
  propose-close-packet --period YYYY-MM --summary TEXT --exception TEXT...
  propose-variance --period YYYY-MM --summary TEXT --body TEXT --cite ENTRY_ID...
  status PROPOSAL_ID                              the decision on one of this agent's proposals`

function options(args) {
  const out = { _: [] }
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (!a.startsWith('--')) { out._.push(a); continue }
    const key = a.slice(2), value = args[i + 1]
    if (value === undefined || value.startsWith('--')) throw new Error(`${a} needs a value`)
    out[key] = [...(out[key] ?? []), value]; i++
  }
  return out
}
const one = (o, key, required = true) => { const v = o[key]?.[0]; if (required && !v) throw new Error(`--${key} is required`); return v }

async function call(path, body) {
  const base = process.env.PANTRY_URL, token = process.env.PANTRY_AGENT_TOKEN
  if (!base || !token) throw new Error('Set PANTRY_URL and PANTRY_AGENT_TOKEN')
  const response = await fetch(new URL(`/api/pantry/agent/${path}`, base), { method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) })
  const value = await response.json().catch(() => ({ error: `HTTP ${response.status}` }))
  if (!response.ok) { const e = new Error(value.error ?? `HTTP ${response.status}`); e.status = response.status; throw e }
  return value
}

const commands = {
  'month-close': o => call('month-close', { period: one(o, 'period') }),
  context: o => call(`context${o.period ? `?period=${encodeURIComponent(one(o, 'period'))}` : ''}`),
  'propose-match': o => call('proposals', { kind: 'match', summary: one(o, 'summary'), payload: { bankLineIds: o['bank-line'] ?? [], journalLineIds: o.posting ?? [], create: o.fee ? [{ type: 'fee', amount: one(o, 'fee'), accountId: one(o, 'account'), direction: 'out' }] : [] } }),
  'propose-journal': async o => { const p = JSON.parse(await readFile(one(o, 'file'), 'utf8')); const { summary, ...payload } = p; return call('proposals', { kind: 'journal', summary, payload }) },
  'propose-close-packet': o => call('proposals', { kind: 'close-packet', summary: one(o, 'summary'), payload: { period: one(o, 'period'), exceptions: o.exception ?? [], notes: one(o, 'notes', false) ?? '' } }),
  'propose-variance': o => call('proposals', { kind: 'variance-note', summary: one(o, 'summary'), payload: { period: one(o, 'period'), body: one(o, 'body'), citations: o.cite ?? [] } }),
  status: o => call(`proposals/${encodeURIComponent(o._[0] ?? '')}`),
}

const [name, ...rest] = process.argv.slice(2)
if (!name || !commands[name]) { console.error(USAGE); process.exit(name ? 2 : 0) }
try { console.log(JSON.stringify(await commands[name](options(rest)), null, 2)) }
catch (error) { console.error(`pantry-agent ${name}: ${error.message}`); process.exit(error.status === 401 || error.status === 403 ? 4 : error.status === 409 ? 3 : 1) }
