import { openDatabase, closeDatabase } from '../src/store/db.js'
import { readEvents, countEvents } from '../src/store/event-store.js'
import { derive } from '../src/derive/derive.js'

const db = openDatabase({ path: process.argv[2], readOnly: true })
try {
  const all = readEvents(db, { includeForgotten: true })
  console.log('总事件: ' + countEvents(db))
  for (const e of all.slice(-6)) console.log('· [' + e.type + '] person=' + e.person + ' :: ' + e.content.slice(0, 80))
  const m = derive(all)
  console.log('derive: day=' + m.day + ' stage=' + m.stageName + ' beliefs=' + m.beliefs.length)
  console.log('topBeliefs: ' + JSON.stringify(m.topBeliefs.map(b => b.text.slice(0, 50))))
} finally { closeDatabase(db) }
