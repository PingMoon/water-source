/** skill.test.js —— M2：存储 / 索引 / 匹配 / 晋升 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createWhale } from '../src/core/service.js'
import { buildIndex } from '../src/skill/index.js'
import { matchSkill } from '../src/skill/match.js'

function fresh() {
  const dir = mkdtempSync(join(tmpdir(), 'whale-sk-'))
  const w = createWhale({
    dbPath: join(dir, 's.db'), root: dir,
    tools: ['fs.read', 'fs.write', 'shell.run'], templateId: 'tp-default'
  })
  w.boot()
  return { w, dir }
}

const RESEARCH = {
  id: 'research-lib',
  name: '调研一个开源库',
  description: '当需要判断一个开源库能不能用、并给出最小接入示例时使用',
  body: '1. 读 README 和 package.json\n2. 找 examples 与 test\n3. 写一个最小可跑的接入 demo'
}

test('写 skill → 读回来，frontmatter 不丢', async () => {
  const { w, dir } = fresh()
  try {
    await w.writeSkill({ ...RESEARCH, status: 'draft' })
    const s = await w.skill('research-lib')
    assert.equal(s.name, '调研一个开源库')
    assert.equal(s.status, 'draft')
    assert.ok(s.body.includes('读 README'))
  } finally { w.close(); rmSync(dir, { recursive: true, force: true }) }
})

test('没有 description 不许写（它决定什么时候被想起来）', async () => {
  const { w, dir } = fresh()
  try {
    await assert.rejects(() => w.writeSkill({ id: 'x', name: 'x', description: '' }), /description/)
  } finally { w.close(); rmSync(dir, { recursive: true, force: true }) }
})

test('索引有预算：装不下的留在盘上，不进索引', async () => {
  const many = Array.from({ length: 40 }, (_, i) => ({
    id: 's' + i, description: '这是一个很长的描述用来占预算'.repeat(2), status: 'draft'
  }))
  const idx = buildIndex(many, { budget: 300 })
  assert.ok(idx.used <= 300)
  assert.ok(idx.skipped.length > 0, '预算没起作用')
})

test('deprecated 的 skill 不进索引、不参与匹配', async () => {
  const list = [
    { id: 'a', description: '调研开源库并写接入 demo', status: 'deprecated' },
    { id: 'b', description: '完全无关的事情', status: 'verified' }
  ]
  const idx = buildIndex(list)
  assert.ok(!idx.text.includes('a:'))
  const hits = matchSkill('调研一个库并写 demo', list)
  assert.equal(hits.length, 0)
})

test('匹配：像的任务命中，不像的不命中', async () => {
  const { w, dir } = fresh()
  try {
    await w.writeSkill(RESEARCH)
    const hit = await w.matchSkill('帮我调研一下 super-agent 这个库能不能接')
    assert.equal(hit.length >= 1, true)
    assert.equal(hit[0].skill.id, 'research-lib')

    const miss = await w.matchSkill('我妈生日是哪天')
    assert.equal(miss.length, 0)
  } finally { w.close(); rmSync(dir, { recursive: true, force: true }) }
})

test('用满 3 次且无失败 → 草稿转正', async () => {
  const { w, dir } = fresh()
  try {
    await w.writeSkill(RESEARCH)
    for (let i = 0; i < 3; i++) await w.runTask('帮我调研这个开源库能不能用', { outcome: 'ok', now: 1000 + i })
    const st = w.skillUse('research-lib')
    assert.equal(st.total, 3)
    assert.equal(st.canPromote, true)
    const r = await w.maybePromote('research-lib')
    assert.equal(r.promoted, true)
    assert.equal((await w.skill('research-lib')).status, 'verified')
  } finally { w.close(); rmSync(dir, { recursive: true, force: true }) }
})

test('有一次失败就不晋升', async () => {
  const { w, dir } = fresh()
  try {
    await w.writeSkill(RESEARCH)
    await w.runTask('调研这个库', { outcome: 'fail', now: 1000 })
    await w.runTask('调研这个库', { outcome: 'ok', now: 2000 })
    await w.runTask('调研这个库', { outcome: 'ok', now: 3000 })
    const r = await w.maybePromote('research-lib')
    assert.equal(r.promoted, false)
    assert.equal((await w.skill('research-lib')).status, 'draft')
  } finally { w.close(); rmSync(dir, { recursive: true, force: true }) }
})
