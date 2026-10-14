// Sections 2–7: eyebrow, heading, one or two lines, and one stoneware drawing, alternating sides.
import type { ReactNode } from 'react'
import { DocumentGlyph, Rule, Tag, Tile } from './parts'

type Feature = { id: string; eyebrow: string; title: string; body: string; drawing: ReactNode; ruleAfter?: boolean }

const FEATURES: Feature[] = [
  { id: 'free', eyebrow: 'Free', title: 'Free, and the books stay yours.', body: 'MIT licensed. Run it on your own computer and keep every record, receipt and approval.', ruleAfter: true,
    drawing: <Tile label="The MIT License, copyright 2026 Run Edit Run" className="tile-licence"><DocumentGlyph /><p className="tile-title strong">MIT License</p><p className="tile-foot">Copyright (c) 2026 Run Edit Run</p></Tile> },
  { id: 'agent', eyebrow: 'Agent work', title: 'Your agent prepares. You approve.', body: 'Point the agent you already use at Pantry. It proposes matches and entries with their evidence, and a person approves each one.',
    drawing: <Tile label="A match proposed by the bookkeeping agent: monthly service fee, minus $12.00, matched"><p className="tile-title strong">Match proposed by Bookkeeping agent</p><p className="tile-row"><span className="caps">MONTHLY SERVICE FEE</span><span className="figure-sm">−$12.00</span></p><p className="tile-end"><Tag>Matched</Tag></p></Tile> },
  { id: 'sales', eyebrow: 'Sales & bills', title: 'Invoices, bills and payments in one ledger.', body: 'Record what you bill and what you owe, and settle each with the payments you record.',
    drawing: <Tile label="Invoice INV-0001 for Cedar Studio, $2,400.00, paid; Brightline Software bill INV-88 with its receipt attached" className="tile-wide"><p className="tile-row"><span>Cedar Studio · <span className="nowrap">INV-0001</span> · <span className="nowrap">$2,400.00</span></span><Tag>Paid</Tag></p><p className="tile-row ruled-top"><span>Brightline Software · <span className="nowrap">INV-88</span></span><Tag>Attached</Tag></p></Tile> },
  { id: 'books', eyebrow: 'Books', title: 'Every correction stays on the record.', body: 'Posted entries never change. A reversal fixes a mistake and keeps both in the history.',
    drawing: <Tile label="An entry posted and reversed: debits $640.00 equal credits $640.00" className="tile-wide"><p><Tag>Posted and reversed</Tag></p><p className="figure-md"><Rule>Debits <span className="nowrap">$640.00</span> = Credits <span className="nowrap">$640.00</span></Rule></p></Tile> },
  { id: 'reports', eyebrow: 'Reports', title: 'The whole month in one download.', body: 'Trial balance, profit and loss, balance sheet, ageing and the general ledger, all from the same posted lines.', ruleAfter: true,
    drawing: <Tile label="Report tabs for trial balance, profit and loss and balance sheet, and the accountant package download" className="tile-wide"><p className="tile-tabs"><span className="current">Trial balance</span><span>Profit and loss</span><span>Balance sheet</span></p><p className="tile-center"><Tag>Download accountant package</Tag></p></Tile> },
  { id: 'move-in', eyebrow: 'Move in', title: 'Move in from QuickBooks Online.', body: 'Preview your exports and every tie-out first. Nothing posts until it is signed off.',
    drawing: <Tile label="Tie-outs: all match; import as staged records" className="tile-wide tile-tieouts"><p className="tile-title strong">Tie-outs</p><p><Tag><span className="tag-check" />All match</Tag></p><p className="ruled-top"><Tag tone="dark">Import as staged records</Tag></p></Tile> },
]

export function Features() {
  return <div className="features">
    {FEATURES.map((f, i) => <section key={f.id} id={f.id} className={`feature${i % 2 ? ' flip' : ''}${f.ruleAfter ? ' rule-after' : ''}`} aria-labelledby={`${f.id}-title`}>
      <div className="site-wrap feature-row">
        <div className="feature-copy"><p className="eyebrow">{f.eyebrow}</p><h2 id={`${f.id}-title`}>{f.title}</h2><p className="feature-body">{f.body}</p></div>
        <div className="feature-art">{f.drawing}</div>
      </div>
    </section>)}
  </div>
}
