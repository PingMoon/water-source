import { createWhale } from '../src/core/service.js'

const w = createWhale({ dbPath: process.argv[2], root: process.argv[3], tools: ['fs.read','fs.write','shell.run'], templateId: 'tp-default', assertTools: false })
w.boot()
try {
  const all = w.read({ includeForgotten: true })
  const forged = all.filter(e => e.type === 'utterance' && e.person === 'first' && e.source === 'tool')
  console.log('越权写的第一人称: ' + forged.length + ' 条')
  for (const e of forged) {
    console.log('  清: ' + String(e.content).slice(0, 50))
    w.forget(e.id, '伪造凭据：工具写的第一人称（person 是身份，不是参数）')
  }
  const left = w.read().filter(e => e.person === 'first')
  console.log('还剩 person=first: ' + left.length + ' 条' + (left.length ? ' :: ' + left.map(e=>String(e.content).slice(0,30)).join(' | ') : ''))
} finally { w.close() }
