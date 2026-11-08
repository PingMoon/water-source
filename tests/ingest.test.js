/** ingest.test.js —— M1 验收：旁路 / 误丢救济 / 推翻 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createWhale } from '../src/core/service.js'

function fresh() {
  const dir = mkdtempSync(join(tmpdir(), 'whale-in-'))
  const w = createWhale({ dbPath: join(dir, 'i.db'), tools: ['fs.read', 'fs.write', 'shell.run'], templateId: 'tp-default' })
  w.boot()
  return { w, dir }
}

test('第一条接住并开线索', () => {
  const { w, dir } = fresh()
  try {
    const r = w.ingest('我想聊聊 JEV', { room: 'desk', now: 1000 })
    assert.equal(r.decision, 'accept')
    assert.equal(r.threadKey, 'desk#1')
    assert.equal(w.read({ types: ['utterance'] }).length, 1)
  } finally { w.close(); rmSync(dir, { recursive: true, force: true }) }
})

test('同房间追问：旁路，不加新线索', () => {
  const { w, dir } = fresh()
  try {
    w.ingest('我想聊聊 JEV', { room: 'desk', now: 1000 })
    const r2 = w.ingest('它到底能干什么', { room: 'desk', now: 2000 })
    assert.equal(r2.decision, 'bypass')
    assert.equal(r2.threadKey, 'desk#1')
    assert.equal(w.threads().length, 1)
  } finally { w.close(); rmSync(dir, { recursive: true, force: true }) }
})

test('TTL 过期后开新线索', () => {
  const { w, dir } = fresh()
  try {
    w.ingest('第一件事', { room: 'desk', now: 1000 })
    const r = w.ingest('隔了很久的另一件事', { room: 'desk', now: 1000 + 31 * 60_000 })
    assert.equal(r.decision, 'accept')
    assert.equal(r.threadKey, 'desk#2')
  } finally { w.close(); rmSync(dir, { recursive: true, force: true }) }
})

test('不同房间互不干扰', () => {
  const { w, dir } = fresh()
  try {
    const a = w.ingest('你好', { room: 'desk', now: 1000 })
    const b = w.ingest('你好', { room: 'qq-group:1', now: 1000 })
    assert.equal(a.threadKey, 'desk#1')
    assert.equal(b.threadKey, 'qq-group:1#1')
  } finally { w.close(); rmSync(dir, { recursive: true, force: true }) }
})

test('噪音被丢弃，但留下可见记录', () => {
  const { w, dir } = fresh()
  try {
    const r = w.ingest('嗯嗯', { room: 'desk', now: 1000 })
    assert.equal(r.decision, 'drop')
    assert.ok(r.visible.includes('没接'))
    const drops = w.drops()
    assert.equal(drops.length, 1)
    assert.equal(drops[0].rule, 'ack')
    assert.equal(w.read({ types: ['utterance'] }).length, 0, '被丢的不该进账本')
  } finally { w.close(); rmSync(dir, { recursive: true, force: true }) }
})

test('误丢救济：10 条该接的全接（丢弃率 0/10）', () => {
  const { w, dir } = fresh()
  try {
    const should = [
      '在吗', '好', '行', '我想聊聊', '111', '？', '这个方案你觉得怎么样',
      '帮我看看这段代码', '今天有点累', '继续'
    ]
    let dropped = 0
    for (let i = 0; i < should.length; i++) {
      const r = w.ingest(should[i], { room: 'r' + i, now: 1000 + i })
      if (r.decision === 'drop') dropped++
    }
    assert.equal(dropped, 0, '误丢 ' + dropped + ' 条')
  } finally { w.close(); rmSync(dir, { recursive: true, force: true }) }
})

test('推翻一次丢弃：记录更新，文本能拿回来', () => {
  const { w, dir } = fresh()
  try {
    const r = w.ingest('。。。', { room: 'desk', now: 1000 })
    assert.equal(r.decision, 'drop')
    const o = w.overturn(r.dropId)
    assert.equal(o.ok, true)
    assert.equal(o.text, '。。。')
    assert.equal(w.dropStats().overturned, 1)
    assert.equal(w.dropStats().rate, 1)
  } finally { w.close(); rmSync(dir, { recursive: true, force: true }) }
})

test('推翻不存在的记录：报错，不静默', () => {
  const { w, dir } = fresh()
  try {
    assert.throws(() => w.overturn('ev_NOPE'), /没有这条丢弃记录/)
  } finally { w.close(); rmSync(dir, { recursive: true, force: true }) }
})
