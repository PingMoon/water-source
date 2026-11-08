/**
 * smoke.mjs —— M0 端到端冒烟：装配 → 写材料 → 归并 → 派生 → 投影
 *
 * 用假模型，不联网。跑法：node scripts/smoke.mjs
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createWhale } from '../src/core/service.js'

const dir = mkdtempSync(join(tmpdir(), 'whale-smoke-'))
const w = createWhale({
  dbPath: join(dir, 'smoke.db'),
  tools: ['fs.read', 'fs.write', 'shell.run'],
  templateId: 'tp-default'
})

try {
  const boot = w.boot()
  console.log('boot:', JSON.stringify({ ok: boot.ok, schema: boot.schemaVersion, seeded: boot.seeded, events: boot.events, tools: boot.tools.templateId }))

  const m1 = w.append({ type: 'worker_material', content: 'JEV 在序列决策基准上只有 35%' })
  const m2 = w.append({ type: 'worker_material', content: 'JEV 一次请求可以并行回答多个问题' })

  // 假模型：只按材料 id 产出草稿，模拟真实返回
  const fake = {
    chat: async () => ({
      content: JSON.stringify([
        { meaning: '我不该拿 JEV 去做长链决策', refs: [m1.id] },
        { meaning: 'JEV 适合做并行的窄判断', refs: [m2.id] }
      ])
    })
  }
  const run = await w.consolidate({ llm: fake })
  console.log('consolidate:', JSON.stringify({ accepted: run.accepted, rejected: run.rejected, dropped: run.dropped }))

  const st = w.state()
  console.log('state:', JSON.stringify({ day: st.day, stage: st.stageName, beliefs: st.beliefs.length, top: st.topBeliefs.map(b => b.text) }))

  const pr = w.projection()
  console.log('projection:', JSON.stringify({ stage: pr.stage, beliefs: pr.beliefs, rewritten: pr.rewritten }))
  console.log('projection 里含事件 id ?', JSON.stringify(pr).includes('ev_'))

  const folded = w.folded()
  console.log('folded:', JSON.stringify(folded))

  const last = w.lastRun()
  console.log('run status:', last.status, '| stats:', JSON.stringify(last.stats))
} finally {
  w.close()
  rmSync(dir, { recursive: true, force: true })
}
