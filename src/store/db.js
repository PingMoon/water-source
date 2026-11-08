/**
 * db.js —— SQLite 打开与基础保障
 *
 * 路线决策见 BLUEPRINT-M0-v1 §1.2：账本用 SQLite，因为 append-only 必须由
 * 触发器硬强制，不能靠应用层约定（那就是 dsh-fish 的 JSONL 路线）。
 *
 * 来源：dsh-persona 0.18.1 src/store/db.js 的 pragma 组合（MIT），精简重写。
 */

import { DatabaseSync } from 'node:sqlite'
import { StoreError } from '../util/errors.js'

/** node:sqlite 在 Node 22.5–23.3 需要 --experimental-sqlite；23.4+ 默认可用 */
export function assertSqliteAvailable() {
  const major = Number(process.versions.node.split('.')[0])
  if (major < 22) {
    throw new StoreError('Node 版本过低：node:sqlite 需要 >= 22（生产建议 24），当前 ' + process.version)
  }
}

/**
 * 打开数据库并设置 pragma。
 * @param {{ path: string, readOnly?: boolean }} opts
 */
export function openDatabase({ path, readOnly = false } = {}) {
  if (!path) throw new StoreError('openDatabase 需要 path')
  assertSqliteAvailable()
  let db
  try {
    db = new DatabaseSync(path, { readOnly })
  } catch (err) {
    // 只读文件、被占用、目录不存在，都在这里收口——启动时就失败，不等到写入才炸
    throw new StoreError('打不开数据库：' + (err?.message ?? err), { path, readOnly })
  }
  try {
    db.exec('PRAGMA foreign_keys = ON')
    if (!readOnly) {
      db.exec('PRAGMA journal_mode = WAL')
      db.exec('PRAGMA synchronous = NORMAL')
    }
    db.exec('PRAGMA busy_timeout = 5000')
  } catch (err) {
    try { db.close() } catch { /* ignore */ }
    throw new StoreError('设置 pragma 失败：' + (err?.message ?? err), { path })
  }
  return db
}

/** 完整性检查。返回 { ok, problems } */
export function integrityCheck(db) {
  try {
    const rows = db.prepare('PRAGMA integrity_check').all()
    const problems = rows.map((r) => String(r.integrity_check ?? '')).filter((t) => t && t !== 'ok')
    return { ok: problems.length === 0, problems }
  } catch (err) {
    return { ok: false, problems: [String(err?.message ?? err)] }
  }
}

export function closeDatabase(db) {
  try { db?.close() } catch { /* ignore */ }
}

/** 在事务里跑；失败回滚并抛出原错误 */
export function inTransaction(db, fn) {
  db.exec('BEGIN IMMEDIATE')
  try {
    const out = fn()
    db.exec('COMMIT')
    return out
  } catch (err) {
    try { db.exec('ROLLBACK') } catch { /* ignore */ }
    throw err
  }
}
