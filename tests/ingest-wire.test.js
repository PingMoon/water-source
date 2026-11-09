/**
 * ingest-wire.test.js —— 真人消息 → whale.ingest 的接线
 *
 * 重点是**别把机器消息当人话**：宿主每轮会往里拼 runtime-context、
 * skill-catalog、工具回灌、我们自己的唤醒句。认错任何一类，
 * 账本里就会多出根本没发生过的「她说的话」。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createWhale } from '../src/core/service.js'
import { registerIngest, classifyMessage, messageText, roomOf } from '../src/plugin/ingest.js'

function harness() {
  const dir = mkdtempSync(join(tmpdir(), 'whale-iw-'))
  const w = createWhale({ dbPath: join(dir, 'i.db'), root: dir, tools: ['fs.read', 'fs.write', 'shell.run'], templateId: 'tp-default' })
  w.boot()
  let handler = null
  const ctx = { on: (ev, fn) => { if (ev === 'session/event') handler = fn; return () => { handler = null } } }
  const off = registerIngest(ctx, { whale: w })
  return { w, dir, emit: (session, event) => handler && handler(session, event), off }
}

test('真人消息：进账本，开线索', () => {
  const { w, dir, emit } = harness()
  try {
    emit({ id: 's1' }, { type: 'user/message', data: { content: [{ type: 'text', text: '帮我看看这段代码' }], source: { kind: 'user', clientTimeZone: 'Asia/Shanghai' } } })
    const events = w.read({ types: ['utterance'] })
    assert.equal(events.length, 1)
    assert.equal(events[0].content, '帮我看看这段代码')
    assert.equal(w.threads().length, 1)
  } finally { w.close(); rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) }
})

test('宿主的 runtime-context 不算人话', () => {
  const { w, dir, emit } = applyHarness()
  function applyHarness() { return harness() }
  try {
    emit({ id: 's1' }, { type: 'user/message', data: { content: [{ type: 'text', text: '当前工作区...' }], source: { kind: 'runtime-context' } } })
    emit({ id: 's1' }, { type: 'user/message', data: { content: [{ type: 'text', text: '技能清单...' }], source: { kind: 'skill-catalog' } } })
    emit({ id: 's1' }, { type: 'user/message', data: { content: [{ type: 'text', text: '工具结果' }], source: { kind: 'tool' } } })
    assert.equal(w.read({ types: ['utterance'] }).length, 0)
  } finally { w.close(); rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) }
})

test('我们自己叫醒她的消息不算人话（rpcId 前缀）', () => {
  const { w, dir, emit } = harness()
  try {
    emit({ id: 's1' }, { type: 'user/message', data: { content: [{ type: 'text', text: '（这一轮是你自己的）' }], source: { kind: 'user', clientTimeZone: 'Asia/Shanghai', rpcId: 'wake-abc' } } })
    assert.equal(w.read({ types: ['utterance'] }).length, 0)
  } finally { w.close(); rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) }
})

test('没有时区的 user 消息：宁可不记', () => {
  const { w, dir, emit } = harness()
  try {
    emit({ id: 's1' }, { type: 'user/message', data: { text: '不知道从哪来的', source: { kind: 'user' } } })
    assert.equal(w.read({ types: ['utterance'] }).length, 0)
  } finally { w.close(); rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) }
})

test('噪音被丢弃，但不进账本（丢弃记录在 eval_drop）', () => {
  const { w, dir, emit } = harness()
  try {
    // 2026-11-09：语气词不再算噪音，改用纯标点
    emit({ id: 's1' }, { type: 'user/message', data: { text: '。。。', source: { kind: 'user', clientTimeZone: 'Asia/Shanghai' } } })
    assert.equal(w.read({ types: ['utterance'] }).length, 0)
    assert.equal(w.drops().length, 1)
  } finally { w.close(); rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) }
})

test('非 user/message 的事件不碰', () => {
  const { w, dir, emit } = harness()
  try {
    emit({ id: 's1' }, { type: 'assistant/message', data: { content: [{ type: 'text', text: '她说的' }] } })
    emit({ id: 's1' }, { type: 'turn/end', data: {} })
    assert.equal(w.read({ types: ['utterance'] }).length, 0)
  } finally { w.close(); rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) }
})

test('messageText：三种形态都认得出来', () => {
  assert.equal(messageText({ text: 'a' }), 'a')
  assert.equal(messageText({ content: 'b' }), 'b')
  assert.equal(messageText({ content: [{ type: 'text', text: 'c' }, { type: 'image' }] }), 'c')
  assert.equal(messageText(null), '')
})

test('roomOf：会话 id 优先，退到 cwd', () => {
  assert.equal(roomOf({ id: 's1' }), 's1')
  assert.equal(roomOf({ cwd: 'C:/w' }), 'C:/w')
  assert.equal(roomOf(null), 'local')
})

test('classifyMessage 对照表', () => {
  assert.equal(classifyMessage({ source: { kind: 'user', clientTimeZone: 'Asia/Shanghai' } }), 'human')
  assert.equal(classifyMessage({ source: { kind: 'qq', clientTimeZone: 'Asia/Shanghai' } }), 'human')
  assert.equal(classifyMessage({ source: { kind: 'runtime-context' } }), 'context')
  assert.equal(classifyMessage({ source: { kind: 'plugin:x' } }), 'context')
  assert.equal(classifyMessage({ source: { kind: 'user', rpcId: 'say-1' } }), 'plugin')
  assert.equal(classifyMessage({}), 'context')
})
