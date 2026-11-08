/** thread-eval.test.js —— 线索与判断（纯逻辑，不碰库的地方单测，碰库的放 ingest） */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { openDatabase, closeDatabase } from '../src/store/db.js'
import { migrate } from '../src/store/migrations.js'
import { makeThreadKey, parseThreadKey, openThread, activeThread, touchThread, latestThread } from '../src/thread/thread.js'
import { evaluate, DECISION } from '../src/eval/eval.js'

function fresh() {
  const dir = mkdtempSync(join(tmpdir(), 'whale-th-'))
  const db = openDatabase({ path: join(dir, 't.db') })
  migrate(db)
  return { db, dir }
}

test('键是确定性的：同 room + 同 seq 得同一个键', () => {
  assert.equal(makeThreadKey('qq-group:123', 3), 'qq-group:123#3')
  assert.equal(makeThreadKey('qq-group:123', 3), makeThreadKey('qq-group:123', 3))
})

test('键能解析回去', () => {
  assert.deepEqual(parseThreadKey('qq-group:123#3'), { room: 'qq-group:123', seq: 3 })
  assert.equal(parseThreadKey('nonsense'), null)
})

test('seq 非法直接报错，不猜', () => {
  assert.throws(() => makeThreadKey('r', 0))
  assert.throws(() => makeThreadKey('r', 'x'))
})

test('开线索：seq 递增', () => {
  const { db, dir } = fresh()
  try {
    const a = openThread(db, 'room-a', 1000)
    const b = openThread(db, 'room-a', 2000)
    assert.equal(a.seq, 1)
    assert.equal(b.seq, 2)
    assert.equal(latestThread(db, 'room-a').key, b.key)
  } finally { closeDatabase(db); rmSync(dir, { recursive: true, force: true }) }
})

test('活跃线索：TTL 内返回，超时返回 null', () => {
  const { db, dir } = fresh()
  try {
    const t = openThread(db, 'room-b', 1000)
    assert.equal(activeThread(db, 'room-b', 1000 + 60_000, 30 * 60_000).key, t.key)
    assert.equal(activeThread(db, 'room-b', 1000 + 31 * 60_000, 30 * 60_000), null)
  } finally { closeDatabase(db); rmSync(dir, { recursive: true, force: true }) }
})

test('碰一下会续命', () => {
  const { db, dir } = fresh()
  try {
    const t = openThread(db, 'room-c', 1000)
    touchThread(db, t.key, 1000 + 20 * 60_000)
    assert.ok(activeThread(db, 'room-c', 1000 + 40 * 60_000, 30 * 60_000))
  } finally { closeDatabase(db); rmSync(dir, { recursive: true, force: true }) }
})

test('判断：活跃线索 → 旁路，不看内容', () => {
  const ev = evaluate({ text: '随便什么', activeThread: { key: 'r#1' } })
  assert.equal(ev.decision, DECISION.BYPASS)
  assert.equal(ev.threadKey, 'r#1')
})

test('判断：噪音 → 丢，而且给一句可见的话', () => {
  for (const s of ['', '   ', '。。。', '嗯嗯', '哈哈哈', '🥲']) {
    const ev = evaluate({ text: s })
    assert.equal(ev.decision, DECISION.DROP, '没丢：' + JSON.stringify(s))
    assert.ok(ev.visible.length > 0, '丢了但没话说：' + JSON.stringify(s))
  }
})

test('判断：正常消息 → 接（宁可少丢）', () => {
  for (const s of ['在吗', '好', '行', '我想聊聊', '111', '？']) {
    assert.equal(evaluate({ text: s }).decision, DECISION.ACCEPT, '误丢：' + s)
  }
})
