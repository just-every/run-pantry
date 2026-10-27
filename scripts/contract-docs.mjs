// Seed-owned projections of the acceptance source; no Base refresh is needed.
import {existsSync,readFileSync,writeFileSync} from 'node:fs'
import {parseContract} from '../src/base/seed-contract.mjs'
const mode=process.argv[2]
if(!['write','check'].includes(mode))throw Error('Use: node scripts/contract-docs.mjs write or check')
const original=readFileSync('CONTRACT.md','utf8'),lines=original.split('\n')
const rows=lines.filter(l=>/^\| `[^`]+` \|/.test(l)).map(l=>l.split('|').slice(1,-1).map(c=>c.trim())).filter(c=>['published','target','push-further'].includes(c[2]))
const tally=selected=>['done','partial','missing'].map(status=>selected.filter(r=>r[3]===status).length)
const summaries=new Map([['Published',rows.filter(r=>r[2]==='published')],['Target and push further',rows.filter(r=>r[2]!=='published')],['All',rows]])
const contract=lines.map(line=>{
 const label=/^\| (Published|Target and push further|All) \|/.exec(line)?.[1]
 if(!label)return line
 const selected=summaries.get(label)
 return `| ${label} | ${tally(selected).join(' | ')} | ${selected.length} |`
}).join('\n')
const parsed=parseContract(contract),sourceLines=contract.split('\n')
const prose=text=>text.split(/(`[^`]*`|\[[^\]]*\]\([^)]*\)|https?:\/\/[^\s)]+)/g).map((part,index)=>{
 if(index%2) {
  if(part.startsWith('`')) {
   const path=part.slice(1,-1)
   if(path.includes('/') && !path.startsWith('.') && !path.startsWith('/') && existsSync(path))return '`./'+path+'`'
  }
  return part
 }
 return part.replace(/(?<=[A-Za-z0-9_-])\/(?=[A-Za-z0-9_-])/g,'&#47;')
}).join('')
const escape=text=>prose(text).replace(/(?<!\\)\|/g,'\\|').replace(/\r?\n/g,' ')
const rowFor=clause=>sourceLines[clause.row-1].split(/(?<!\\)\|/).slice(1,-1).map(c=>c.trim())
const {done,partial,missing,total}=parsed.counts
const acceptance=[
 '# Pantry acceptance record','',
 'Generated from [CONTRACT.md](CONTRACT.md) with `node scripts/contract-docs.mjs write`. Edit the source, then regenerate.','',
 `**Status: ${done} of ${total} clauses done, ${partial} partial, ${missing} missing.**`,'',
 '| Clause | Acceptance and inherited duties | Evidence | Status | Gap |',
 '| --- | --- | --- | --- | --- |',
 ...parsed.clauses.map(c=>{const row=rowFor(c);return `| ${c.id} | **${escape(c.title)}.** ${escape(c.text)} | ${prose(row[4])} | ${c.status} | ${prose(row[5])} |`}),''
].join('\n')
const claimsSource=contract.match(/^## Homepage claims\n([\s\S]*?)(?=^## )/m)?.[1]
if(!claimsSource)throw Error('CONTRACT.md must retain its homepage claim register')
const claims=['# Pantry homepage claims','',
 'Generated from the Homepage claims section in [CONTRACT.md](../CONTRACT.md) with `node scripts/contract-docs.mjs write`. The source retains the claim wording, clause links and current scope.','',prose(claimsSource.trim()),''].join('\n')
for(const [path,value] of [['CONTRACT.md',contract],['ACCEPTANCE.md',acceptance],['docs/CLAIMS.md',claims]]) {
 if(mode==='write')writeFileSync(path,value)
 else if(readFileSync(path,'utf8')!==value)throw Error(`${path} is stale; run node scripts/contract-docs.mjs write`)
}
console.log(`Contract projections ${mode==='write'?'written':'current'}: ${done} done, ${partial} partial, ${missing} missing`)
