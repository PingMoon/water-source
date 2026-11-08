/**
 * worker.test.js —— 最小执行器：预算优先、失败不吞
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { openDatabase, closeDatabase } from '../src/store/db.js'
import { migrate } from '../src/store/migrations.js'
import { registerNode } from '../src/team/pool.js'
import { createTicket, transition, getTicket } from '../src/team/ticket.js'
import { runTicket, drain, totalTokens, DEFAULT_BUDGET } from '../src/team/worker.js'

function fresh() {
  const dir = mkdtempSync(join(tmpdir(), 'ws-wk-'))
  const db = openDatabase({ path: join(dir, 't.db') })
  migrate(db)
  registerNode(db, { id: 'n1', name: 'a' })
  return { db, dir }
}

const NOW = Date.parse('2026-11-08T12:00:00.000Z')
const fake = (content, usage) => ({ chat: async () => ({ content, usage, model: 'fake' }) })

function assignedTicket(db, goal = 'x') {
  const t = createTicket(db, { goal, now: NOW })
  transition(db, t.id, 'assigned', { assignee: 'n1', now: NOW })
  return t
}

test('跑成功：ticket → done，结果与用量都记下', async () => {
  const { db, dir } = fresh()
  try {
    const t = assignedTicket(db, '解释一下 WAL')
    const r = await runTicket(db, t.id, { llm: fake('WAL 是预写日志…', { prompt_tokens: 100, completion_tokens: 50 }), now: NOW })
    assert.equal(r.ok, true)
    const after = getTicket(db, t.id)
    assert.equal(after.status, 'done')
    const result = JSON.parse(after.result_json)
    assert.equal(result.tokens, 150)
    assert.equal(result.overBudget, false)
    assert.ok(result.text.includes('WAL'))
  } finally { closeDatabase(db); rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) }
})

test('超预算：仍然完成，但标 overBudget', async () => {
  const { db, dir } = fresh()
  try {
    const t = assignedTicket(db)
    const r = await runTicket(db, t.id, {
      llm: fake('很长很长的回答', { prompt_tokens: 3000, completion_tokens: 3000 }),
      budget: { maxTokens: 1000 }, now: NOW
    })
    assert.equal(r.ok, true)
    const result = JSON.parse(getTicket(db, t.id).result_json)
    assert.equal(result.overBudget, true)
    assert.equal(result.budget.maxTokens, 1000)
  } finally { closeDatabase(db); rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) }
})

test('模型报错：ticket → failed，原因写进 result', async () => {
  const { db, dir } = fresh()
  try {
    const t = assignedTicket(db)
    const llm = { chat: async () => { throw new Error('boom') } }
    const r = await runTicket(db, t.id, { llm, now: NOW })
    assert.equal(r.ok, false)
    const after = getTicket(db, t.id)
    assert.equal(after.status, 'failed')
    assert.ok(JSON.parse(after.result_json).error.includes('boom'))
  } finally { closeDatabase(db); rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) }
})

test('只有 assigned 能跑', async () => {
  const { db, dir } = fresh()
  try {
    const t = createTicket(db, { goal: 'x', now: NOW })
    const r = await runTicket(db, t.id, { llm: fake('x'), now: NOW })
    assert.equal(r.ok, false)
    assert.ok(r.why.includes('assigned'))
  } finally { closeDatabase(db); rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) }
})

test('usage 字段名兼容：total / prompt+completion / input+output', () => {
  assert.equal(totalTokens({ total_tokens: 120 }), 120)
  assert.equal(totalTokens({ prompt_tokens: 100, completion_tokens: 20 }), 120)
  assert.equal(totalTokens({ input_tokens: 100, output_tokens: 20 }), 120)
  assert.equal(totalTokens(null), 0)
})

test('drain：一次只跑 limit 个，会话预算用尽就停', async () => {
  const { db, dir } = fresh()
  try {
    const ids = []
    for (let i = 0; i < 4; i++) {
      const t = createTicket(db, { goal: 'task ' + i, now: NOW + i })
      transition(db, t.id, 'assigned', { assignee: 'n1', now: NOW + i })
      ids.push(t.id)
    }
    const r = await drain(db, {
      llm: fake('ok', { total_tokens: 600 }),
      budget: { sessionMaxTokens: 1000 },
      limit: 4, now: NOW
    })
    assert.equal(r.ran, 4)
    // 第一个 600，第二个 1200 超预算 → 后面都跳过
    const skipped = r.results.filter((x) => !x.ok).length
    assert.ok(skipped >= 2, '预算应该在第二次之后就拦住，实际：' + JSON.stringify(r.results))
  } finally { closeDatabase(db); rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) }
})
