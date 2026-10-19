import type { Hono } from 'hono'
import type { Bindings } from '../../auth.server'
import { must, person } from '../access'
import { requireThat } from '../core'
import { one } from '../db'
import { batchView } from './views'
import { printableChecks } from './print'

export function checksRoutes(api: Hono<{ Bindings: Bindings }>) {
  const printHeaders = { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'" }
  api.get('/api/pantry/checks/alignment/:bank', async c => {
    const actor = await person(c.req.raw, c.env); must(actor, 'read')
    const profile = await one(c.env.DB, 'SELECT * FROM pt_check_profiles WHERE bank_account_id = ?', c.req.param('bank'))
    requireThat(profile, 'Set up check stock and alignment for this bank first', 404)
    const entity = await one(c.env.DB, 'SELECT legal_name FROM pt_entity WHERE id = 1')
    return new Response(printableChecks({ ...profile, business_name: entity?.legal_name ?? '', checks: [] }, { alignment: true }), { headers: printHeaders })
  })
  api.get('/api/pantry/checks/batches/:id/print', async c => {
    const actor = await person(c.req.raw, c.env); must(actor, 'read')
    const batch = await batchView(c.env.DB, c.req.param('id'))
    // Printer alignment can be repaired after issuing; payee, number, amount
    // and stock still come from the original batch, never a replacement payment.
    const profile = await one(c.env.DB, 'SELECT offset_x_mm, offset_y_mm FROM pt_check_profiles WHERE bank_account_id = ?', batch.bank_account_id)
    return new Response(printableChecks({ ...batch, ...profile }), { headers: printHeaders })
  })
  api.get('/api/pantry/checks/exports/:file', async c => {
    const actor = await person(c.req.raw, c.env); must(actor, 'record')
    const id = c.req.param('file').replace(/\.csv$/, ''), file = await one(c.env.DB, 'SELECT content FROM pt_check_exports WHERE id = ?', id)
    requireThat(file, 'Positive-pay export not found', 404)
    return new Response(file.content, { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="positive-pay-${id.replace(/[^\w-]/g, '')}.csv"`, 'cache-control': 'no-store' } })
  })
}
