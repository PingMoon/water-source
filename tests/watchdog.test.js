/**
 * watchdog.test.js —— 哨兵：只报告，不擅自动手
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { openDatabase, closeDatabase } from '../src/store/db.js'
import { migrate } from '../src/store/migrations.js'
import { createTicket, transition, getTicket, reopen } from '../src/team/ticket.js'
import { registerNode, heartbeat } from '../src/team/pool.js'
import { openTeam, startMember, members } from '../src/team/team.js'
import { scan, sweep, DEFAULT_TIMEOUTS } from '../src/team/watchdog.js'

function fresh() {
  const dir = mkdtempSync(join(tmpdir(), 'ws-wd-'))
  const db = openDatabase({ path: join(dir, 't.db') })
  migrate(db)
  return { db, dir }
}

const NOW = Date.parse('2026-11-08T12:00:00.000Z')

test('刚开的东西不算卡住', () => {
  const { db, dir } = fresh()
  try {
    const t = createTicket(db, { goal: 'a', now: NOW })
    const r = scan(db, { now: NOW + 1000 })
    assert.equal(r.total, 0, JSON.stringify(r))
  } finally { closeDatabase(db); rmSync(dir, { recursive: true, force: true }) }
})

test('排队太久：open 超时被报出来', () => {
  const { db, dir } = fresh()
  try {
    const t = createTicket(db, { goal: 'a', now: NOW })
    const r = scan(db, { now: NOW + DEFAULT_TIMEOUTS.openMs + 1000 })
    assert.equal(r.stalledOpen.length, 1)
    assert.equal(r.stalledOpen[0].id, t.id)
  } finally { closeDatabase(db); rmSync(dir, { recursive: true, force: true }) }
})

test('分配了没开工：assigned 超时', () => {
  const { db, dir } = fresh()
  try {
    registerNode(db, { id: 'n1', name: 'a' })
    const t = createTicket(db, { goal: 'a', now: NOW })
    transition(db, t.id, 'assigned', { assignee: 'n1', now: NOW })
    const r = scan(db, { now: NOW + DEFAULT_TIMEOUTS.assignedMs + 1000 })
    assert.equal(r.stalledAssigned.length, 1)
    assert.equal(r.stalledAssigned[0].assignee, 'n1')
  } finally { closeDatabase(db); rmSync(dir, { recursive: true, force: true }) }
})

test('跑了没结束：running 超时', () => {
  const { db, dir } = fresh()
  try {
    const t = createTicket(db, { goal: 'a', now: NOW })
    transition(db, t.id, 'assigned', { assignee: 'n1', now: NOW })
    transition(db, t.id, 'running', { now: NOW })
    const r = scan(db, { now: NOW + DEFAULT_TIMEOUTS.runningMs + 1000 })
    assert.equal(r.stalledRunning.length, 1)
  } finally { closeDatabase(db); rmSync(dir, { recursive: true, force: true }) }
})

test('已完成的 ticket 不会再被报', () => {
  const { db, dir } = fresh()
  try {
    const t = createTicket(db, { goal: 'a', now: NOW })
    transition(db, t.id, 'assigned', { assignee: 'n1', now: NOW })
    transition(db, t.id, 'running', { now: NOW })
    transition(db, t.id, 'done', { now: NOW + 1000 })
    const r = scan(db, { now: NOW + 99999999 })
    assert.equal(r.total, 0)
  } finally { closeDatabase(db); rmSync(dir, { recursive: true, force: true }) }
})

test('节点心跳停了 → 报死', () => {
  const { db, dir } = fresh()
  try {
    registerNode(db, { id: 'n1', name: 'a', now: NOW })
    const r = scan(db, { now: NOW + DEFAULT_TIMEOUTS.heartbeatMs + 1000 })
    assert.equal(r.deadNodes.length, 1)
    // 心跳回来就不算死了
    heartbeat(db, 'n1', NOW + DEFAULT_TIMEOUTS.heartbeatMs + 2000)
    assert.equal(scan(db, { now: NOW + DEFAULT_TIMEOUTS.heartbeatMs + 3000 }).deadNodes.length, 0)
  } finally { closeDatabase(db); rmSync(dir, { recursive: true, force: true }) }
})

test('sweep 默认 dryRun：只报告，不改状态', () => {
  const { db, dir } = fresh()
  try {
    const t = createTicket(db, { goal: 'a', now: NOW })
    const r = sweep(db, { now: NOW + DEFAULT_TIMEOUTS.openMs + 1000 })
    assert.equal(r.dryRun, true)
    assert.ok(r.actions.some((a) => a.type === 'ticket.failed'))
    assert.equal(getTicket(db, t.id).status, 'open', 'dryRun 不该改状态')
  } finally { closeDatabase(db); rmSync(dir, { recursive: true, force: true }) }
})

test('sweep 真跑：ticket → failed，member → timeout，node → offline', () => {
  const { db, dir } = fresh()
  try {
    registerNode(db, { id: 'n1', name: 'a', now: NOW })
    const t = createTicket(db, { goal: 'a', now: NOW })
    transition(db, t.id, 'assigned', { assignee: 'n1', now: NOW })
    transition(db, t.id, 'running', { now: NOW })
    const list = openTeam(db, t.id, [{ key: 'x', task: 'x' }], { now: NOW })
    startMember(db, list[0].id, { now: NOW })

    const r = sweep(db, { now: NOW + 40 * 60_000, dryRun: false })
    assert.ok(r.actions.length > 0)
    assert.equal(getTicket(db, t.id).status, 'failed')
    assert.equal(members(db, t.id)[0].status, 'timeout')
    assert.equal(members(db, t.id)[0].error_class, 'timeout')
  } finally { closeDatabase(db); rmSync(dir, { recursive: true, force: true }) }
})

test('sweep 后还能 reopen（不删数据，只推进状态）', () => {
  const { db, dir } = fresh()
  try {
    const t = createTicket(db, { goal: 'a', now: NOW })
    sweep(db, { now: NOW + DEFAULT_TIMEOUTS.openMs + 1000, dryRun: false })
    assert.equal(getTicket(db, t.id).status, 'failed')
    assert.equal(reopen(db, t.id).status, 'open')
  } finally { closeDatabase(db); rmSync(dir, { recursive: true, force: true }) }
})

test('超时可配，不写死', () => {
  const { db, dir } = fresh()
  try {
    const t = createTicket(db, { goal: 'a', now: NOW })
    const r = scan(db, { now: NOW + 2000, timeouts: { openMs: 1000 } })
    assert.equal(r.stalledOpen.length, 1)
  } finally { closeDatabase(db); rmSync(dir, { recursive: true, force: true }) }
})
