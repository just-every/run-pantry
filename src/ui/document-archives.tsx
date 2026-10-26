import { useRef, useState } from 'react'
import { Action, Card, Field, Form, Loading, Table, command, useView, type D } from './kit'

const providers = ['quickbooks-online', 'xero', 'freshbooks', 'hubdoc', 'dext']
const kinds = ['invoice', 'bill', 'journal', 'payment', 'statement', 'history']
const hashStyle = { overflowWrap: 'anywhere', wordBreak: 'break-word', whiteSpace: 'normal' } as const
async function original(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer())
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return { name: file.name, mediaType: file.type, base64: btoa(binary) }
}

export function DocumentArchives() {
  const v = useView<D>('document-archives'), [preview, setPreview] = useState<D | null>(null), [batch, setBatch] = useState<D | null>(null)
  const manifestInput = useRef<HTMLInputElement>(null), originalsInput = useRef<HTMLInputElement>(null), zipInput = useRef<HTMLInputElement>(null)
  const clearPreview = () => { setPreview(null); setBatch(null) }
  if (!v.data) return <Loading error={v.error} what="archive originals" />
  const data = v.data
  return <>
    <Card title="Document archive originals">
      <p>Choose a vendor ZIP, or a manifest and its extracted originals. Exact source IDs link moved records; unmatched files wait for your placement. Originals remain until you erase them.</p>
      <Form label="Preview archive batch" submit={async (form: D) => {
        clearPreview()
        const manifestFile = manifestInput.current?.files?.[0], zipFile = zipInput.current?.files?.[0]
        const manifest = manifestFile ? { name: manifestFile.name, content: await manifestFile.text() } : undefined
        const files = await Promise.all(Array.from(originalsInput.current?.files ?? []).map(original))
        if (!zipFile && (!manifest || !files.length)) throw Error('Choose a vendor ZIP, or a manifest and its extracted original files')
        const p: D = { ...(zipFile ? { zip: await original(zipFile) } : { files }), ...(manifest ? { manifest } : {}) }
        // JSON manifests can carry their own provider. CSV manifests and ZIPs
        // without embedded provider metadata use the provider selected here.
        const declared = manifest && /\.json$/i.test(manifest.name) ? JSON.parse(manifest.content).provider : null
        if (!declared) p.provider = form.provider
        if (form.archiveKey) p.archiveKey = form.archiveKey
        const result = await command('archive.preview', p)
        setPreview(result); setBatch(p)
      }}>
        <div onChange={clearPreview}>
          <Field label="Archive provider" name="provider" options={providers.map(value => ({ value, label: value }))} />
          <Field label="Export identity (optional for ZIP)" name="archiveKey" />
          <div className="field"><label htmlFor="archive-zip">Vendor ZIP archive</label><input ref={zipInput} id="archive-zip" name="zip" type="file" accept=".zip,application/zip" /></div>
          <div className="field"><label htmlFor="archive-manifest">Archive manifest</label><input ref={manifestInput} id="archive-manifest" name="manifest" type="file" accept=".json,.csv" /></div>
          <div className="field"><label htmlFor="archive-originals">Extracted original files</label><input ref={originalsInput} id="archive-originals" name="originals" type="file" multiple /></div>
        </div>
      </Form>
      <details><summary>Archive file requirements</summary><p>Each batch holds at most 100 originals and 8 MB. ZIPs can contain manifest.json, attachments.json, documents.json, or their CSV equivalents. Manifest rows name the exact file path and document source ID; transaction source system, transaction source ID and record type are optional. Unlisted originals wait for owner placement. Paths and filenames only locate files.</p></details>
      <p><a href="/api/pantry/document-archives">Download the private move-in journal as JSON</a>. The format is documented in the move-in guide.</p>
      {preview && <>
        <Table heads={['Original', 'Source ID', 'SHA-256', 'Placement']}>{preview.files.map((f: D) => <tr key={f.sourceId}>
          <td>{f.path || f.name} · {f.size} bytes</td><td>{f.sourceId}</td><td><code style={hashStyle}>{f.sha256}</code></td>
          <td>{f.linkedId ? <>{f.kind} · {f.linkedId}<br />{f.mappingSource}</> : <>Needs placement{f.mappingSource === 'ambiguous-source-id' && <div>Several exact source-ID matches; owner placement required.</div>}</>}</td>
        </tr>)}</Table>
        <Action run={async () => { await command('archive.import', { ...batch, fingerprint: preview.fingerprint }); clearPreview(); await v.reload() }}>Import reviewed originals</Action>
      </>}
    </Card>
    <Card title="Unlinked archive originals">
      <Table heads={['Original', 'Export source', 'Place on a transaction']} empty="Every imported original is placed.">{data.unlinked.map((f: D) => <tr key={f.id}>
        <td><a href={'/api/pantry/documents/' + f.document_id}>{f.name}</a></td><td>{f.source_system} · {f.transaction_source_id || f.source_id}</td>
        <td><Form label="Place original" submit={async (form: D) => {
          await command('archive.place', { id: f.id, revision: f.revision, kind: form.kind, targetId: form.targetId, sourceSystem: form.sourceSystem, transactionSourceId: form.transactionSourceId }); await v.reload()
        }}>
          <Field label="Transaction type" name="kind" options={kinds.map(value => ({ value, label: value }))} />
          <Field label="Pantry transaction ID" name="targetId" required />
          <Field label="Transaction source system (optional)" name="sourceSystem" defaultValue={f.source_system} />
          <Field label="Transaction source ID (optional)" name="transactionSourceId" defaultValue={f.transaction_source_id} />
        </Form></td>
      </tr>)}</Table>
    </Card>
    <Card title="Archive move-in journal">
      <Table heads={['Provider / export', 'Original count', 'Bytes', 'Hashes']} empty="No archive originals imported.">{data.archives.map((a: D) => <tr key={a.id}>
        <td>{a.provider} · {a.archive_key}</td><td>{a.file_count}</td><td>{a.byte_count}</td><td>{data.files.filter((f: D) => f.archive_id === a.id).map((f: D) => <div key={f.id}>{f.name}: <code style={hashStyle}>{f.sha256}</code>{f.erased_at && ' · Owner erased original'}</div>)}</td>
      </tr>)}</Table>
    </Card>
    <Card title="Confirmed transaction source IDs">
      <Table heads={['Source system', 'Record type', 'Exact source ID', 'Pantry record', 'Confirmed by']} empty="No transaction source-ID mappings confirmed.">{data.links.map((link: D) => <tr key={JSON.stringify([link.source_system, link.source_kind, link.source_id])}>
        <td>{link.source_system}</td><td>{link.source_kind}</td><td>{link.source_id}</td><td>{link.target_id}</td><td>{link.confirmed_by}</td>
      </tr>)}</Table>
    </Card>
  </>
}
