import { createWhale } from '../src/core/service.js'
import { render } from '../src/assemble/sections.js'
const w = createWhale({ dbPath: process.argv[2], root: process.argv[3], tools: ['fs.read','fs.write','shell.run'], templateId: 'tp-default', assertTools: false })
w.boot()
try {
  const r = render(w.db, { name: '小泉', ownerName: '主人', room: process.argv[4] ?? '' })
  console.log('事件数: ' + w.read().length + '   预算: ' + r.used + '/2400')
  console.log('─'.repeat(50))
  console.log(r.text)
} finally { w.close() }
