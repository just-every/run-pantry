import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { harness, books } from './harness.mjs'
import { hostedRestoreCommand, hostedRestoreFailure } from '../../scripts/hosted-restore.mjs'
import { cloudflareEdge, domainImage, recordHostedMigrations, restoredSnapshot, restoreEnvironment, saveHostedArchive } from './hosted-restore-journey.mjs'

export async function hostedRestoreFlow(t) {
  const directory = await mkdtemp(join(tmpdir(), 'pantry-hosted-restore-'))
  let active
  t.after(async () => { await active?.close(); await rm(directory, { recursive: true, force: true }) })
  const archive = join(directory, 'books.rer'), journal = join(directory, 'later.rer')
  active = await harness()
  await recordHostedMigrations(active.db)
  const { acct } = await books(active)
  const draft = await active.command('journal.save-draft', {
    date: '2026-09-30', memo: 'Synthetic hosted recovery purchase',
    lines: [{ accountId: acct['6500'], debit: '12.34' }, { accountId: acct['3000'], credit: '12.34' }],
  })
  const posted = await active.command('journal.post', { id: draft.id, revision: draft.revision })
  const binary = Buffer.from([0, 255, 128, 13, 10, 1, 0, 254, 65, 66])
  const document = await active.command('document.upload', {
    name: 'synthetic-pantry-original.bin', mediaType: 'text/plain', base64: binary.toString('base64'),
    linkedKind: 'journal', linkedId: posted.id,
  })
  const lead = await active.command('contact.save', { kind: 'customer', name: 'Synthetic obsolete hosted enquiry' })
  const expected = await restoredSnapshot(active, document.id)
  assert.equal(expected.bytes, binary.toString('hex'))
  assert.equal(expected.report.balanced, true)
  assert.equal(expected.ledger.accounts.flatMap(account => account.rows).length, 2)
  await saveHostedArchive(active.db, archive, await active.bucket('PANTRY_DOCUMENTS'))
  const preview = await active.command('erasure.preview', { kind: 'contact', id: lead.id })
  await active.command('erasure.execute', {
    kind: 'contact', id: lead.id, fingerprint: preview.fingerprint,
    requester: 'Synthetic requester', channel: 'in-person', reason: 'Remove obsolete enquiry', confirm: 'ERASE',
  })
  await saveHostedArchive(active.db, journal, await active.bucket('PANTRY_DOCUMENTS'))
  await active.close(); active = undefined

  active = await harness()
  await recordHostedMigrations(active.db)
  const edge = cloudflareEdge(active.db,await active.bucket('PANTRY_DOCUMENTS'))
  const options = { env: restoreEnvironment, fetch: edge.fetch }
  const args = ['--input', archive, '--environment', 'ops-i987', '--yes']
  await assert.rejects(hostedRestoreCommand(args.filter(value => value !== '--yes'), options), /restore_confirmation_required/)
  await assert.rejects(hostedRestoreCommand(args, { ...options, env: { ...restoreEnvironment, CLOUDFLARE_ACCOUNT_ID: 'synthetic-pantry-wrong-account' } }), /provider_credentials_required/)
  assert.equal(edge.calls, 0, 'Confirmation and account refusals make no provider request')
  const receipt = await hostedRestoreCommand(args, options)
  assert.equal(receipt.erasureHistory, 'later-journal-not-supplied')
  assert.deepEqual(await restoredSnapshot(active, document.id), expected)
  const occupied = await domainImage(active.db)
  await assert.rejects(hostedRestoreCommand(args, options), error => hostedRestoreFailure(error) === 'target_not_empty')
  assert.deepEqual(await domainImage(active.db), occupied, 'Occupied destination books remain unchanged')
  await active.close(); active = undefined

  active = await harness()
  await recordHostedMigrations(active.db)
  const fresh = await domainImage(active.db)
  const fenced = cloudflareEdge(active.db,await active.bucket('PANTRY_DOCUMENTS'))
  await assert.rejects(hostedRestoreCommand([...args, '--journal', journal], { env: restoreEnvironment, fetch: fenced.fetch }), error => ['erased_row', 'erasure_epoch', 'later_journal'].includes(hostedRestoreFailure(error)))
  assert.deepEqual(await domainImage(active.db), fresh, 'A later erasure journal prevents all product-row publication')
  await active.close(); active = undefined
}
