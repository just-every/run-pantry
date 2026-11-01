import { useState, type ReactNode } from 'react'
import { Action, Card, Chip, Loading, Table, command, useShared, useView, usd, type D } from './kit'
import { Fold } from './record-folds'

type W9View = { data?: D; error: string; reload: () => Promise<void> }

/** The vendor's W-9 status chip, as the summary and the fold row both show it. */
export function W9Chip({ status }: { status: string }) {
  return <Chip tone={status === 'complete' ? 'good' : 'warn'}>{status === 'complete' ? 'W-9 complete' : status === 'requested' ? 'W-9 requested' : 'W-9 missing'}</Chip>
}

/** W-9 status. On a vendor's own record it is the one fold, reading the view its summary already holds. */
export function VendorW9({ id, fold, view }: { id: string; fold?: boolean; view?: W9View }) {
  const { state } = useShared(),
    own = useView<D>(view ? null : `vendor-w9/${id}`),
    { data, error, reload } = view ?? own,
    [link, setLink] = useState('')
  const wrap = (children: ReactNode) => fold ? <Fold title="W-9 status">{children}</Fold> : <Card title="W-9 status">{children}</Card>
  return wrap(<>
      {!data ? (
        <Loading error={error} what="W-9 status" />
      ) : (
        <>
          {!fold && <W9Chip status={data.status} />}
          {data.completedAt && (
            <p>Certified {data.completedAt.slice(0, 10)}. Tax identity stays masked in ordinary views.</p>
          )}
          {state.actor.role === 'owner' && (
            <>
              <p>
                Generate a private link only when you intend to share it with this vendor. A new request
                closes the old link; each link expires after 14 days and after one submission. No email is
                sent automatically.
              </p>
              <Action
                run={async () => {
                  const r = await command('w9.request', { contactId: id, contactRevision: data.contactRevision, consent: true })
                  setLink(r.url)
                  await reload()
                }}
              >
                Create private W-9 request
              </Action>
              {link && (
                <p>
                  <a href={link} target="_blank" rel="noreferrer">
                    Open private W-9 request
                  </a>
                  <label>
                    Link to share
                    <input
                      aria-label="Private W-9 link"
                      readOnly
                      value={link}
                      onFocus={(e) => e.target.select()}
                    />
                  </label>
                </p>
              )}
              {data.request && (
                <Action
                  run={async () => {
                    await command('w9.revoke', { contactId: id })
                    setLink('')
                    await reload()
                  }}
                >
                  Close W-9 request
                </Action>
              )}
            </>
          )}
        </>
      )}
  </>)
}
export function MissingW9({ year }: { year: number }) {
  const { data, error } = useView<D>(`missing-w9?year=${year}`)
  return (
    <Card title="Vendors paid without a W-9">
      {!data ? (
        <Loading error={error} what="missing W-9 forms" />
      ) : (
        <Table heads={['Vendor', 'W-9 status']} empty="Every paid vendor has a certified W-9.">
          {data.vendors.map((v: D) => (
            <tr key={v.id}>
              <td>{v.name}</td>
              <td>{v.w9.status}</td>
            </tr>
          ))}
        </Table>
      )}
    </Card>
  )
}
