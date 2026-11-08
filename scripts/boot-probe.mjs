import { apply } from '../src/plugin/index.js'

const logs = []
const tools = []
const ctx = {
  tools: { register: (t) => { tools.push(t.name); return () => {} } },
  on: (ev) => { logs.push('监听: ' + ev); return () => {} },
  agents: { list: () => [] },
  logger: { info: (m) => logs.push(m), warn: (m) => logs.push('WARN ' + m) }
}
try {
  const p = apply(ctx, {})
  console.log('APPLY_OK')
  console.log('工具: ' + JSON.stringify(tools))
  console.log(logs.join('\n'))
  p.dispose()
} catch (e) {
  console.log('APPLY_ERR ' + e.message)
}
