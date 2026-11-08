import { createLlm } from '../src/llm/client.js'
import { plan } from '../src/team/orchestrator.js'

const llm = createLlm({ timeoutMs: 60000 })
const cases = [
  '调研 dsh-fish 这个插件能不能接进我们的系统，并写一个最小接入 demo',
  '同时查 super-agent、dsh-fish、dsh-persona 三个项目各自的架构，各出一份对比报告',
  '今天天气怎么样',
  '修一下 eval.js 里「？」被当噪音丢掉的那个 bug',
  '顺便把文档也更新一下，然后发个版本'
]
for (const c of cases) {
  const t0 = Date.now()
  try {
    const p = await plan(c, { llm })
    console.log('· ' + c)
    console.log('  → ' + p.decision + ' | ' + p.reason + (p.tasks?.length ? ' | 拆成: ' + p.tasks.map(t => t.key).join(', ') : '') + '  (' + (Date.now() - t0) + 'ms)')
  } catch (e) {
    console.log('· ' + c + '\n  → ERR ' + String(e.message).slice(0, 120))
  }
}
