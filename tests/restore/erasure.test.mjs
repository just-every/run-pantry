// Erasure fences before and after reset, through the same documented commands.
import test from 'node:test'
import { erasureRestore } from './journey.mjs'

test('ERASURE-001 restored books retain redactions and known erasures fence older archives', erasureRestore)
