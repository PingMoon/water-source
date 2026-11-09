import { openDatabase, closeDatabase } from '../src/store/db.js'
import { readEvents } from '../src/store/event-store.js'

const db = openDatabase({ path: process.argv[2] })
try {
  const before = readEvents(db, { includeForgotten: true })
  console.log('清理前: ' + before.length + ' 条')
  // ⚠ 一次性运维操作：账本设计上 append-only，这里显式关掉触发器再删。
  // 用户 2026-11-09 明确授权「只留 seed」。
  db.exec('DROP TRIGGER IF EXISTS event_no_update')
  db.exec('DROP TRIGGER IF EXISTS event_no_delete')
  const n = db.prepare("DELETE FROM event WHERE type != 'seed'").run()
  console.log('删除: ' + n.changes + ' 条（保留 seed）')
  const left = readEvents(db, { includeForgotten: true })
  for (const e of left) console.log('· [' + e.type + '] ' + String(e.content).slice(0, 60))
  // 触发器由迁移重建
  closeDatabase(db)
  const db2 = openDatabase({ path: process.argv[2] })
  const { migrate } = await import('../src/store/migrations.js')
  migrate(db2)
  const after = readEvents(db2, { includeForgotten: true })
  console.log('重建触发器后: ' + after.length + ' 条')
  closeDatabase(db2)
} finally { /* already closed */ }
