/**
 * assemble.test.js —— 装配层：账本 → 她读到的自我叙述
 *
 * 三条硬规则：
 *   1. 核心段永不裁（身份 / 教过的 / 现在）
 *   2. 可选段塞不下整段不塞（不截半句）
 *   3. 只陈述事实，没材料就留空位，不编
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { openDatabase, closeDatabase } from '../src/store/db.js'
import { migrate } from '../src/store/migrations.js'
import { appendEvent } from '../src/store/event-store.js'
import { buildSections, assemble, render, BUDGET } from '../src/assemble/sections.js'

function fresh() {
  const dir = mkdtempSync(join(tmpdir(), 'ws-asm-'))
  const db = openDatabase({ path: join(dir, 'a.db') })
  migrate(db)
  return { db, dir }
}

test('第一天：有身份和现在，没有编出来的段', () => {
  const { db, dir } = fresh()
  try {
    const secs = buildSections(db, { name: '小泉', ownerName: '主人' })
    const keys = secs.map(s => s.key)
    assert.deepEqual(keys, ['identity', 'taught', 'now'])
    const out = assemble(secs).text
    assert.ok(out.includes('你是「小泉」'))
    assert.ok(out.includes('你管他叫「主人」'))
    assert.ok(out.includes('还没有。他教过什么，就记在这里。'))
    assert.ok(!out.includes('他最近说过'))
  } finally { closeDatabase(db); rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) }
})

test('有原话：摆出来，原样不加工', () => {
  const { db, dir } = fresh()
  try {
    appendEvent(db, { type: 'utterance', person: 'third', source: 'system', content: '我把那个方案先放着了' })
    const out = assemble(buildSections(db, { name: '小泉' })).text
    assert.ok(out.includes('## 他最近说过'))
    assert.ok(out.includes('我把那个方案先放着了'))
  } finally { closeDatabase(db); rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) }
})

test('她自己的话单独成段，带归属标记', () => {
  const { db, dir } = fresh()
  try {
    appendEvent(db, { type: 'utterance', person: 'first', source: 'tool', content: '我不想做这个' })
    const out = assemble(buildSections(db)).text
    assert.ok(out.includes('你自己说过的话（这些是你的，不是别人塞给你的）'))
    assert.ok(out.includes('我不想做这个'))
  } finally { closeDatabase(db); rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) }
})

test('核心段永远保留，哪怕预算再小', () => {
  const { db, dir } = fresh()
  try {
    const secs = buildSections(db, { name: '小泉' })
    const r = assemble(secs, 10)   // 预算远小于核心段
    assert.ok(r.kept.includes('identity'), '身份段不能被裁')
    assert.ok(r.kept.includes('now'), '现在段不能被裁')
    assert.ok(r.text.includes('你是谁'))
  } finally { closeDatabase(db); rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) }
})

test('可选段塞不下就整段不塞，不截半句', () => {
  const { db, dir } = fresh()
  try {
    for (let i = 0; i < 8; i++) {
      appendEvent(db, { type: 'utterance', person: 'third', source: 'system', content: '第 ' + i + ' 句比较长的话，用来把预算撑起来一点点' })
    }
    const secs = buildSections(db)
    const coreLen = secs.filter(s => s.keep).reduce((n, s) => n + s.text.length + 2, 0)
    const r = assemble(secs, coreLen + 100)   // 只够很小一块
    if (r.dropped.includes('recent')) {
      assert.ok(!r.text.includes('## 他最近说过'), '整段没塞进去就不该出现标题')
    }
  } finally { closeDatabase(db); rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) }
})

test('render 一步到位，预算默认 2400', () => {
  const { db, dir } = fresh()
  try {
    const r = render(db, { name: '小泉' })
    assert.ok(r.text.length > 0)
    assert.equal(r.used <= BUDGET + 200, true)
  } finally { closeDatabase(db); rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) }
})

test('没给名字时不编一个', () => {
  const { db, dir } = fresh()
  try {
    const out = assemble(buildSections(db)).text
    assert.ok(out.includes('你还没有名字'))
  } finally { closeDatabase(db); rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) }
})
