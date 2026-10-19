// Source documents and journals made through the same public commands as the app.
export async function recognitionScenario(h) {
  const state = await h.view('state'), acct = Object.fromEntries(state.accounts.map(a => [a.code, a.id]))
  const account = async (code, name, type) => (await h.command('account.save', { code, name, type })).id
  acct['1400'] = await account('1400', 'Prepaid insurance', 'asset')
  acct['2300'] = await account('2300', 'Accrued utilities', 'liability')
  acct['2400'] = await account('2400', 'Deferred retainers', 'liability')
  acct['6600'] = await account('6600', 'Insurance expense', 'expense')
  acct['6700'] = await account('6700', 'Utilities expense', 'expense')
  const vendor = await h.command('contact.save', { kind: 'vendor', name: 'Harbor Mutual Insurance', termsDays: 30 })
  const bill = await h.command('bill.save', { vendorId: vendor.id, reference: 'POLICY-2025-26', billDate: '2025-10-01', lines: [{ description: 'Annual studio insurance', accountId: acct['1400'], amount: '12000.00' }], post: true })
  const journal = async (date, memo, lines) => {
    const draft = await h.command('journal.save-draft', { date, memo, lines })
    return h.command('journal.post', { id: draft.id, revision: draft.revision })
  }
  const retainer = await journal('2026-07-01', 'Cedar quarterly retainer received', [{ accountId: acct['1000'], debit: '6000.00' }, { accountId: acct['2400'], credit: '6000.00' }])
  const plans = {
    prepaid: { name: 'Annual insurance', kind: 'prepaid', amount: '12000.00', startDate: '2025-10-31', months: 12, balanceAccountId: acct['1400'], recognitionAccountId: acct['6600'], sourceJournalId: bill.journal_id },
    accrual: { name: 'September utilities', kind: 'accrual', amount: '3200.00', startDate: '2026-09-30', months: 1, balanceAccountId: acct['2300'], recognitionAccountId: acct['6700'] },
    deferred: { name: 'Cedar retainer', kind: 'deferred', amount: '6000.00', startDate: '2026-07-31', months: 3, balanceAccountId: acct['2400'], recognitionAccountId: acct['4000'], sourceJournalId: retainer.id },
  }
  return { acct, bill, retainer, journal, plans }
}
