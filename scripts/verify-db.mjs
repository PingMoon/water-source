/**
 * verify-db.mjs —— 故障注入用：检查账本是否还完整
 * node verify-db.mjs <dbPath>
 */
import { openDatabase, integrityCheck, closeDatabase } from '../src/store/db.js'
import { readEvents, countEvents } from '../src/store/event-store.js'
import { idTime } from '../src/util/ids.js'

const [, , dbPath] = process.argv
const db = openDatabase({ path: dbPath })
try {
  const integrity = integrityCheck(db)
  const events = readEvents(db, { includeForgotten: true })
  const ids = events.map((e) => e.id)
  const unique = new Set(ids).size === ids.length
  let monotonic = true
  for (let i = 1; i < ids.length; i++) if (ids[i] <= ids[i - 1]) { monotonic = false; break }
  const times = events.map((e) => idTime(e.id))
  let timeOk = true
  for (let i = 1; i < times.length; i++) if (times[i] < times[i - 1]) { timeOk = false; break }
  console.log(JSON.stringify({
    integrity: integrity.ok,
    problems: integrity.problems,
    count: countEvents(db),
    readable: events.length,
    unique,
    monotonic,
    timeOk
  }))
} finally { closeDatabase(db) }
