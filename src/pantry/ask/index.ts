import type { Context } from '../context'
import { financialSourceAllowed } from '../access-policy/doors'
import { reportBasis } from '../basis'
import { requireThat, text, type Data } from '../core'
import { all } from '../db'
import { profitAndLoss, generalLedger } from '../reports'

const months = ['january','february','march','april','may','june','july','august','september','october','november','december']
const bounds = (year:number,month:number,count=1) => ({from:`${year}-${String(month).padStart(2,'0')}-01`,to:new Date(Date.UTC(year,month+count-1,0)).toISOString().slice(0,10)})
/** A bounded language interpreter, with arithmetic and citations from native reports only. */
export async function askBooks(c:Context, raw:unknown, selectedBasis?:unknown) {
  requireThat(financialSourceAllowed(c.actor,'profit-and-loss'), 'Book questions require access to full financial reports',403)
  const question=text(raw,'Question',1000), input=question.toLowerCase(), basis=await reportBasis(c.db,selectedBasis)
  const years=[...input.matchAll(/\b([12]\d{3})\b/g)].map(m=>Number(m[1]))
  requireThat(years.length<=1,'Use one year and say last year for an annual comparison')
  const year=years[0]??new Date().getUTCFullYear()
  requireThat(year>=2000&&year<=2099,'Choose a year from 2000 through 2099')
  const quarter=input.match(/\bq([1-4])\b/), month=months.findIndex(m=>new RegExp('\\b'+m+'\\b').test(input))
  const contractors=/contractor/.test(input), net=/net income|profit/.test(input)
  requireThat(!(contractors&&net),'Ask about one metric at a time')
  requireThat(contractors||net,'Ask about contractor spending or net income, with a month or quarter and optional year. Other questions are not supported yet.')
  requireThat(!!quarter||month>=0,'Name a month or quarter so the report range is explicit')
  const range=bounds(year,quarter?(Number(quarter[1])-1)*3+1:month+1,quarter?3:1)
  const prior=/last year|prior year/.test(input)?bounds(year-1,quarter?(Number(quarter[1])-1)*3+1:month+1,quarter?3:1):bounds(quarter ? (Number(quarter[1])===1?year-1:year) : month===0?year-1:year,quarter ? (Number(quarter[1])===1?10:(Number(quarter[1])-2)*3+1) : month===0?12:month,quarter?3:1)
  const ranges=[range,prior], figures:Data[]=[], citations:Data[]=[]
  const accounts=contractors?await all(c.db,"SELECT id,name FROM pt_accounts WHERE type='expense' AND lower(name) LIKE '%contract%'"):[]
  const accountIds=accounts.map(a=>a.id)
  for(const r of ranges) {
    const report=await profitAndLoss(c.db,r.from,r.to,basis)
    const ledger=await generalLedger(c.db,r.from,r.to,undefined,basis)
    const relevant=ledger.accounts.filter(a=>contractors?accountIds.includes(a.id):['income','expense'].includes(a.type))
    const lines=relevant.flatMap(a=>a.rows.map((l:Data)=>({entryId:l.entry_id,accountId:a.id,accountName:a.name,date:l.entry_date,memo:l.entry_memo,amountCents:(l.debit_cents-l.credit_cents)*(contractors?1:-1),href:`/app/reports?record=${encodeURIComponent("entry:"+l.entry_id)}&basis=${basis}`})))
    const amountCents=contractors?report.expenses.filter((a:Data)=>accountIds.includes(a.id)).reduce((s:number,a:Data)=>s+a.amount,0):report.netIncome
    figures.push({...r,amountCents,records:lines.length,lines})
    const query=new URLSearchParams({report:'profit-and-loss',...r,basis})
    citations.push({label:`Profit and loss · ${r.from} to ${r.to} · ${basis} basis`,href:'/app/reports?'+query,query:{report:'profit-and-loss',...r,basis}})
  }
  const movements = [...new Set(figures.flatMap(f=>f.lines.map((l:Data)=>l.accountId)))].map(id=>{ const current=figures[0].lines.filter((l:Data)=>l.accountId===id).reduce((s:number,l:Data)=>s+l.amountCents,0), previous=figures[1].lines.filter((l:Data)=>l.accountId===id).reduce((s:number,l:Data)=>s+l.amountCents,0); return {accountId:id,accountName:figures.flatMap(f=>f.lines).find((l:Data)=>l.accountId===id)?.accountName,currentCents:current,previousCents:previous,changeCents:current-previous} }).sort((a,b)=>Math.abs(b.changeCents)-Math.abs(a.changeCents))
  const comparisonAvailable=figures.every(f=>f.records>0)
  const definition={name:question,source:'profit-and-loss',...range,basis,comparison:/last year|prior year/.test(input)?'prior-year':'prior-period',...(contractors?{filters:{accountIds}}:{})}
  return {generated:true,question,basis,metric:contractors?'Contractor expense accounts':'Net income',scope:contractors?`Expense accounts containing "contract": ${accounts.map(a=>a.name).join(', ')||'none'}`:'Posted income less expenses; the change is explained by account movements, not an inferred cause.',status:figures[0].records?'answered':'no records',figures,citations,movements:comparisonAvailable?movements:[],changeCents:comparisonAvailable?figures[0].amountCents-figures[1].amountCents:null,definition}
}
