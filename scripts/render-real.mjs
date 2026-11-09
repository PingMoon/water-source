import { createWhale } from '../src/core/service.js'
import { render } from '../src/assemble/sections.js'

const w = createWhale({ dbPath: process.argv[2], root: process.argv[3], tools: ['fs.read','fs.write','shell.run'], templateId: 'tp-default', assertTools: false })
w.boot()
try {
  const r = render(w.db, { name: '小泉', ownerName: '主人' })
  console.log('预算: ' + r.used + ' / 2400   保留: ' + r.kept.join(',') + '   丢弃: ' + (r.dropped.join(',') || '无'))
  console.log('─'.repeat(60))
  console.log(r.text)
} finally { w.close() }
