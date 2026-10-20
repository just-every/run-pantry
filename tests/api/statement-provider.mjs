// Documented Plaid shapes, faked only at the provider HTTP boundary.
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { fakePlaid } from './plaid.mjs'

export async function statementProvider() {
  const base = await fakePlaid(), account = base.recorded['accounts-get'].accounts.find(a => a.mask === '0000')
  const list = JSON.parse(await readFile(new URL('../../fixtures/plaid/statements-list.json', import.meta.url)))
  list.accounts[0].account_id = account.account_id
  const pdf = await readFile(new URL('../../fixtures/plaid/statements-november.pdf', import.meta.url))
  const card = base.recorded['accounts-get'].accounts.find(a => a.mask === '3333')
  const state = { cardBalance: 50, balance: 120, asOf: '2026-11-30T23:00:00Z', badHash: false, cursor: 0, transactions: [
    { transaction_id: 'statement-income', account_id: account.account_id, date: '2026-10-05', name: 'Juniper client payment', amount: -100, pending: false },
    { transaction_id: 'statement-fee', account_id: account.account_id, date: '2026-10-06', name: 'Bank fee', amount: 20, pending: false },
    { transaction_id: 'statement-nov-income', account_id: account.account_id, date: '2026-11-05', name: 'November client payment', amount: -20, pending: false },
  ] }
  return { bindings: base.bindings, state, pdf, cardId: card.account_id, async outbound(request) {
    const path = new URL(request.url).pathname
    if (path === '/link/token/create') {
      const body = await request.clone().json()
      if (body.products?.includes('statements')) {
        if (!body.access_token || !body.statements?.start_date || !body.statements?.end_date) throw new Error('Statements requires update mode and an explicit date range')
        state.statementLink = body
      }
    }
    if (path === '/transactions/sync') return Response.json({ added: state.transactions, modified: [], removed: [], has_more: false, next_cursor: `statements-${++state.cursor}`, accounts: [{ ...account, balances: { current: state.balance, last_updated_datetime: state.asOf } }, { ...card, balances: { current: state.cardBalance, last_updated_datetime: '2026-12-31T23:00:00Z' } }] })
    if (path === '/statements/list') return Response.json(list)
    if (path === '/statements/download') return new Response(pdf, { headers: { 'content-type': 'application/pdf', 'Plaid-Content-Hash': state.badHash ? 'incorrect' : createHash('sha256').update(pdf).digest('hex') } })
    return base.outbound(request)
  } }
}
