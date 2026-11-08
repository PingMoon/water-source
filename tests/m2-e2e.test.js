/**
 * m2-e2e.test.js —— M2 验收：第二次同类任务用了第一次写下来的 skill
 *
 * 这是整个项目的目的层：她会不会变聪明，不看自述，看这条。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createWhale } from '../src/core/service.js'

function fresh() {
  const dir = mkdtempSync(join(tmpdir(), 'whale-m2-'))
  const w = createWhale({
    dbPath: join(dir, 'm.db'), root: dir,
    tools: ['fs.read', 'fs.write', 'shell.run'], templateId: 'tp-default'
  })
  w.boot()
  return { w, dir }
}

test('完整闭环：没手册 → 沉淀 → 第二次用上 → 用够转正', async () => {
  const { w, dir } = fresh()
  try {
    // ---- 第一次：没有可用的手册 ----
    const first = await w.runTask('帮我调研一下 dsh-fish 这个插件能不能接进我们的系统')
    assert.equal(first.needsNewSkill, true, '第一次就该说「没有手册」')
    assert.equal(first.usedSkill, null)

    // ---- 把这次的经验写成一份 skill ----
    await w.writeSkill({
      id: 'research-lib',
      name: '调研一个开源库',
      description: '当需要判断一个开源库能不能用、能不能接进现有系统时使用',
      body: '1. 读 README 与 package.json\n2. 看 examples 和测试\n3. 写最小接入 demo\n4. 结论只写「能用/不能用/有条件能用」'
    })

    // ---- 第二次：同类任务，应该用上 ----
    const second = await w.runTask('帮我调研一下 super-agent 这个库能不能接进来')
    assert.equal(second.usedSkill, 'research-lib', '第二次没用上第一次写的 skill')
    assert.ok(second.steps.includes('最小接入 demo'))

    // ---- 第三次、第四次 ----
    await w.runTask('调研 JEV 能不能接进我们系统', { outcome: 'ok' })
    await w.runTask('调研这个开源库值得接入吗', { outcome: 'ok' })

    const st = w.skillUse('research-lib')
    assert.equal(st.total, 3, '使用次数应该是 3（第二次 + 第三第四次）')
    assert.equal(st.canPromote, true)

    const promoted = await w.maybePromote('research-lib')
    assert.equal(promoted.promoted, true)
    assert.equal((await w.skill('research-lib')).status, 'verified', '用够次数却没转正')
  } finally { w.close(); rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) }
})

test('不相关的任务不会去翻手册', async () => {
  const { w, dir } = fresh()
  try {
    await w.writeSkill({
      id: 'research-lib',
      name: '调研一个开源库',
      description: '当需要判断一个开源库能不能用、能不能接进现有系统时使用',
      body: '步骤...'
    })
    const r = await w.runTask('我妈生日是哪天')
    assert.equal(r.usedSkill, null)
    assert.equal(r.needsNewSkill, true)
    assert.equal(w.skillUse('research-lib').total, 0, '不相关任务也记了使用')
  } finally { w.close(); rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) }
})
