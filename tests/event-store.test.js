/**
 * event-store.test.js —— M0 切片 1 的验收
 *
 * 覆盖 BLUEPRINT-M0-v1 §6：
 *   6.1 append-only / rebuild
 *   6.3 故障注入中可在单机验证的部分（只读、重复、约束）
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { openDatabase, integrityCheck, closeDatabase } from '../src/store/db.js'
import { migrate, currentVersion, SCHEMA_VERSION } from '../src/store/migrations.js'
import { appendEvent, readEvents, addTombstone, countEvents, rebuild } from '../src/store/event-store.js'

function freshDb() {
  const dir = mkdtempSync(join(tmpdir(), 'whale-'))
  const db = openDatabase({ path: join(dir, 'test.db') })
  migrate(db)
  return { db, dir, path: join(dir, 'test.db') }
}

function cleanup({ db, dir }) {
  closeDatabase(db)
  try { rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ }
}

test('迁移后版本正确，完整性检查通过', () => {
  const h = freshDb()
  try {
    assert.equal(currentVersion(h.db), SCHEMA_VERSION)
    assert.deepEqual(integrityCheck(h.db), { ok: true, problems: [] })
  } finally { cleanup(h) }
})

test('迁移幂等：连续跑两次不报错', () => {
  const h = freshDb()
  try {
    const again = migrate(h.db)
    assert.equal(again.from, SCHEMA_VERSION)
    assert.deepEqual(again.applied, [])
  } finally { cleanup(h) }
})

test('append 后能读回，字段不丢', () => {
  const h = freshDb()
  try {
    const ev = appendEvent(h.db, { type: 'utterance', content: '今天不想出门', person: 'first', source: 'system' })
    assert.match(ev.id, /^ev_/)
    const rows = readEvents(h.db)
    assert.equal(rows.length, 1)
    assert.equal(rows[0].content, '今天不想出门')
    assert.equal(rows[0].person, 'first')
    assert.deepEqual(rows[0].refs, [])
  } finally { cleanup(h) }
})

test('append-only：UPDATE 被触发器拒绝', () => {
  const h = freshDb()
  try {
    const ev = appendEvent(h.db, { type: 'utterance', content: '改我试试' })
    assert.throws(
      () => h.db.prepare("UPDATE event SET content = 'patched' WHERE id = ?").run(ev.id),
      /append-only/i
    )
    assert.equal(readEvents(h.db)[0].content, '改我试试')
  } finally { cleanup(h) }
})

test('append-only：DELETE 被触发器拒绝', () => {
  const h = freshDb()
  try {
    const ev = appendEvent(h.db, { type: 'utterance', content: '删我试试' })
    assert.throws(
      () => h.db.prepare('DELETE FROM event WHERE id = ?').run(ev.id),
      /append-only/i
    )
    assert.equal(countEvents(h.db), 1)
  } finally { cleanup(h) }
})

test('重复 id 被拒', () => {
  const h = freshDb()
  try {
    const ev = appendEvent(h.db, { type: 'utterance', content: 'a' })
    assert.throws(
      () => appendEvent(h.db, { id: ev.id, type: 'utterance', content: 'b' }),
      /id 重复/
    )
  } finally { cleanup(h) }
})

test('未知事件类型被拒', () => {
  const h = freshDb()
  try {
    assert.throws(() => appendEvent(h.db, { type: 'nonsense', content: 'x' }), /未知事件类型/)
  } finally { cleanup(h) }
})

test('结构义务：meaning 没有 refs 不许落库', () => {
  const h = freshDb()
  try {
    assert.throws(
      () => appendEvent(h.db, { type: 'meaning', content: '我今天想明白了一件事' }),
      /必须挂原文引用/
    )
    const base = appendEvent(h.db, { type: 'worker_material', content: '研究鲸：JEV 序列决策弱' })
    const ok = appendEvent(h.db, { type: 'meaning', content: 'JEV 不能用来做长链决策', refs: [base.id] })
    assert.equal(ok.refs.length, 1)
  } finally { cleanup(h) }
})

test('refs 指向不存在的事件被拒', () => {
  const h = freshDb()
  try {
    assert.throws(
      () => appendEvent(h.db, { type: 'meaning', content: 'x', refs: ['ev_NOPE'] }, { knownIds: new Set(['ev_OK']) }),
      /不存在的事件/
    )
  } finally { cleanup(h) }
})

test('content 超过物理上限被拒', () => {
  const h = freshDb()
  try {
    const big = '字'.repeat(3000) // 9000 字节
    assert.throws(() => appendEvent(h.db, { type: 'utterance', content: big }), /物理上限/)
  } finally { cleanup(h) }
})

test('tombstone 让事件默认不再出现，但账本还在', () => {
  const h = freshDb()
  try {
    const ev = appendEvent(h.db, { type: 'utterance', content: '这段我不想记得' })
    addTombstone(h.db, ev.id, '主人要求')
    assert.equal(readEvents(h.db).length, 0)
    assert.equal(readEvents(h.db, { includeForgotten: true }).length, 1)
    assert.equal(countEvents(h.db), 1)
  } finally { cleanup(h) }
})

test('rebuild 能读全量并给出计数', () => {
  const h = freshDb()
  try {
    appendEvent(h.db, { type: 'seed', content: '你不是助手。你刚开始存在。' })
    appendEvent(h.db, { type: 'utterance', content: '嗯' })
    const r = rebuild(h.db)
    assert.equal(r.events, 2)
    assert.ok(r.builtAt)
  } finally { cleanup(h) }
})

test('只读打开：能读，不能写', () => {
  const h = freshDb()
  try {
    appendEvent(h.db, { type: 'utterance', content: '线上一句话' })
    closeDatabase(h.db)
    const ro = openDatabase({ path: h.path, readOnly: true })
    try {
      assert.equal(readEvents(ro).length, 1)
      assert.throws(() => appendEvent(ro, { type: 'utterance', content: 'x' }))
    } finally { closeDatabase(ro) }
    h.db = openDatabase({ path: h.path })
  } finally { cleanup(h) }
})

test('首次启动会自动建父目录（否则插件在 DSH 里静默失败）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'whale-mk-'))
  const dbPath = join(dir, 'deep', 'nested', 'x.db')
  const db = openDatabase({ path: dbPath })
  try { assert.equal(existsSync(dbPath), true) } finally { closeDatabase(db); rmSync(dir, { recursive: true, force: true }) }
})

test('父路径是文件时，启动就失败（不是等到写入才炸）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'whale-bad-'))
  const fileAsDir = join(dir, 'iamfile')
  writeFileSync(fileAsDir, 'x')
  try {
    assert.throws(() => openDatabase({ path: join(fileAsDir, 'a.db') }), /建不了数据目录|打不开数据库/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
