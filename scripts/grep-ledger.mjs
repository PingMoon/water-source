import { openDatabase, closeDatabase } from '../src/store/db.js'
import { readEvents } from '../src/store/event-store.js'

const db = openDatabase({ path: process.argv[2], readOnly: true })
try {
  const all = readEvents(db, { includeForgotten: true })
  for (const e of all.filter(x => /小泉/.test(x.content ?? ''))) {
    console.log(JSON.stringify({ type: e.type, person: e.person, source: e.source, content: String(e.content).slice(0, 80) }, null, 0))
  }
} finally { closeDatabase(db) }
