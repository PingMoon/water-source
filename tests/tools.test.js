import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadTemplates, getTemplate } from '../src/tools/registry.js'
import { assertTools } from '../src/tools/assertions.js'

test('模板注册表：三个模板，结构完整', () => {
  const ts = loadTemplates()
  assert.equal(ts.length, 3)
  for (const t of ts) {
    assert.ok(t.id && t.purpose && Array.isArray(t.tools) && t.tools.length)
  }
  assert.equal(getTemplate('tp-nope'), null)
})

test('精确匹配通过', () => {
  const r = assertTools(['fs.read', 'fs.write', 'shell.run'], { templateId: 'tp-default' })
  assert.equal(r.ok, true)
  assert.equal(r.templateId, 'tp-default')
})

test('并集被拒：最常见的越权方式', () => {
  assert.throws(
    () => assertTools(['fs.read', 'fs.write', 'shell.run', 'http.fetch'], { templateId: 'tp-default' }),
    /不一致/
  )
})

test('未知工具被点名', () => {
  try {
    assertTools(['fs.read', 'evil.tool'], { templateId: 'tp-default' })
    assert.fail('应该抛')
  } catch (err) {
    assert.equal(err.code, 'invariant')
    assert.ok(err.detail.unknown.includes('evil.tool'))
  }
})

test('缺工具也算不一致', () => {
  assert.throws(() => assertTools(['fs.read'], { templateId: 'tp-default' }), /不一致/)
})

test('指定不存在的模板：直接报错', () => {
  assert.throws(() => assertTools(['fs.read'], { templateId: 'tp-ghost' }), /模板不存在/)
})
