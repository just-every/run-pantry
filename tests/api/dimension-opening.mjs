import assert from 'node:assert/strict'
import {dimensionSeed} from './dimension-extensions.mjs'
export async function dimensionOpening(t){
 const {h,acct}=await dimensionSeed(t)
 for(const accountId of [acct['6200'],acct['3000']])await h.command('dimension.require',{accountId,kinds:['class']})
 const pkg={source:'spreadsheet',cutoverDate:'2026-08-31',files:{trialBalance:{name:'synthetic-pantry-84.csv',content:'account,debit,credit,className,locationName,projectName\n6200,100,0,Studio,New York,Cedar\n6200,50,0,Support,Remote,Cypress\n3000,0,150,Studio,New York,Cedar'}}}
 for(const content of [pkg.files.trialBalance.content.replace('Studio','Unknown'),pkg.files.trialBalance.content.replace('Studio','')]){
  const r=await h.command('move-in.preview',{...pkg,files:{trialBalance:{...pkg.files.trialBalance,content}}})
  assert.ok(r.refused.some(row=>/active class|required class/.test(row.reason)));assert.equal((await h.view('journal')).entries.length,0)
 }
 const preview=await h.command('move-in.preview',pkg)
 assert.deepEqual(preview.refused,[]);assert.ok(preview.checks.every(c=>c.ok))
 let imported=await h.command('move-in.commit',{...pkg,fingerprint:preview.fingerprint})
 for(let n=0;imported.job.state!=='completed'&&n<10;n++)imported=await h.command('move-in.continue',{jobId:imported.job.id})
 assert.equal(imported.job.state,'completed')
 const staged=(await h.view('move-in')).cutovers.find(c=>c.status==='staged')
 await h.command('move-in.accept',{id:staged.id,revision:staged.revision})
 const r=await h.view('reports/general-ledger?from=2026-08-01&to=2026-08-31&basis=accrual&columns=class')
 const expense=r.rows.find(row=>row.id===JSON.stringify([acct['6200'],'closing']))
 assert.equal(expense.amount,15000);assert.equal(expense.values.reduce((n,v)=>n+v,0),15000)
 assert.equal(expense.values[r.sections.findIndex(s=>s.scope.value==='Studio')],10000)
}
