/**
 * team.test.js —— M3：工单 / 节点池 / team 部分失败
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { openDatabase, closeDatabase } from '../src/store/db.js'
import { migrate } from '../src/store/migrations.js'
import { createTicket, getTicket, transition, reopen, listTickets } from '../src/team/ticket.js'
import { registerNode, pickNode, assign, loadOf, setOnline, listNodes } from '../src/team/pool.js'
import { openTeam, startMember, finishMember, retryMember, teamIndex, members, MAX_MEMBERS } from '../src/team/team.js'

function fresh() {
  const dir = mkdtempSync(join(tmpdir(), 'ws-team-'))
  const db = openDatabase({ path: join(dir, 't.db') })
  migrate(db)
  return { db, dir }
}

// ---------- ticket ----------

test('ticket：创建 → 分配 → 跑 → 完成', () => {
  const { db, dir } = fresh()
  try {
    const t = createTicket(db, { goal: '调研一个库' })
    assert.equal(t.status, 'open')
    transition(db, t.id, 'assigned', { assignee: 'n1' })
    transition(db, t.id, 'running')
    const done = transition(db, t.id, 'done', { result: { ok: true } })
    assert.equal(done.status, 'done')
    assert.ok(done.finished_at)
  } finally { closeDatabase(db); rmSync(dir, { recursive: true, force: true }) }
})

test('ticket：非法流转被拒，不静默改', () => {
  const { db, dir } = fresh()
  try {
    const t = createTicket(db, { goal: 'x' })
    assert.throws(() => transition(db, t.id, 'done'), /不允许的流转/)
    assert.equal(getTicket(db, t.id).status, 'open')
  } finally { closeDatabase(db); rmSync(dir, { recursive: true, force: true }) }
})

test('ticket：failed 能显式重开，别的不行', () => {
  const { db, dir } = fresh()
  try {
    const t = createTicket(db, { goal: 'x' })
    transition(db, t.id, 'cancelled')
    assert.throws(() => reopen(db, t.id), /只有 failed 能重开/)
    const t2 = createTicket(db, { goal: 'y' })
    transition(db, t2.id, 'assigned', { assignee: 'n1' })
    transition(db, t2.id, 'failed')
    assert.equal(reopen(db, t2.id).status, 'open')
  } finally { closeDatabase(db); rmSync(dir, { recursive: true, force: true }) }
})

// ---------- pool ----------

test('pool：最少负载优先', () => {
  const { db, dir } = fresh()
  try {
    registerNode(db, { id: 'n1', name: 'a' })
    registerNode(db, { id: 'n2', name: 'b' })
    const t1 = createTicket(db, { goal: 'a' })
    assign(db, t1.id)   // 会挑一个，把它压上负载
    const pick = pickNode(db, 'some-ticket')
    const loads = listNodes(db).map(n => ({ id: n.id, load: loadOf(db, n.id) }))
    assert.equal(pick.load, Math.min(...loads.map(x => x.load)))
  } finally { closeDatabase(db); rmSync(dir, { recursive: true, force: true }) }
})

test('pool：同一个 ticket 多次问，只要负载没变答案一样', () => {
  const { db, dir } = fresh()
  try {
    registerNode(db, { id: 'n1', name: 'a' })
    registerNode(db, { id: 'n2', name: 'b' })
    const a = pickNode(db, 'ticket-X')
    const b = pickNode(db, 'ticket-X')
    const c = pickNode(db, 'ticket-X')
    assert.equal(a.id, b.id)
    assert.equal(b.id, c.id)
  } finally { closeDatabase(db); rmSync(dir, { recursive: true, force: true }) }
})

test('pool：满载与离线的节点不分配', () => {
  const { db, dir } = fresh()
  try {
    registerNode(db, { id: 'n1', name: 'a', capacity: 1 })
    const t1 = createTicket(db, { goal: 'a' })
    assign(db, t1.id)
    assert.equal(pickNode(db, 'other'), null, '唯一节点已满载，应该没有可分配的')
    registerNode(db, { id: 'n2', name: 'b', capacity: 1 })
    setOnline(db, 'n2', false)
    assert.equal(pickNode(db, 'other'), null, '离线节点不该被挑中')
  } finally { closeDatabase(db); rmSync(dir, { recursive: true, force: true }) }
})

// ---------- team ----------

test('team：开成员 → 跑 → 部分失败', () => {
  const { db, dir } = fresh()
  try {
    const t = createTicket(db, { goal: '调研并写 demo' })
    const list = openTeam(db, t.id, [
      { key: 'read-docs', task: '读文档' },
      { key: 'try-demo', task: '写 demo' },
      { key: 'bench', task: '跑基准' }
    ])
    assert.equal(list.length, 3)
    // ⚠ members() 按 member_key 排序返回，不是传入顺序——所以用 key 找，别用下标
    const byKey = Object.fromEntries(list.map((m) => [m.member_key, m]))
    for (const m of list) startMember(db, m.id)
    finishMember(db, byKey['read-docs'].id, { status: 'done' })
    finishMember(db, byKey['try-demo'].id, { status: 'done' })
    finishMember(db, byKey['bench'].id, { status: 'failed', errorClass: 'tool_blocked' })

    const idx = teamIndex(db, t.id)
    assert.equal(idx.total, 3)
    assert.equal(idx.done, 2)
    assert.equal(idx.failed, 1)
    assert.equal(idx.incomplete, true)
    assert.deepEqual(idx.missing, ['bench'], '不完整性要能点名')
  } finally { closeDatabase(db); rmSync(dir, { recursive: true, force: true }) }
})

test('team：可重试的失败能重试，不可重试的直接拒', () => {
  const { db, dir } = fresh()
  try {
    const t = createTicket(db, { goal: 'x' })
    const list = openTeam(db, t.id, [{ key: 'a', task: 'a' }, { key: 'b', task: 'b' }])
    finishMember(db, list[0].id, { status: 'failed', errorClass: 'timeout' })
    finishMember(db, list[1].id, { status: 'failed', errorClass: 'permission_denied' })

    assert.equal(retryMember(db, list[0].id).ok, true, 'timeout 可重试')
    const r = retryMember(db, list[1].id)
    assert.equal(r.ok, false)
    assert.ok(r.why.includes('不可重试'))
  } finally { closeDatabase(db); rmSync(dir, { recursive: true, force: true }) }
})

test('team：重试是同一行 attempts+1，不是新增行（幂等）', () => {
  const { db, dir } = fresh()
  try {
    const t = createTicket(db, { goal: 'x' })
    const [m] = openTeam(db, t.id, [{ key: 'a', task: 'a' }])
    finishMember(db, m.id, { status: 'failed', errorClass: 'timeout' })
    retryMember(db, m.id)
    finishMember(db, m.id, { status: 'failed', errorClass: 'timeout' })
    retryMember(db, m.id)
    finishMember(db, m.id, { status: 'failed', errorClass: 'timeout' })
    const r = retryMember(db, m.id)
    assert.equal(r.ok, false)
    assert.ok(r.why.includes('预算'))
    assert.equal(members(db, t.id).length, 1, '重试不该新增行')
    assert.equal(members(db, t.id)[0].attempts, 2)
  } finally { closeDatabase(db); rmSync(dir, { recursive: true, force: true }) }
})

test('team：成员 key 不能重复，也不能超 5 个', () => {
  const { db, dir } = fresh()
  try {
    const t = createTicket(db, { goal: 'x' })
    assert.throws(() => openTeam(db, t.id, [{ key: 'a', task: 'a' }, { key: 'a', task: 'b' }]), /重复/)
    const many = Array.from({ length: MAX_MEMBERS + 1 }, (_, i) => ({ key: 'k' + i, task: 't' }))
    assert.throws(() => openTeam(db, t.id, many), /不超过/)
  } finally { closeDatabase(db); rmSync(dir, { recursive: true, force: true }) }
})
