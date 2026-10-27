import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { worker, TOKEN } from './worker.mjs'
import { monthCloseScenario } from '../api/month-close-journey.mjs'

// The existing close journey also reviews the coordinator's real proposals.
export async function monthCloseBrowser(browser) {
  const app = await worker(), owner = await browser.newContext(), origin = app.origin
  try {
    await owner.request.post(`${origin}/auth/bootstrap`, { headers: { origin }, data: { token: TOKEN, displayName: 'Synthetic owner' }, maxRedirects: 0 })
    await owner.request.post(`${origin}/setup`, { headers: { origin }, form: { confirm: 'yes' }, maxRedirects: 0 })
    const json = async (path, data) => {
      const r = data === undefined ? await owner.request.get(origin + path) : await owner.request.post(origin + path, { headers: { origin }, data })
      assert.equal(r.status(), 200, await r.text()); return r.json()
    }
    const h = { command: (op, data) => json('/api/pantry/command/' + op, data), view: path => json('/api/pantry/' + path), cron: () => owner.request.get(`${origin}/cdn-cgi/local/scheduled?cron=${encodeURIComponent('*/30 * * * *')}`) }
    const seeded = await monthCloseScenario(h)
    const { token } = await h.command('agent.create', { name: 'synthetic-pantry-11' })
    const response = await owner.request.post(`${origin}/api/pantry/agent/month-close`, { headers: { authorization: 'Bearer ' + token }, data: { period: '2026-09' } })
    assert.equal(response.status(), 200, await response.text())
    const report = await response.json()
    assert.equal(report.judgments.length, 4)
    const proof = process.env.PANTRY_PROOF_DIR
    if (proof) await mkdir(proof, { recursive: true })
    for (const width of [1440, 390]) {
      const context = await browser.newContext({ storageState: await owner.storageState(), viewport: { width, height: width === 390 ? 844 : 1000 } })
      try {
        const page = await context.newPage()
        await page.goto(origin + '/app/agents')
        await page.getByText('2026-09 coordinated close review', { exact: true }).waitFor()
        for (const kind of ['materiality', 'estimates', 'reclassification', 'reopening']) await page.getByText(kind + ':', { exact: false }).first().waitFor()
        // Both the evidence and the existing approval door remain visible.
        await page.getByText('Statement balances and matched postings agree.', { exact: false }).waitFor()
        const links = page.getByRole('link', { name: 'Open cited entry', exact: true })
        assert.ok(await links.count() >= 3)
        const cited = await owner.request.get(origin + await links.first().getAttribute('href'))
        assert.equal(cited.status(), 200)
        assert.ok((await cited.json()).id)
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
        if (proof) await page.screenshot({ path: `${proof}/month-close-agent-${width}.png`, fullPage: true })
        await page.goto(origin + '/app/close?period=2026-09')
        await page.getByRole('heading', { name: 'Period lock', exact: true }).waitFor()
        assert.equal(await page.getByRole('button', { name: 'Lock September 2026', exact: true }).isDisabled(), true)
        assert.equal((await h.view('close/2026-09')).status, 'open')
        if (proof) await page.screenshot({ path: `${proof}/month-close-unlocked-${width}.png`, fullPage: true })
      } finally { await context.close() }
    }
    assert.equal((await h.view('reconciliation/' + seeded.statement.id)).completed, null)
  } finally { await owner.close(); await app.close() }
}
