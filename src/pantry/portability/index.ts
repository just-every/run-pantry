import type { Context } from '../context'
import { requireThat, sha256, type Data } from '../core'
import { zip } from '../zip'
import { assertSnapshotStillClosed, originalFiles } from './archive'
import { recordFiles } from './files'
import { decimal } from './format'
import { qboPlan } from './qbo'
import { readSnapshot } from './read'
import { block, type ExportOptions } from './types'
import { requiredReferences, transportSchema } from './transport'
import { xeroPlan } from './xero'

export { resolveOperation } from './transport'
export { transportJson } from './format'
export type { ExportOptions, Operation, Destination } from './types'

const sources = {
  qbo: ['https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/journalentry', 'https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/invoice', 'https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/bill', 'https://developer.intuit.com/app/developer/qbo/docs/workflows/attach-images-and-other-notes', 'https://quickbooks.intuit.com/learn-support/en-global/help-article/import-export-files/common-questions-importing-data-quickbooks-online/L4OYJRFdj_ROW_en'],
  xero: ['https://developer.xero.com/documentation/api/accounting/invoices/', 'https://developer.xero.com/documentation/api/accounting/manualjournals/', 'https://developer.xero.com/documentation/api/accounting/banktransactions/', 'https://developer.xero.com/documentation/api/accounting/payments/', 'https://developer.xero.com/documentation/api/accounting/attachments/', 'https://central.xero.com/0/article/Import-a-chart-of-accounts?userregion=true'],
}

