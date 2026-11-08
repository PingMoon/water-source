import { apply } from '../src/plugin/index.js'

const logs = []
const ctx = {
  tools: { register: (t) => { logs.push('注册工具: ' + t.name); return () => {} } },
  on: (ev) => { logs.push('监听: ' + ev) },
  agents: { list: () => [] },
  logger: { info: (m) => logs.push(m), warn: (m) => logs.push('WARN ' + m) }
}
try {
  const p = apply(ctx, {})
  logs.push('diag: ' + JSON.stringify(p._diag ? p._diag() : []))
  p.dispose()
  console.log('APPLY_OK')
  console.log(logs.join('\n'))
} catch (e) {
  console.log('APPLY_ERR ' + e.message)
  console.log(logs.join('\n'))
}
