import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createWhale } from '../src/core/service.js'
import { createLlm } from '../src/llm/client.js'

const llm = createLlm({ timeoutMs: 90000 })
const dir = mkdtempSync(join(tmpdir(), 'ws-induce-'))
const w = createWhale({ dbPath: join(dir, 'i.db'), root: dir, tools: ['fs.read', 'fs.write', 'shell.run'], templateId: 'tp-default' })
w.boot()

const MATERIALS = [
  { content: '先读了 dsh-fish 的 README 和 package.json，发现它零依赖、约 3.5 万行。' },
  { content: '又翻了 lib/ 下 108 个模块，重点看 store.js 和 guard.js。' },
  { content: '发现它的 append-only 只是约定：代码只调 appendFile，没有硬强制。' },
  { content: '写了一个最小的接入 demo，确认插件能加载、工具能注册。' },
  { content: '结论：能用，但 append-only 需要换成 SQLite 才能硬保证。' }
]
const t0 = Date.now()
const r = await w.learnFrom(MATERIALS, { llm, goal: '调研 dsh-fish 能不能接进我们的系统' })
console.log('耗时 ' + (Date.now() - t0) + 'ms')
console.log(JSON.stringify(r, null, 2).slice(0, 2000))
w.close()
rmSync(dir, { recursive: true, force: true })
