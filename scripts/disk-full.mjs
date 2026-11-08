/**
 * disk-full.mjs —— 用 PRAGMA max_page_count 模拟磁盘写满
 * node disk-full.mjs <dbPath>
 */
import { openDatabase } from '../src/store/db.js'
import { migrate } from '../src/store/migrations.js'
import { appendEvent } from '../src/store/event-store.js'

const db = openDatabase({ path: process.argv[2] })
migrate(db)
db.exec('PRAGMA max_page_count = 64')
let ok = 0
let err = null
try {
  for (let i = 0; i < 5000; i++) {
    appendEvent(db, { type: 'utterance', content: 'x'.repeat(500) })
    ok++
  }
} catch (e) {
  err = String(e?.message ?? e).slice(0, 160)
}
console.log(JSON.stringify({ wroteBeforeFail: ok, threw: Boolean(err), error: err }))
db.close()
