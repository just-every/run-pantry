# Accountant client status

The accountant console is under People & settings. It currently connects clients
through explicit status sharing. It does not yet discover invitations automatically. A trusted OIDC provider can
serve the accountant across clients without another identity-provider sign-in.

The installation owner sets `PANTRY_ACCOUNTANT_CLIENTS` to a comma-separated list
of exact trusted HTTPS client origins in the Worker configuration. The default
is empty. Local HTTP origins are accepted only for a local installation on a
loopback host. Redirects are refused. This setting grants no access by itself.

At each client, the owner first adds the accountant under People with that
client's role and grants. Under Accountant console, expand Share this client's
status, choose the accountant and select Share client status. Give the one-day
key privately to that person. Show key reveals it only on that page. Sharing a
new key replaces the old one. Revoke status sharing stops it immediately.

The accountant opens Connect a client in their own console, chooses a trusted
client origin, enters that client's status key and selects Connect client.
The console verifies the named recipient before keeping the encrypted key.
Only that signed-in person can read or remove their saved connections.

The current status reuses the native dashboard current-through date and the
overview queues, including invoices, unmatched bank lines, reopen requests and
bills awaiting approval. It shows open questions, the last close lock and current
grants. It carries no amounts, original records or bank numbers.
Restricted bank readers receive no aggregate counts. Status refreshes every
thirty seconds, when the window regains focus and with Refresh client status.
A revoked, expired or changed membership disappears on the next refresh;
a transport failure is shown separately with no retained status snapshot.

Open books uses the client's native sign-in. The status key cannot open books,
post a journal or grant a permission. Each client enforces its own current grants.
Disconnect removes the console connection. Credential rows do not travel in
ordinary archives; after restoring, owners must explicitly share status again.

## Shared OIDC sign-in

Each installation can keep its existing Auth dependency, or its owner can supply
`PANTRY_OIDC_PROVIDERS` as a private JSON array using the native provider
configuration documented in [the identity adapter](../src/modules/operator-auth/identity/oidc/README.md).
Set an independent `OIDC_TRANSACTION_SECRET` of at least 32 characters. Neither
setting is a public Worker variable. Client credentials stay in Worker secrets.
The default provider list is empty; configuring a provider grants no book access.

Register each installation's callback with the same trusted issuer. The owner
explicitly enables provider sign-in under the native sign-in security settings
at `/auth/settings/identity`. An invited accountant then uses Continue with the
provider at each installation. The issuer's session serves subsequent clients,
while each installation verifies its own code, state, nonce, token audience and
current invitation before creating its native session. The client's role and
grants remain local. Open books opens a new tab and uses that native session.
