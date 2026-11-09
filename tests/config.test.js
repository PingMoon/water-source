/**
 * config.test.js —— 运行时配置：白名单校验 + 原子写
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { load, save, patch, validateOne, validatePatch, DEFAULTS, EDITABLE } from '../src/config.js'

function dir() {
  const d = mkdtempSync(join(tmpdir(), 'ws-cfg-'))
  return { d, rm: () => rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) }
}

test('没配置文件时全是默认值', () => {
  const { d, rm } = dir()
  try {
    assert.deepEqual(load(d), DEFAULTS)
  } finally { rm() }
})

test('只允许白名单里的键', () => {
  assert.equal(validateOne('herName', '小泉').ok, true)
  assert.equal(validateOne('root', '/etc').ok, false)
  assert.equal(validateOne('tools', ['x']).ok, false)
  assert.equal(EDITABLE.has('root'), false)
})

test('stripHostPrompt 只收布尔', () => {
  assert.equal(validateOne('stripHostPrompt', true).ok, true)
  assert.equal(validateOne('stripHostPrompt', 'true').ok, false)
})

test('会话 id 只收字母数字 - _', () => {
  assert.equal(validateOne('herSessionId', 'abc-123_X').ok, true)
  assert.equal(validateOne('herSessionId', '../../etc/passwd').ok, false)
  assert.equal(validateOne('herSessionId', 'a'.repeat(200)).ok, false)
})

test('patch 落盘，load 读回来', () => {
  const { d, rm } = dir()
  try {
    const r = patch(d, { herName: '小泉', ownerName: '主人' })
    assert.equal(r.ok, true)
    const back = load(d)
    assert.equal(back.herName, '小泉')
    assert.equal(back.ownerName, '主人')
  } finally { rm() }
})

test('非法键整批拒，一个都不写', () => {
  const { d, rm } = dir()
  try {
    const before = load(d)
    const r = patch(d, { herName: '小泉', root: '/evil' })
    assert.equal(r.ok, false)
    assert.ok(r.why.includes('root'))
    assert.deepEqual(load(d), before, '被拒时不该写盘')
  } finally { rm() }
})

test('原子写：没有残留 .tmp', () => {
  const { d, rm } = dir()
  try {
    save(d, { ...DEFAULTS, herName: 'x' })
    const files = readFileSync(join(d, 'config.json'), 'utf8')
    assert.ok(files.includes('"herName": "x"'))
  } finally { rm() }
})
