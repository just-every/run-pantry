// Owner credentials stay in the injected environment; provider bodies never
// become diagnostics. A batch is one provider transaction, never split here.

const failure = code => { throw new Error(code) }
const validId = value => typeof value === 'string' && /^[a-f0-9-]{32,36}$/i.test(value)

export function hostedProvider({ accountId, token, fetch: request = globalThis.fetch }) {
  if (typeof accountId !== 'string' || !/^[a-f0-9]{32}$/i.test(accountId) || typeof token !== 'string' || !token.trim()) failure('provider_credentials_required')
  return async (path, body) => {
    let response, payload
    try {
      response = await request(`https://api.cloudflare.com/client/v4/accounts/${accountId}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        redirect: 'error', signal: AbortSignal.timeout(60_000),
      })
      if (!response.ok) failure(response.status === 401 || response.status === 403 ? 'provider_access_refused' : 'provider_request_failed')
      payload = await response.json()
    } catch (error) {
      if (['provider_access_refused', 'provider_request_failed'].includes(error.message)) throw error
      failure('provider_request_failed')
    }
    if (payload?.success !== true || !Array.isArray(payload.result)) failure('provider_response_invalid')
    return payload
  }
}

export async function hostedDatabaseId(provider, name) {
  const matches = []
  for (let page = 1; ; page++) {
    const payload = await provider(`/d1/database?name=${encodeURIComponent(name)}&per_page=100&page=${page}`)
    matches.push(...payload.result.filter(row => row.name === name))
    if (payload.result.length < 100 || (Number.isInteger(payload.result_info?.total_pages) && page >= payload.result_info.total_pages)) break
    if (page >= 1000) failure('provider_inventory_incomplete')
  }
  if (matches.length !== 1 || !validId(matches[0].uuid)) failure('destination_database_not_unique')
  return matches[0].uuid
}

const parameter = value => {
  if (value instanceof ArrayBuffer) return Array.from(new Uint8Array(value))
  if (ArrayBuffer.isView(value)) return Array.from(new Uint8Array(value.buffer, value.byteOffset, value.byteLength))
  if (value === null || typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))) return value
  failure('unsupported_d1_parameter')
}

/** D1 binding contract over Cloudflare's authenticated administrative query API. */
export function hostedD1(provider, databaseId) {
  if (!validId(databaseId)) failure('destination_database_invalid')
  const records = new WeakMap()
  const execute = async (queries, batch) => {
    if (!queries.length) return []
    const encoded = queries.map(({ sql, params }) => ({ sql, params: params.map(parameter) }))
    const { result } = await provider(`/d1/database/${databaseId}/query`, batch ? { batch: encoded } : encoded[0])
    if (result.length !== queries.length || result.some(row => row.success !== true || !Array.isArray(row.results))) failure('provider_query_failed')
    return result.map(row=>({...row,results:row.results.map(value=>Object.fromEntries(
      Object.entries(value).map(([key,cell])=>[key,Array.isArray(cell)?Uint8Array.from(cell):cell])
    ))}))
  }
  function prepare(sql, params = []) {
    if (typeof sql !== 'string' || !sql.trim()) failure('invalid_d1_statement')
    const query = { sql, params }
    const statement = {
      bind: (...values) => prepare(sql, values),
      async all() { return (await execute([query], false))[0] },
      async first(column) {
        const row = (await statement.all()).results[0] ?? null
        return column === undefined ? row : row?.[column] ?? null
      },
      async run() { return (await execute([query], false))[0] },
      async raw({ columnNames = false } = {}) {
        const rows = (await statement.all()).results
        const values = rows.map(row => Object.values(row))
        return columnNames ? [Object.keys(rows[0] ?? {}), ...values] : values
      },
    }
    records.set(statement, query)
    return statement
  }
  return {
    prepare,
    async batch(statements) {
      const queries = statements.map(statement => records.get(statement))
      if (queries.some(query => !query)) failure('foreign_d1_statement')
      return execute(queries, true)
    },
  }
}
