import { useState } from 'react'
import { Action, Card, Chip, Loading, Table, command, useShared, useView, usd, type D } from './kit'
export function VendorW9({ id }: { id: string }) {
  const { state } = useShared(),
    { data, error, reload } = useView<D>(`vendor-w9/${id}`),
    [link, setLink] = useState('')
  return (
    <Card title="W-9 status">
      {!data ? (
        <Loading error={error} what="W-9 status" />
      ) : (
        <>
          <Chip tone={data.status === 'complete' ? 'good' : 'warn'}>
            {data.status === 'complete'
              ? 'W-9 complete'
              : data.status === 'requested'
                ? 'W-9 requested'
                : 'W-9 missing'}
          </Chip>
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
                  const r = await command('w9.request', { contactId: id, consent: true })
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
    </Card>
  )
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
