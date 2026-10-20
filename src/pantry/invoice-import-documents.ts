// Opening invoices imported from another system do not pass invoice.issue.
// Retain their imported open balance inside the same import-kit write batch.
import { q, type Sql } from './db'
export function importedInvoiceDocument(id: string): Sql[] {
  return [q(`INSERT INTO pt_invoice_documents (invoice_id,issued_revision,document,retained_at,basis)
    SELECT i.id, i.revision, json_object(
      'business', COALESCE((SELECT legal_name FROM pt_entity WHERE id = 1), 'Pantry'),
      'title', 'Invoice ' || i.number,
      'facts', json_array(json_array('Billed to', c.name),json_array('Issued', i.issue_date),json_array('Due', i.due_date)),
      'lines', json_array(json_object('description','Opening balance imported from the previous system','quantity','1','amount',printf('$%.2f',i.total_cents/100.0))),
      'totals', json_array(json_array('Total',printf('$%.2f',i.total_cents/100.0)),json_array('Amount due',printf('$%.2f',i.total_cents/100.0))),
      'notes', json_array(i.memo), 'layout','classic','accentColor','#433b65','textColor','#202234','logo',NULL,'templateId','standard','templateName','Imported opening invoice'),
      strftime('%Y-%m-%dT%H:%M:%fZ','now'), 'import'
    FROM pt_invoices i JOIN pt_contacts c ON c.id=i.customer_id
    WHERE i.id=? AND i.status='issued' AND i.opening=1
    ON CONFLICT(invoice_id) DO NOTHING`, id),
    q("UPDATE pt_invoices SET issued_document_revision = revision WHERE id = ? AND status = 'issued' AND opening = 1", id)]
}
