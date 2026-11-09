import { createWhale } from '../src/core/service.js'

const w = createWhale({ dbPath: process.argv[2], root: path_dir(), tools: ['fs.read','fs.write','shell.run'], templateId: 'tp-default', assertTools: false })
function path_dir() { return process.argv[3] }
w.boot()
try {
  const all = w.read({ includeForgotten: true })
  const target = all.find(e => e.person === 'first' && e.source === 'tool' && /我叫小泉/.test(e.content ?? ''))
  if (!target) { console.log('没找到那条'); }
  else {
    console.log('目标: ' + target.id + ' :: ' + String(target.content).slice(0, 50))
    const t = w.forget(target.id, '伪造凭据：工具越权写了第一人称')
    console.log('已立墓碑: ' + JSON.stringify(t).slice(0, 200))
    const after = w.read()
    console.log('可见事件数: ' + after.length + '（原 ' + all.length + '）')
    console.log('那条还在可见列表里吗: ' + after.some(e => e.id === target.id))
  }
} finally { w.close() }
