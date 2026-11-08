/**
 * delegate.test.js —— 派活的工具层
 *
 * 三条边界：
 *   - 没有模型客户端：明确说不，不假装能跑；
 *   - reject：不开单；
 *   - 失败：ticket 推成 failed，结果留在 result_json 里。
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
import { createDelegate } from '../src/plugin/delegate.js'

function fresh() {
  const dir = mkdtempSync(join(tmpdir(), 'ws-dg-'))
  const db = openDatabase({ path: join(dir, 't.db') })
  migrate(db)
  registerNode(db, { id: 'n1', name: 'a' })
  return { db, dir }
}

/** 依次返回预设的模型回复 */
const seq = (...contents) => {
  let i = 0
  return { chat: async () => ({ content: contents[Math.min(i++, contents.length - 1)], usage: { total_tokens: 100 } }) }
}

test('没有模型客户端：明确说不，不开单', async () => {
  const { db, dir } = fresh()
  try {
    const fn = createDelegate({ db, makeLlm: () => null })
    const r = await fn({ goal: '调研一个库' })
    assert.equal(r.ok, false)
    assert.ok(r.why.includes('DEEPSEEK_API_KEY'))
    assert.equal(db.prepare('SELECT COUNT(*) c FROM ticket').get().c, 0)
  } finally { closeDatabase(db); rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) }
})

test('reject：不开单', async () => {
  const { db, dir } = fresh()
  try {
    const llm = seq('{"decision":"reject","reason":"一句话能答"}')
    const fn = createDelegate({ db, makeLlm: () => llm })
    const r = await fn({ goal: '今天天气' })
    assert.equal(r.ok, false)
    assert.equal(r.decision, 'reject')
    assert.equal(db.prepare('SELECT COUNT(*) c FROM ticket').get().c, 0)
  } finally { closeDatabase(db); rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) }
})

test('single：开单 → 跑 → done，结果带回来', async () => {
  const { db, dir } = fresh()
  try {
    // 第一次回 plan，第二次回 worker 结果
    const llm = seq('{"decision":"single","reason":"上下文连着"}', '这是调研结论。')
    const fn = createDelegate({ db, makeLlm: () => llm })
    const r = await fn({ goal: '调研一个库' })
    assert.equal(r.ok, true)
    assert.equal(r.decision, 'single')
    assert.ok(r.results[0].text.includes('调研结论'))
    assert.equal(getTicket(db, r.ticket).status, 'done')
  } finally { closeDatabase(db); rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) }
})

test('team：拆成成员跑，全部成功才 done', async () => {
  const { db, dir } = fresh()
  try {
    const llm = seq(
      JSON.stringify({ decision: 'team', reason: '三份独立产物', tasks: [{ key: 'a', task: '查 A' }, { key: 'b', task: '查 B' }] }),
      'A 的结果', 'B 的结果'
    )
    const fn = createDelegate({ db, makeLlm: () => llm })
    const r = await fn({ goal: '同时查两个库' })
    assert.equal(r.ok, true)
    assert.equal(r.decision, 'team')
    assert.equal(r.results.length, 2)
    assert.equal(getTicket(db, r.ticket).status, 'done')
  } finally { closeDatabase(db); rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) }
})

test('执行失败：ticket 推成 failed，原因留得住', async () => {
  const { db, dir } = fresh()
  try {
    let call = 0
    const llm = { chat: async () => { if (call++ === 0) return { content: '{"decision":"single","reason":"x"}' }; throw new Error('boom') } }
    const fn = createDelegate({ db, makeLlm: () => llm })
    const r = await fn({ goal: '会失败的任务' })
    assert.equal(r.ok, false)
    const tk = getTicket(db, r.ticket)
    assert.equal(tk.status, 'failed')
    // runTicket 失败时已经写了第一手错误，delegate 不覆盖它
    assert.ok(JSON.parse(tk.result_json).error.includes('boom'))
  } finally { closeDatabase(db); rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) }
})

test('空目标：直接拒，不调模型', async () => {
  const { db, dir } = fresh()
  try {
    let called = false
    const fn = createDelegate({ db, makeLlm: () => ({ chat: async () => { called = true; return { content: '{}' } } }) })
    const r = await fn({ goal: '   ' })
    assert.equal(r.ok, false)
    assert.equal(called, false)
  } finally { closeDatabase(db); rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) }
})
