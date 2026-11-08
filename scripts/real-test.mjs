/**
 * real-test.mjs —— 真模型验证（不打印 key）
 *
 * 跑法：DEEPSEEK_API_KEY=sk-... node scripts/real-test.mjs
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createWhale } from '../src/core/service.js'
import { createLlm } from '../src/llm/client.js'

const llm = createLlm({ timeoutMs: 90_000 })
console.log('配置：', JSON.stringify(llm.config))

const dir = mkdtempSync(join(tmpdir(), 'whale-real-'))
const w = createWhale({
  dbPath: join(dir, 'real.db'),
  tools: ['fs.read', 'fs.write', 'shell.run'],
  templateId: 'tp-default'
})

const MATERIALS = [
  '今天翻了 JEV 的独立评测：ALFWorld 序列决策 35%，TextWorld 42%，而且会重复做无效动作。',
  '看了 super-agent 的 routines 实现：它是主人手写的文件，模型手上根本没有能改它的工具。',
  '读 dsh-fish 的 guard.js：重塑人格的输入根本不递给模型，凭据出门前拦下，外来文本先洗一遍。',
  '发现 dsh-fish 每轮只注入 6 条记忆、身份段上限 2400 字——它的注释说注意力是归一化的，塞多了每条都变轻。'
]

try {
  const boot = w.boot()
  console.log('boot ok:', boot.ok, '| schema', boot.schemaVersion)

  const ids = MATERIALS.map((content) => w.append({ type: 'worker_material', content }).id)
  console.log('写入材料:', ids.length, '条')

  const t0 = Date.now()
  const run = await w.consolidate({ llm })
  const ms = Date.now() - t0

  console.log('─'.repeat(60))
  console.log('耗时:', ms + 'ms')
  console.log('accepted:', run.accepted, '| rejected:', run.rejected, '| dropped:', run.dropped)
  console.log('dropped 明细:', JSON.stringify(run.droppedDetail))
  console.log('vetoed 明细:', JSON.stringify(run.vetoedDetail))

  const meanings = w.read({ types: ['meaning'] })
  console.log('─'.repeat(60))
  for (const m of meanings) {
    console.log('· [' + m.refs.length + ' refs] ' + m.content)
  }

  const st = w.state()
  console.log('─'.repeat(60))
  console.log('state:', JSON.stringify({ day: st.day, stage: st.stageName, beliefs: st.beliefs.length }))
  console.log('projection:', JSON.stringify(w.projection()))
  console.log('run:', JSON.stringify(w.lastRun().stats))

  const t2 = Date.now()
  const remote = await w.projectionForRemote({ llm })
  console.log('─'.repeat(60))
  console.log('出本机投影（改写版）耗时:', (Date.now() - t2) + 'ms')
  console.log('rewritten:', remote.rewritten, remote.degraded ? '| degraded: ' + remote.degraded : '')
  for (const b of remote.beliefs || []) console.log('  · ' + b)
} finally {
  w.close()
  rmSync(dir, { recursive: true, force: true })
}
