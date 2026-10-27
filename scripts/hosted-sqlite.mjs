// D1-shaped access to a disposable local SQLite snapshot. Native SQLite avoids
// transporting the whole hosted SQL dump in one size-limited Worker RPC.
export function sqliteD1(database) {
  const value = v => v instanceof ArrayBuffer ? new Uint8Array(v) : v
  function statement(sql, params=[]) {
    const execute = () => database.prepare(sql).all(...params.map(value))
    return {
      bind: (...values) => statement(sql, values),
      async all() { return {results:execute(),success:true} },
      async first(column) { const row=execute()[0] ?? null; return column ? row?.[column] ?? null : row },
      async raw() { return execute().map(row=>Object.values(row)) },
      async run() { const results=execute(); return {results,success:true,meta:{changes:database.prepare('SELECT changes() AS n').get().n}} },
    }
  }
  return {prepare:statement,async batch(statements) {
    database.exec('BEGIN')
    try { const results=[]; for(const query of statements)results.push(await query.run()); database.exec('COMMIT'); return results }
    catch(error) { database.exec('ROLLBACK'); throw error }
  }}
}
