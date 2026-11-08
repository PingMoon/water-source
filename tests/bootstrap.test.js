import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { openDatabase, closeDatabase } from '../src/store/db.js'
import { migrate } from '../src/store/migrations.js'
import { readEvents } from '../src/store/event-store.js'
import { writeSeed, DEFAULT_CONTRACT } from '../src/bootstrap/seed.js'
import { checkContract } from '../src/bootstrap/contract-check.js'

function fresh() {
  const dir = mkdtempSync(join(tmpdir(), 'whale-seed-'))
  const db = openDatabase({ path: join(dir, 's.db') })
  migrate(db)
  return { db, dir }
}

test('默认契约能过检查（只写处境，不写形容词）', () => {
  assert.equal(checkContract(DEFAULT_CONTRACT).ok, true, JSON.stringify(checkContract(DEFAULT_CONTRACT).violations))
})

test('允许：边界与事实', () => {
  for (const s of ['你可以拒绝。', '你不能读取自己的参数。', '你刚开始存在。', '你不是助手。']) {
    assert.equal(checkContract(s).ok, true, '误伤了：' + s)
  }
})

test('允许：疑问句不算形容词描述', () => {
  assert.equal(checkContract('你现在有空吗').ok, true)
})

test('禁止：身份定义与形容词', () => {
  for (const s of ['你是一个温柔的人', '你很温柔', '你擅长抓重点', '你的句子很短', '你天生就善良', '你应该更主动']) {
    const r = checkContract(s)
    assert.equal(r.ok, false, '该拦没拦：' + s)
    assert.ok(r.violations.length > 0)
  }
})

test('空库：写入 seed 成功', () => {
  const { db, dir } = fresh()
  try {
    const r = writeSeed(db)
    assert.equal(r.ok, true)
    const events = readEvents(db, { types: ['seed'] })
    assert.equal(events.length, 1)
    assert.equal(events[0].person, 'first')
  } finally { closeDatabase(db); rmSync(dir, { recursive: true, force: true }) }
})

test('已有历史：拒绝覆写', () => {
  const { db, dir } = fresh()
  try {
    writeSeed(db)
    assert.throws(() => writeSeed(db), /拒绝覆写/)
  } finally { closeDatabase(db); rmSync(dir, { recursive: true, force: true }) }
})

test('契约里有形容词：拒绝写入，且账本不变', () => {
  const { db, dir } = fresh()
  try {
    assert.throws(() => writeSeed(db, { contract: '你是一个温柔的人' }), /形容词|身份定义/)
    assert.equal(readEvents(db).length, 0)
  } finally { closeDatabase(db); rmSync(dir, { recursive: true, force: true }) }
})
