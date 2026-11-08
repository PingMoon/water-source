/**
 * skill-induce.test.js —— M2 下半：从材料里归纳 SKILL 草稿
 *
 * 最要紧的两条：
 *   - 允许它说「这次没什么可复用的」（skip）——所以给它这个出口；
 *   - 缺 description 的草稿一律不要（没有它就不会被想起来）。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createWhale } from '../src/core/service.js'
import { induceSkill, normalize, slug, parse } from '../src/skill/induce.js'

const fake = (content) => ({ chat: async () => ({ content }) })
const GOOD = {
  id: 'research-lib',
  name: '调研一个开源库',
  description: '当需要判断一个开源库能不能用、能不能接进现有系统时使用',
  steps: ['读 README 与 package.json', '看 examples 与测试', '写最小接入 demo', '给结论：能用/不能用/有条件能用'],
  pitfalls: ['只读 README 会漏掉没写进文档的限制']
}

test('合法输出：产出草稿，正文含步骤与坑', async () => {
  const r = await induceSkill({ materials: [{ content: '读了 dsh-fish 的源码并写了接入 demo' }], llm: fake(JSON.stringify(GOOD)) })
  assert.equal(r.ok, true)
  assert.equal(r.skill.id, 'research-lib')
  assert.ok(r.skill.body.includes('## 步骤'))
  assert.ok(r.skill.body.includes('最小接入 demo'))
  assert.ok(r.skill.body.includes('## 坑'))
})

test('模型说 skip：不产出，而且理由留得住', async () => {
  const r = await induceSkill({ materials: [{ content: '随手回了一句消息' }], llm: fake('{"skip": true, "why": "只是一次性的事"}') })
  assert.equal(r.ok, false)
  assert.equal(r.skipped, true)
  assert.ok(r.why.includes('一次性'))
})

test('缺 description：一律不要（没它就不会被想起来）', () => {
  const r = normalize({ ...GOOD, description: '' })
  assert.equal(r.ok, false)
  assert.ok(r.why.includes('description'))
})

test('缺 steps：不要', () => {
  assert.equal(normalize({ ...GOOD, steps: [] }).ok, false)
})

test('缺 name：不要', () => {
  assert.equal(normalize({ ...GOOD, name: '' }).ok, false)
})

test('id 不合法时从 name 生成，仍不合法就兜底', () => {
  assert.equal(slug('Research Lib!'), 'research-lib')
  assert.equal(slug('调研一个库'), '')
  const r = normalize({ ...GOOD, id: '!!!' })
  assert.equal(r.ok, true)
  // 中文 name 转不出英文 slug，所以兜底成 skill-<时间戳>
  assert.match(r.skill.id, /^skill-\d+$/, '应该兜底到 skill-<ts>，实际 ' + r.skill.id)
})

test('代码块包裹能抠出来', () => {
  const wrapped = '好的：\n```json\n' + JSON.stringify(GOOD) + '\n```'
  const p = parse(wrapped)
  assert.equal(p.id, 'research-lib')
})

test('非 JSON：不产出', () => {
  assert.equal(parse('这次学到了一件事'), null)
})

test('空材料：不发请求', async () => {
  let called = false
  const llm = { chat: async () => { called = true; return { content: '{}' } } }
  const r = await induceSkill({ materials: [], llm })
  assert.equal(called, false)
  assert.equal(r.skipped, true)
})

test('端到端：归纳 → 落盘 → 第二次同类任务用上', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'whale-ind-'))
  const w = createWhale({ dbPath: join(dir, 'i.db'), root: dir, tools: ['fs.read', 'fs.write', 'shell.run'], templateId: 'tp-default' })
  w.boot()
  try {
    const learned = await w.learnFrom(
      [{ content: '读了 dsh-fish 的源码，写了一个最小接入 demo，发现它是零依赖的' }],
      { llm: fake(JSON.stringify(GOOD)), goal: '调研 dsh-fish 能不能接进系统' }
    )
    assert.equal(learned.ok, true)
    assert.equal(learned.skill.status, 'draft')

    const used = await w.runTask('帮我调研一下 super-agent 这个库能不能接进来', { outcome: 'ok' })
    assert.equal(used.usedSkill, 'research-lib', '第二次没用上刚学会的手册')
  } finally { w.close(); rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) }
})
