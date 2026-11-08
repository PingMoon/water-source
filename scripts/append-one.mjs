/**
 * append-one.mjs —— 故障注入用：崩溃之后还能不能接着写
 * node append-one.mjs <dbPath>
 */
import { createWhale } from '../src/core/service.js'

const dbPath = process.argv[2]
const w = createWhale({ dbPath, tools: ['fs.read', 'fs.write', 'shell.run'], templateId: 'tp-default' })
try {
  const boot = w.boot()
  w.append({ type: 'utterance', content: 'crash 之后写的' })
  console.log(JSON.stringify({ ok: boot.ok, eventsAfter: w.read({}).length }))
} catch (e) {
  console.log(JSON.stringify({ ok: false, error: String(e?.message ?? e).slice(0, 150) }))
} finally {
  w.close()
}
