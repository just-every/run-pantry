# Pantry contract rulings

## ACCT-001 — 27 October 2026

ct-scope-pantry-acct001-20261027-2830 reviewed candidate `cf58f5b4ac6c3161bfa40236d36cd39bdceee13e` at 17:57:19 UTC: APPROVE WITH RIDERS; STAYS PARTIAL. The manual connection is approved interim policy. It accepts no completion.

Approved policy:

The approved interim connection policy is owner-only explicit audited read-only status sharing to named active accountants. Owner-only controls authorization; it does not impose a single-accountant limit. The owner may authorize several individually identified staff from an accountant firm, approving each separately until scoped firm delegation is available. Each connection uses an exact owner-trusted client origin. A random status key expires no later than twenty-four hours after issue; the client stores only its hash, and membership changes or revocation invalidate it. Console credentials are encrypted and excluded from archives. Status sharing exposes no amounts or record text and suppresses aggregate status for restricted bank readers. Opening books requires the accountant’s own trusted identity and the client’s current role and grants; a status key supplies neither a session nor additional permission. Owner-authorized multi-user firm access, scoped firm-administrator delegation and automatic discovery of invited installations remain required ACCT-001 scope.

Retain the original acceptance evidence and append:

Authorize two named staff from one accountant firm across three client installations with different grants. Each staff member uses their own identity, opens authorized books without the owner’s login, and retains each client’s grants. Refuse uninvited staff, staff from another firm and actions outside the current grants. Under the interim connection, refuse status sharing by a non-owner, an untrusted origin, an expired key, a changed membership or a revoked grant. Verify hashed client-side key storage, encrypted console credentials excluded from archives, no amounts or record text, and suppressed aggregate status for restricted bank readers. A status key cannot authenticate a books session or authorize a write. Prove that an owner-designated firm administrator can manage named staff only within the owner-authorized firm, clients, roles and grants, with audited changes and revocation and no expansion of authority. After one trusted OIDC sign-in, discover the installations that invited the accountant without manually entering a status key for each client; an uninvited installation is absent, and removal of an invitation removes the client and denies further access.

Remaining Gap:

ACCT-001: Automatic discovery of invited installations without manual per-client status keys remains unimplemented. Owner-authorized access for an accountant firm with several named staff and audited firm-administrator delegation within client-specific roles and grants remain unproved. The manual owner-approved connection is an approved interim policy, not fulfillment of those obligations. Exact-candidate proof of the complete invitation, delegation, refusal and revocation journeys remains outstanding. Local journeys do not establish production identity-provider interoperability or applicable confidentiality and data-processing compliance; no provider acceptance or legal compliance is claimed.
