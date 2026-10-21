// Local diagnostics read only receipt IDs, never personal rows or credentials.
import {readdir} from 'node:fs/promises'
import {join} from 'node:path'
import {DatabaseSync} from 'node:sqlite'
export async function knownErasureIds(root) {
  const directory=join(root,'.wrangler','state','v3','d1'),ids=[]
  async function visit(path) {
    let entries
    try {entries=await readdir(path,{withFileTypes:true})}catch(error){if(error.code==='ENOENT')return;throw error}
    for(const entry of entries) {
      const file=join(path,entry.name)
      if(entry.isDirectory())await visit(file)
      else if(entry.isFile()&&entry.name.endsWith('.sqlite')) {
        const db=new DatabaseSync(file,{readOnly:true})
        try {
          if(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='pt_erasure_journal'").get())
            ids.push(...db.prepare('SELECT id FROM pt_erasure_journal ORDER BY at').all().map(r=>r.id))
        }finally{db.close()}
      }
    }
  }
  await visit(directory)
  return [...new Set(ids)].filter(id=>/^[A-Za-z0-9_-]{1,100}$/.test(id))
}
