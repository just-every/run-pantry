import test from 'node:test'
import { autopayJourney } from './autopay-journey.mjs'
import { textingJourney } from './texting-journey.mjs'

test('Saved methods authorize recurring charges, retry confirmed declines and stop on revocation', autopayJourney)
test('Consented invoice texts retain outcomes, honor quiet hours and stop immediately on opt-out', textingJourney)
