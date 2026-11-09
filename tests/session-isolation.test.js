/**
 * session-isolation.test.js —— 分会话开关
 *
 * 要守住的事：主人跟别的 agent 说话，不能混进她的账本。
 * 2026-11-09 实锤过：账本里混进了「可以」「清掉」这种对别人说的话。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createWhale } from '../src/core/service.js'
import { registerIngest } from '../src/plugin/ingest.js'
import { render } from '../src/assemble/sections.js'

function harness(herSessionId = '') {
  const dir = mkdtempSync(join(tmpdir(), 'ws-iso-'))
  const w = createWhale({ dbPath: join(dir, 'i.db'), root: dir, tools: ['fs.read', 'fs.write', 'shell.run'], templateId: 'tp-default' })
  w.boot()
  let handler = null
  const ctx = { on: (ev, fn) => { if (ev === 'session/event') handler = fn; return () => { handler = null } } }
  registerIngest(ctx, { whale: w, herSessionId })
  return { w, dir, emit: (session, text) => handler && handler(session, { type: 'user/message', data: { content: [{ type: 'text', text }], source: { kind: 'user', clientTimeZone: 'Asia/Shanghai' } } }) }
}

test('开关关了：所有会话都记（默认，方便第一次跑通）', () => {
  const { w, dir, emit } = harness('')
  try {
    emit({ id: 'A' }, '我是跟凛说的')
    emit({ id: 'B' }, '我是跟小泉说的')
    assert.equal(w.read({ types: ['utterance'] }).length, 2)
  } finally { w.close(); rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) }
})

test('开关开了：只记她那间房', () => {
  const { w, dir, emit } = harness('HER')
  try {
    emit({ id: 'OTHER' }, '我是跟凛说的')
    emit({ id: 'HER' }, '我是跟小泉说的')
    const evs = w.read({ types: ['utterance'] })
    assert.equal(evs.length, 1)
    assert.equal(evs[0].content, '我是跟小泉说的')
  } finally { w.close(); rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) }
})

test('装配：room 有值时只摆她那间的事', () => {
  const { w, dir } = harness('')
  try {
    w.ingest('这句话是别人的', { room: 'OTHER', now: Date.now() })
    w.ingest('这句话是她的', { room: 'HER', now: Date.now() })
    const out = render(w.db, { name: '小泉', room: 'HER' }).text
    assert.ok(out.includes('这句话是她的'))
    assert.ok(!out.includes('这句话是别人的'), '别人房间的话不该出现在她的叙述里')
    assert.ok(out.includes('## 你是谁'), 'seed 不受 room 过滤影响')
  } finally { w.close(); rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) }
})

test('装配：room 留空 = 不隔离', () => {
  const { w, dir } = harness('')
  try {
    w.ingest('别人的', { room: 'OTHER', now: Date.now() })
    w.ingest('她的', { room: 'HER', now: Date.now() })
    const out = render(w.db, { name: '小泉' }).text
    assert.ok(out.includes('别人的'))
    assert.ok(out.includes('她的'))
  } finally { w.close(); rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) }
})
