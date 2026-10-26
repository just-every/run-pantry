import { all, q, type Sql } from '../db'

/** Disable standing authority before removing customer communication copies. */
export async function erasePaymentMessaging(db: D1Database, customerId: string, at: string) {
  const statements: Sql[] = [
    q("UPDATE pt_autopay_policies SET enabled=0,purpose='[erased]',customer_binding='{}',owner_id='' WHERE customer_id=?", customerId),
    q("UPDATE pt_autopay_setups SET status='revoked',mandate_text='[erased]',accepted_ip='[erased]',stripe_customer='' WHERE customer_id=?", customerId),
    q('UPDATE pt_contacts SET autopay_payment_method=NULL,autopay_stripe_customer=NULL,autopay_mandate_id=NULL,autopay_revoked_at=?,autopay_mandate_text=NULL,autopay_accepted_ip=NULL WHERE id=?', at, customerId),
    q("UPDATE pt_autopay_notices SET recipient='[erased]:'||id,subject='[erased]',detail='[erased]',status=CASE WHEN status IN('queued','sending') THEN 'cancelled' ELSE status END WHERE attempt_id IN(SELECT id FROM pt_autopay_attempts WHERE customer_id=?)", customerId),
    q("UPDATE pt_text_messages SET phone='[erased]:'||id,body='[erased]',actor_email='[erased]',detail='[erased]',status=CASE WHEN status IN('held','sending') THEN 'cancelled' ELSE status END,not_before=NULL WHERE customer_id=?", customerId),
    q("UPDATE pt_text_shares SET phone='[erased]:'||id,body='[erased]',actor_email='[erased]' WHERE customer_id=?", customerId),
  ]
  const phones = await all(db, 'SELECT phone FROM pt_text_consents WHERE customer_id=?', customerId)
  for (const {phone} of phones) statements.push(q('DELETE FROM pt_text_blocks WHERE phone=?', phone),q('DELETE FROM pt_text_inbound WHERE phone=?', phone))
  statements.push(q('DELETE FROM pt_text_consents WHERE customer_id=?', customerId))
  return statements
}
