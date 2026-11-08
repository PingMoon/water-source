/**
 * orchestrator.test.js —— 拆不拆、派给谁、做不做
 *
 * 最要紧的一条：**模型给不出合法答案时，默认 single**。
 * 拆错的代价（上下文断、交接丢信息）比不拆大。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { openDatabase, closeDatabase } from '../src/store/db.js'
import { migrate } from '../src/store/migrations.js'
import { registerNode } from '../src/team/pool.js'
import { getTicket } from '../src/team/ticket.js'
import { members } from '../src/team/team.js'
import { plan, dispatch, orchestrate, normalizePlan, DECISION } from '../src/team/orchestrator.js'

function fresh() {
  const dir = mkdtempSync(join(tmpdir(), 'ws-or-'))
  const db = openDatabase({ path: join(dir, 't.db') })
  migrate(db)
  registerNode(db, { id: 'n1', name: 'a' })
  return { db, dir }
}

const fake = (content) => ({ chat: async () => ({ content }) })
const NOW = Date.parse('2026-11-08T12:00:00.000Z')

// ---------- 判断 ----------

test('单件：上下文能连着走就不拆', () => {
  const p = normalizePlan({ decision: 'single', reason: '研究完直接写' })
  assert.equal(p.decision, DECISION.SINGLE)
  assert.equal(p.tasks.length, 0)
})

test('team：两块以上才拆，少于两块降级为 single', () => {
  const one = normalizePlan({ decision: 'team', tasks: [{ key: 'a', task: 'x' }] })
  assert.equal(one.decision, DECISION.SINGLE)

  const two = normalizePlan({ decision: 'team', tasks: [{ key: 'a', task: 'x' }, { key: 'b', task: 'y' }] })
  assert.equal(two.decision, DECISION.TEAM)
  assert.equal(two.tasks.length, 2)
})

test('team：重复 key 去掉，最多 5 块', () => {
  const many = Array.from({ length: 9 }, (_, i) => ({ key: 'k' + (i % 3), task: 't' + i }))
  const p = normalizePlan({ decision: 'team', tasks: many })
  assert.ok(p.tasks.length <= 5)
  assert.equal(new Set(p.tasks.map((t) => t.key)).size, p.tasks.length, 'key 不能重复')
})

test('非法输出：降级 single，不拆', () => {
  for (const bad of [null, {}, { decision: 'nonsense' }, { decision: 'team', tasks: '不是数组' }]) {
    assert.equal(normalizePlan(bad).decision, DECISION.SINGLE, '输入 ' + JSON.stringify(bad))
  }
})

test('reject：不值得做的直接说', () => {
  const p = normalizePlan({ decision: 'reject', reason: '一句话能答，不值得开工单' })
  assert.equal(p.decision, DECISION.REJECT)
  assert.ok(p.reason.includes('开工单'))
})

test('空目标：不调模型，直接拒', async () => {
  let called = false
  const llm = { chat: async () => { called = true; return { content: '{}' } } }
  const p = await plan('   ', { llm })
  assert.equal(called, false)
  assert.equal(p.decision, DECISION.REJECT)
})

// ---------- 派单 ----------

test('single：开一个 ticket，分配节点', () => {
  const { db, dir } = fresh()
  try {
    const r = dispatch(db, '调研一个库', { decision: DECISION.SINGLE, reason: '', tasks: [] }, { now: NOW })
    assert.equal(r.ok, true)
    assert.equal(r.node, 'n1')
    assert.equal(getTicket(db, r.ticket.id).status, 'assigned')
    assert.equal(members(db, r.ticket.id).length, 0)
  } finally { closeDatabase(db); rmSync(dir, { recursive: true, force: true }) }
})

test('team：ticket + 成员一起开出来', () => {
  const { db, dir } = fresh()
  try {
    const r = dispatch(db, '并行查三个库', {
      decision: DECISION.TEAM,
      reason: '三份独立产物',
      tasks: [{ key: 'lib-a', task: '查 A' }, { key: 'lib-b', task: '查 B' }]
    }, { now: NOW })
    assert.equal(r.ok, true)
    assert.equal(r.members.length, 2)
    assert.equal(members(db, r.ticket.id).length, 2)
  } finally { closeDatabase(db); rmSync(dir, { recursive: true, force: true }) }
})

test('reject：不开 ticket', () => {
  const { db, dir } = fresh()
  try {
    const r = dispatch(db, '今天天气', { decision: DECISION.REJECT, reason: '一句话能答', tasks: [] }, { now: NOW })
    assert.equal(r.ok, false)
    assert.ok(r.why.includes('一句话'))
    const cnt = db.prepare('SELECT COUNT(*) c FROM ticket').get()
    assert.equal(cnt.c, 0)
  } finally { closeDatabase(db); rmSync(dir, { recursive: true, force: true }) }
})

test('没有可用节点：ticket 留在 open，不硬塞', () => {
  const { db, dir } = fresh()
  try {
    db.prepare('UPDATE worker_node SET online = 0').run()
    const r = dispatch(db, 'x', { decision: DECISION.SINGLE, reason: '', tasks: [] }, { now: NOW })
    assert.equal(r.ok, true)
    assert.equal(r.node, null)
    assert.equal(getTicket(db, r.ticket.id).status, 'open', '没节点就该留在 open 排队')
  } finally { closeDatabase(db); rmSync(dir, { recursive: true, force: true }) }
})

// ---------- 端到端 ----------

test('orchestrate：模型说拆就拆，说单就单', async () => {
  const { db, dir } = fresh()
  try {
    const single = await orchestrate(db, '调研一个库并写 demo', {
      llm: fake('{"decision":"single","reason":"上下文连着"}'), now: NOW
    })
    assert.equal(single.decision, 'single')

    const team = await orchestrate(db, '同时查三个库', {
      llm: fake(JSON.stringify({
        decision: 'team',
        reason: '三份独立产物',
        tasks: [{ key: 'a', task: 'x' }, { key: 'b', task: 'y' }, { key: 'c', task: 'z' }]
      })), now: NOW + 1000
    })
    assert.equal(team.decision, 'team')
    assert.equal(team.members.length, 3)
  } finally { closeDatabase(db); rmSync(dir, { recursive: true, force: true }) }
})
