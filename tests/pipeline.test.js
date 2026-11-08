/**
 * pipeline.test.js —— 归并端到端（用真库 + 假模型）
 *
 * 验的是「编排对不对」，不是「模型好不好」。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { openDatabase, closeDatabase } from '../src/store/db.js'
import { migrate } from '../src/store/migrations.js'
import { appendEvent, readEvents } from '../src/store/event-store.js'
import { consolidate, lastRun } from '../src/consolidate/pipeline.js'

function fresh() {
  const dir = mkdtempSync(join(tmpdir(), 'whale-pipe-'))
  const db = openDatabase({ path: join(dir, 't.db') })
  migrate(db)
  return { db, dir }
}

test('端到端：材料 → 定序 → 意义化 → 落库', async () => {
  const { db, dir } = fresh()
  try {
    const m1 = appendEvent(db, { type: 'worker_material', content: 'JEV 在 ALFWorld 上只有 35%' })
    const m2 = appendEvent(db, { type: 'worker_material', content: 'JEV 一次请求能并行答多个问题' })
    const llm = {
      chat: async () => ({
        content: JSON.stringify([
          { meaning: 'JEV 不能用来做长链决策', refs: [m1.id] },
          { meaning: 'JEV 适合做并行的窄判断', refs: [m2.id] }
        ])
      })
    }
    const r = await consolidate(db, { llm })
    assert.equal(r.ok, true)
    assert.equal(r.accepted, 2)

    const meanings = readEvents(db, { types: ['meaning'] })
    assert.equal(meanings.length, 2)
    assert.equal(meanings[0].person, 'first')
    assert.ok(meanings.every((x) => x.refs.length === 1))

    const run = lastRun(db)
    assert.equal(run.status, 'done')
    assert.equal(run.stats.accepted, 2)
  } finally { closeDatabase(db); rmSync(dir, { recursive: true, force: true }) }
})

test('否决生效：与已有信念冲突的草稿不落库', async () => {
  const { db, dir } = fresh()
  try {
    const m = appendEvent(db, { type: 'worker_material', content: '我应该早点睡这件事的讨论' })
    appendEvent(db, { type: 'meaning', content: '我不应该早点睡', refs: [m.id] })

    const llm = { chat: async () => ({ content: JSON.stringify([{ meaning: '我应该早点睡', refs: [m.id] }]) }) }
    const r = await consolidate(db, { llm })
    assert.equal(r.accepted, 0)
    assert.equal(r.rejected, 1)
    assert.equal(r.vetoedDetail[0].reasonCode, 'conflict_unresolved')
    assert.equal(readEvents(db, { types: ['meaning'] }).length, 1, '原来那条还在，新的没进去')
  } finally { closeDatabase(db); rmSync(dir, { recursive: true, force: true }) }
})

test('编造来源的草稿被丢弃，不落库', async () => {
  const { db, dir } = fresh()
  try {
    appendEvent(db, { type: 'worker_material', content: '一条真材料' })
    const llm = { chat: async () => ({ content: '[{"meaning":"我编的","refs":["ev_NOPE"]}]' }) }
    const r = await consolidate(db, { llm })
    assert.equal(r.accepted, 0)
    assert.equal(r.dropped, 1)
    assert.equal(readEvents(db, { types: ['meaning'] }).length, 0)
  } finally { closeDatabase(db); rmSync(dir, { recursive: true, force: true }) }
})

test('模型调用失败：run 标 failed，错误继续抛', async () => {
  const { db, dir } = fresh()
  try {
    appendEvent(db, { type: 'worker_material', content: 'x' })
    const llm = { chat: async () => { throw new Error('boom') } }
    await assert.rejects(() => consolidate(db, { llm }), /boom/)
    const run = lastRun(db)
    assert.equal(run.status, 'failed')
    assert.ok(run.stats.error.includes('boom'))
  } finally { closeDatabase(db); rmSync(dir, { recursive: true, force: true }) }
})

test('没有材料时不调用模型', async () => {
  const { db, dir } = fresh()
  try {
    let called = false
    const llm = { chat: async () => { called = true; return { content: '[]' } } }
    const r = await consolidate(db, { llm })
    assert.equal(called, false)
    assert.equal(r.ordered, 0)
  } finally { closeDatabase(db); rmSync(dir, { recursive: true, force: true }) }
})
