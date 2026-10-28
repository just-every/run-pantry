// Backup, fresh restore and start-over through the documented rer commands.
import test from 'node:test'
import { roundTripRestore } from './journey.mjs'

test('BILL-001/INVOICE-001/AUDIT-001/REPORT-006/ERASURE-001 books and receipts restore, occupied books stay protected, and known erasures fence older archives', roundTripRestore)