export async function destinationPackage(c: Context, options: ExportOptions) {
  const s = await readSnapshot(c, options), destination = options.destination
  const plan = destination === 'qbo' ? qboPlan(s) : xeroPlan(s)
  const keys = new Set(plan.operations.map(op => op.key)), mappingKeys = new Set(plan.mappings.map(m => m.key))
  const operations = plan.operations.map(op => ({ ...op, dependsOn: requiredReferences(op) }))
  for (const op of operations) for (const key of op.dependsOn) if (!keys.has(key) && !mappingKeys.has(key)) block(plan, op.source, `Required source resource ${key} has no supported create operation or explicit destination mapping.`)
  const originals = await originalFiles(c, s, plan, destination)
  const represented = new Set(operations.flatMap(op => op.journalIds)), missing = s.entries.filter(e => !represented.has(e.id))
  const balance = (tb: Data) => ({ asOf: tb.asOf, debitMinor: tb.debit, creditMinor: tb.credit, balanced: tb.balanced, accounts: tb.rows.map((r:Data) => ({ sourceId:r.id,code:r.code,name:r.name,debitMinor:r.debitBalance,creditMinor:r.creditBalance,netMinor:r.net })) })
  // Validate all amounts before delivering any JSON or CSV, including aggregate totals.
  for (const tb of [s.opening,s.closing]) { decimal(tb.debit); decimal(tb.credit); for (const r of tb.rows) { decimal(r.net); decimal(r.debitBalance); decimal(r.creditBalance) } }
  const manifest = {
    format: 'pantry-destination-export/1', destination, generatedAt: new Date().toISOString(),
    entity: { legalName:s.entity.legal_name,currency:s.entity.currency,fiscalYearStart:s.entity.fiscal_year_start,booksStart:s.entity.books_start },
    period: { year:s.year,from:s.start,to:s.end,basis:'accrual',transportFrom:s.entity.books_start,scope:'All posted history through year end, including prior years needed to reproduce the closing trial balance.' },
    close: s.periods.map(p => ({ id:p.id,status:p.status,revision:p.revision,lockedAt:p.locked_at })),
    openingTrialBalance: balance(s.opening), closingTrialBalance: balance(s.closing),
    openItems: { receivables:s.receivables,payables:s.payables },
    counts: { accounts:s.accounts.length,contacts:s.contacts.length,items:s.items.length,postedEntries:s.entries.length,postedLines:s.lines.length,openInvoices:s.receivables.items.length,openBills:s.payables.items.length,documents:s.documents.length },
    ledgerCoverage: { postedEntries:s.entries.length,representedEntries:represented.size,unrepresentedEntries:missing.map(e => e.id),unrepresentedAccountMinor:s.accounts.map(a => ({ sourceId:a.id,code:a.code,netMinor:s.lines.filter(l => l.account_id===a.id && !represented.has(l.entry_id)).reduce((n,l) => n+l.debit_cents-l.credit_cents,0) })).filter(a => a.netMinor!==0) },
    status: plan.blockers.length ? 'blocked' : 'requires-destination-mapping-and-verification',
    destinationVerified:false, blockers:plan.blockers, mappings:plan.mappings, documents:originals.inventory,
    verificationRequired: ['Read back destination trial balance by source account mapping at the export date; compare every debit and credit balance in minor units.', 'Read back each open invoice and bill remaining amount and all unapplied balances; compare the openItems manifest.', 'Read back uploaded original bytes and verify their SHA-256 against the document inventory.', 'Retain actual provider create and read response IDs and validation errors. Export generation is not provider acceptance.'],
    providerDocumentation:sources[destination],
  }
  const transport = { format:'pantry-destination-transport/1',destination,operations,mappings:plan.mappings,blockers:plan.blockers,attachments:originals.attachments }
  const files = [...recordFiles(s,destination,plan),...originals.files,
    { name:'transport/plan.json',data:JSON.stringify(transport,null,2) },
    { name:'transport/schema.json',data:JSON.stringify(transportSchema,null,2) },
    { name:'README.txt',data:[
      `${s.entity.legal_name}: ${destination.toUpperCase()} destination export for fiscal year ending ${s.end}.`,
      'All source money is integer USD cents. Transport $decimal values must become exact unquoted JSON decimal tokens; source JSON retains original text and integer amounts.',
      `Status: ${manifest.status}. There is no claim that a destination accepted this package. Resolve every blocker and mapping before financial ingestion.`,
      'transport/plan.json is the native provider request plan, in master, document, payment and journal order. Dependencies name actual IDs or codes from provider read or create receipts, never Pantry IDs.',
      'Read the existing destination chart before creating accounts. Explicitly map an existing account only when its code and financial class agree; otherwise resolve the conflict before ingestion. Skip create operations for master records explicitly mapped to an actual destination ID. Never rename or overwrite the destination chart automatically.',
      'Resolve {$ref:key} recursively using those receipts; resolve {ref:key} in URLs. QBO also needs the actual realmId. Serialize {$decimal:"1.23"} as 1.23 using transportJson. For Xero supply the actual xero-tenant-id header; for QBO use the sandbox host for sandbox evidence. Credentials are not included.',
      'Read responseId as a dot path (numeric components are array indexes), save under operation.key, and reject any provider ValidationErrors or Fault before proceeding. A successful HTTP status alone is insufficient.',
      'All posted history from books start is represented once by native invoices, bills, credits and payments or remaining journals. Import native requests OR the corresponding CSV resources, never both. journals.csv contains only supported remaining journal operations. source/postedEntries.json and source/postedLines.json preserve every posted entry including unsupported entries.',
      'CSV files use provider column names but require destination field, tax and account mapping and review of provider import limits. System and control accounts must map to existing destination accounts. Xero chart import can archive omitted destination accounts: review the full destination chart before confirming.',
      'Open invoice and bill CSVs contain original supported line amounts, not fabricated remaining-balance lines. Replay their actual payment and credit allocation operations to reproduce the remaining amounts in review/open-balances.csv. Do not import these CSVs again after native resource ingestion.',
      'CSV formula-leading text is prefixed with an apostrophe for spreadsheet safety; exact original names, memos and identifiers remain in source JSON. Use native transport for exact text when a CSV field was protected.',
      'Inactive catalog flags and all original quantities and tags remain in source JSON. Restore destination inactive status after historical ingestion if required; no source records are silently deleted.',
      'originals/ contains byte-for-byte source documents with verified sizes and SHA-256. transport attachments describe raw-byte Xero uploads or QBO multipart metadata and content parts after actual destination IDs exist.',
      'manifest.json lists hashes of all other files, opening and closing trial balances, full open-item tie-outs, selected-year closed period revisions, source coverage and unsupported-record blockers. Prior posted entry revisions are rechecked before release.',
      'Finish by reading destination trial balances, open-item balances and uploaded originals back and comparing them to the manifest. Keep the read receipts with the move-out evidence.',
      '',...sources[destination],''
    ].join('\r\n') },
  ]
  const encoder = new TextEncoder()
  const inventory = await Promise.all(files.map(async f => { const bytes = typeof f.data==='string' ? encoder.encode(f.data) : f.data; return { name:f.name,size:bytes.length,sha256:await sha256(bytes) } }))
  const fullManifest = { ...manifest, files:inventory }
  files.push({ name:'manifest.json',data:JSON.stringify(fullManifest,null,2) })
  await assertSnapshotStillClosed(c,s)
  return { manifest:fullManifest,transport,files,filename:`pantry-${destination}-${s.end}.zip` }
}

/** Native session transport entry point; authorization is repeated inside the public function. */
export async function destinationExport(c: Context, options: ExportOptions, format: 'zip' | 'json' = 'zip') {
  requireThat(format==='zip'||format==='json','Destination export format is zip or json')
  const result = await destinationPackage(c,options)
  if(format==='json') return new Response(JSON.stringify({ manifest:result.manifest,transport:result.transport },null,2),{ headers:{ 'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff' } })
  requireThat(result.files.length<=65535,'Archive exceeds the ZIP entry limit; use a destination export with fewer original files',409)
  return new Response(zip(result.files),{ headers:{ 'content-type':'application/zip','content-disposition':`attachment; filename="${result.filename}"`,'cache-control':'no-store','x-content-type-options':'nosniff','x-pantry-export-status':result.manifest.status } })
}
