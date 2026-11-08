import { openDatabase, closeDatabase } from '../src/store/db.js'
import { readEvents, countEvents } from '../src/store/event-store.js'

const db = openDatabase({ path: process.argv[2], readOnly: true })
try {
  const all = readEvents(db, { includeForgotten: true })
  console.log('总事件: ' + countEvents(db))
  for (const e of all.slice(-6)) {
    console.log('· [' + e.type + '] person=' + e.person + ' source=' + e.source + ' :: ' + e.content.slice(0, 70))
  }
} finally { closeDatabase(db) }
