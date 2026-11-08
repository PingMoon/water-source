/**
 * writer.mjs —— 故障注入用：拼命写，等着被杀
 * node writer.mjs <dbPath> <prefix> <count>
 */
import { openDatabase, closeDatabase } from '../src/store/db.js'
import { migrate } from '../src/store/migrations.js'
import { appendEvent } from '../src/store/event-store.js'

const [, , dbPath, prefix = 'w', count = '500'] = process.argv
const db = openDatabase({ path: dbPath })
migrate(db)
let written = 0
try {
  for (let i = 0; i < Number(count); i++) {
    appendEvent(db, { type: 'utterance', content: prefix + '#' + i })
    written++
  }
} catch (e) {
  console.log('writer error:', String(e?.message ?? e).slice(0, 120))
} finally {
  try { closeDatabase(db) } catch { /* ignore */ }
  console.log('writer done:', written)
}
