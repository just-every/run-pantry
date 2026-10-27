// Seed-owned projections of the existing contract parser; no Base pin change.
import { readFileSync, writeFileSync } from 'node:fs'
import { parseContract } from '../src/base/seed-contract.mjs'

const mode = process.argv[2]
if (!['write','check'].includes(mode)) throw new Error('Usage: node scripts/contract-docs.mjs write|check')
const original = readFileSync('CONTRACT.md','utf8')
const cells = line => line.replace(/^\|\s*|\s*\|$/g,'').split(/(?<!\\)\|/).map(cell=>cell.trim())
const rows = original.split('\n').filter(line=>/^\| `[A-Z][A-Z0-9-]+` \|/.test(line)).map(cells)
const tally = selected => ['done','partial','missing'].map(status=>selected.filter(row=>row[3]===status).length).concat(selected.length)
let source = original
for (const [label,selected] of [['Published',rows.filter(row=>row[2]==='published')],['Target and push further',rows.filter(row=>row[2]!=='published')],['All',rows]]) {
  source = source.replace(new RegExp(`^\\| ${label} \\|.*$`,'m'),`| ${label} | ${tally(selected).join(' | ')} |`)
}
const contract = parseContract(source)
const evidence = new Map(rows.map(row=>[row[0].replaceAll('`',''),row[4]]))
const safeProse = text => text.split(/(`[^`]*`)/).map(part => part.startsWith('`') ? part : part.replace(/(?<![\w./:-])([A-Za-z][\w-]*)\/([A-Za-z][\w-]*)(?![\w./:-])/g,'$1&#47;$2')).join('')
const escape = text => safeProse(text).replaceAll('|','\\|').replace(/\s*\n\s*/g,' ')
const acceptance = '# Pantry acceptance record\n\nGenerated from [CONTRACT.md](CONTRACT.md). Edit the contract, then run `node scripts/contract-docs.mjs write`.\n\n' +
  `**Status: ${contract.counts.done} of ${contract.counts.total} clauses done, ${contract.counts.partial} partial, ${contract.counts.missing} missing.**\n\n` +
  '| Clause | Acceptance evidence | Proof | Status | Gap |\n| --- | --- | --- | --- | --- |\n' +
  contract.clauses.map(clause => `| ${clause.id} | ${escape(clause.text.split('**Acceptance evidence:**')[1] ?? clause.text)} | ${safeProse(evidence.get(clause.id) || '')} | ${clause.status} | ${escape(clause.gap)} |`).join('\n') + '\n'
const homepage = source.split('## Homepage claims\n')[1].split('\n## Status')[0]
const claimRows = homepage.split('\n').filter(line=>/^\| \d+ \|/.test(line)).map(cells)
const claims = '# Pantry homepage claims and proof\n\nGenerated from the Homepage claims and Status sections of [CONTRACT.md](../CONTRACT.md). Homepage text is unchanged.\n\n' +
  '| # | Section | Claim | Clauses | Status | Code and proof |\n| --- | --- | --- | --- | --- | --- |\n' +
  claimRows.map(row => {
    const ids = row[3].split(/,\s*/)
    return `| ${row.map(safeProse).join(' | ')} | ${[...new Set(ids.map(id=>evidence.get(id)).filter(Boolean))].map(safeProse).join('; ')} |`
  }).join('\n') + '\n'
for (const [path, expected] of [['CONTRACT.md',source],['ACCEPTANCE.md',acceptance],['docs/CLAIMS.md',claims]]) {
  if (mode==='write') writeFileSync(path,expected)
  else if (readFileSync(path,'utf8')!==expected) throw new Error(`${path} is stale; run node scripts/contract-docs.mjs write`)
}
console.log(`contract-docs ${mode}: ${contract.counts.total} clauses; ${contract.counts.done} done, ${contract.counts.partial} partial, ${contract.counts.missing} missing`)
