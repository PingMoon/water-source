import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase, closeDatabase } from '../src/store/db.js'
import { migrate } from '../src/store/migrations.js'
import { registerNode } from '../src/team/pool.js'
import { createTicket, transition, getTicket } from '../src/team/ticket.js'
import { runTicket } from '../src/team/worker.js'
import { createLlm } from '../src/llm/client.js'

const BUDGET = { maxTokens: 2000, maxCalls: 1 }
const llm = createLlm({ timeoutMs: 120000, reasoningEffort: 'medium' })
console.log('模型配置: ' + JSON.stringify(llm.config))

const dir = mkdtempSync(join(tmpdir(), 'ws-worker-'))
const db = openDatabase({ path: join(dir, 'w.db') })
migrate(db)
registerNode(db, { id: 'n1', name: 'worker-1', capacity: 1 })

const GOAL = '用 150 字说明：SQLite 的 WAL 模式为什么适合 append-only 账本？再指出它的一个缺点。'
const t = createTicket(db, { goal: GOAL })
transition(db, t.id, 'assigned', { assignee: 'n1' })

console.log('─'.repeat(60))
console.log('ticket: ' + t.id)
console.log('goal: ' + GOAL)
console.log('预算: ' + JSON.stringify(BUDGET))

const t0 = Date.now()
const r = await runTicket(db, t.id, { llm, budget: BUDGET })
console.log('─'.repeat(60))
console.log('耗时: ' + (Date.now() - t0) + 'ms')
console.log('结果: ' + (r.ok ? 'ok' : 'FAILED: ' + r.why))
if (r.ok) {
  console.log('token: ' + r.result.tokens + ' / 预算 ' + BUDGET.maxTokens + (r.result.overBudget ? '  ⚠ 超预算' : '  ✓ 在预算内'))
  console.log('─'.repeat(60))
  console.log(r.result.text)
}
console.log('─'.repeat(60))
console.log('ticket 状态: ' + getTicket(db, t.id).status)

closeDatabase(db)
rmSync(dir, { recursive: true, force: true })
