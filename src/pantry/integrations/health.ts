import type { Context } from '../context'
import { dataFlows } from '../data-flows'
import { all, one } from '../db'
import { clearingState } from '../stripe-clearing'

/** Explicit owner inventory; unavailable measurements never masquerade as zero. */
export async function connectionHealth(c: Context) {
  const inventory = await dataFlows(c)
  const stripe = await one(c.db, 'SELECT payouts_synced_at,payouts_error,payout_bank_account_id FROM pt_stripe WHERE id=1')
  const gusto = await one(c.db, 'SELECT synced_at,sync_error,bank_account_id FROM pt_gusto WHERE id=1')
  const clearing = await clearingState(c.db)
  const payrolls = await all(c.db, `SELECT p.uuid,p.debit_cents,p.reason,p.status,
    COALESCE((SELECT SUM(l.credit_cents-l.debit_cents) FROM pt_journal_lines l JOIN pt_journal_entries e ON e.id=l.entry_id WHERE e.id=p.entry_id AND e.status='posted' AND EXISTS(SELECT 1 FROM pt_bank_accounts b WHERE b.account_id=l.account_id)),0) AS ledger_cents
    FROM pt_gusto_payrolls p CROSS JOIN pt_gusto g WHERE g.id=1`)
  const provider = payrolls.reduce((s,p)=>s+p.debit_cents,0), ledger = payrolls.reduce((s,p)=>s+p.ledger_cents,0)
  const payrollReasons = payrolls.filter(p=>p.status!=='booked'||p.debit_cents!==p.ledger_cents).map(p=>`${p.uuid}: ${p.reason || 'Payroll differs from its posted bank credits'}`)
  return [
    ...inventory.services.map(s=>({ id:s.id,name:s.name,status:s.connected?'Connected':'Not connected',reason:s.unavailable??s.detail,lastSync:null as string|null,objects:null as number|null,retry:null as string|null,tieOut:null as null|{label?:string;providerCents:number|null;ledgerCents:number;differenceCents:number|null;complete:boolean},
      ...(s.id==='stripe'&&stripe?{status:stripe.payouts_error?'Needs attention':'Connected',reason:stripe.payouts_error||clearing?.reason||s.detail,lastSync:stripe.payouts_synced_at,objects:clearing?.items.length??0,retry:stripe.payout_bank_account_id?'stripe.payouts-sync':null,tieOut:clearing?{label:'Stripe clearing balance',providerCents:clearing.providerCents,ledgerCents:clearing.ledgerCents,differenceCents:clearing.differenceCents,complete:clearing.complete}:null}:{}),
      ...(s.id==='gusto'&&gusto?{status:gusto.sync_error||payrollReasons.length?'Needs attention':'Connected',reason:gusto.sync_error||payrollReasons.join('; ')||s.detail,lastSync:gusto.synced_at,objects:payrolls.length,retry:gusto.bank_account_id?'gusto.sync':null,tieOut:{label:'Retained payroll debit observations',providerCents:provider,ledgerCents:ledger,differenceCents:ledger-provider,complete:!!gusto.synced_at&&!gusto.sync_error}}:{}),
    })),
    ...inventory.integrations.map(i=>({id:i.id,name:i.name,status:i.active?'Active':'Revoked',reason:'Scoped API credential; provider totals are not reported by this connection.',lastSync:null,objects:null,retry:null,tieOut:null})),
    ...inventory.unavailable.map(s=>({id:s.name,name:s.name,status:'Unavailable',reason:s.path,lastSync:null,objects:null,retry:null,tieOut:null})),
  ]
}
