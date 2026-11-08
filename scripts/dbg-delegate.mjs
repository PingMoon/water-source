import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase, closeDatabase } from '../src/store/db.js'
import { migrate } from '../src/store/migrations.js'
import { registerNode } from '../src/team/pool.js'
import { createDelegate } from '../src/plugin/delegate.js'

const dir = mkdtempSync(join(tmpdir(), 'dbg-'))
const db = openDatabase({ path: join(dir, 't.db') })
migrate(db)
registerNode(db, { id: 'n1', name: 'a' })

const seq = (...cs) => { let i = 0; return { chat: async () => ({ content: cs[Math.min(i++, cs.length - 1)], usage: { total_tokens: 100 } }) } }
const llm = seq(
  JSON.stringify({ decision: 'team', reason: 'x', tasks: [{ key: 'a', task: '查 A' }, { key: 'b', task: '查 B' }] }),
  'A 的结果', 'B 的结果'
)
const fn = createDelegate({ db, makeLlm: () => llm })
const r = await fn({ goal: '同时查两个库' })
console.log(JSON.stringify(r, null, 2).slice(0, 1500))
closeDatabase(db)
rmSync(dir, { recursive: true, force: true })
