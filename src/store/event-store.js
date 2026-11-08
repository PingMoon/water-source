/**
 * event-store.js —— 账本读写（唯一写入口）
 *
 * 铁律：
 *   - 只有 appendEvent 能写 event 表；update/delete 由触发器在 DB 层拒绝；
 *   - 读取时被 tombstone 标记的事件默认过滤（派生物按标记过滤，账本本身不动）。
 *
 * 来源：dsh-fish store.js 的「唯一写入口 + 显式报错」形状（MIT），存储介质换成 SQLite。
 */

import { ValidationError, StoreError } from '../util/errors.js'
import { validateEvent, rowToEvent } from '../ledger/schema.js'
import { inTransaction } from './db.js'

/**
 * 追加一条事件。
 * @param {object} db
 * @param {object} raw 未校验事件
 * @param {{ knownIds?: Set<string> | null }} opts
 * @throws {ValidationError|StoreError}
 */
export function appendEvent(db, raw, opts = {}) {
  const ev = validateEvent(raw, opts)
  try {
    db.prepare(
      'INSERT INTO event (id, schema_v, ts, type, source, person, content, refs_json, meta_json) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(ev.id, ev.schema_v, ev.ts, ev.type, ev.source, ev.person, ev.content, ev.refs_json, ev.meta_json)
  } catch (err) {
    const msg = String(err?.message ?? err)
    if (/UNIQUE/i.test(msg)) throw new ValidationError('事件 id 重复：' + ev.id)
    if (/CHECK/i.test(msg)) throw new ValidationError('字段不满足约束：' + msg)
    throw new StoreError('写入失败：' + msg)
  }
  return rowToEvent({
    id: ev.id, schema_v: ev.schema_v, ts: ev.ts, type: ev.type, source: ev.source,
    person: ev.person, content: ev.content, refs_json: ev.refs_json, meta_json: ev.meta_json
  })
}

/**
 * 读事件。
 * @param {{ types?: string[], person?: string, since?: string, until?: string, limit?: number, includeForgotten?: boolean }} filter
 */
export function readEvents(db, filter = {}) {
  const where = []
  const args = []
  if (Array.isArray(filter.types) && filter.types.length) {
    where.push('e.type IN (' + filter.types.map(() => '?').join(',') + ')')
    args.push(...filter.types)
  }
  if (filter.person) { where.push('e.person = ?'); args.push(filter.person) }
  if (filter.since) { where.push('e.ts >= ?'); args.push(filter.since) }
  if (filter.until) { where.push('e.ts <= ?'); args.push(filter.until) }
  if (!filter.includeForgotten) {
    where.push('NOT EXISTS (SELECT 1 FROM event_tombstone t WHERE t.event_id = e.id)')
  }
  let sql = 'SELECT e.* FROM event e'
  if (where.length) sql += ' WHERE ' + where.join(' AND ')
  sql += ' ORDER BY e.id ASC'
  if (Number.isInteger(filter.limit) && filter.limit > 0) { sql += ' LIMIT ?'; args.push(filter.limit) }
  const rows = db.prepare(sql).all(...args)
  return rows.map(rowToEvent)
}

/** 加遗忘标记（不物理删除，账本不动） */
export function addTombstone(db, eventId, reason) {
  const id = String(eventId ?? '')
  if (!id) throw new ValidationError('addTombstone 需要 eventId')
  const at = new Date().toISOString()
  try {
    db.prepare('INSERT INTO event_tombstone (event_id, reason, at) VALUES (?, ?, ?)').run(id, String(reason ?? ''), at)
  } catch (err) {
    const msg = String(err?.message ?? err)
    if (/UNIQUE/i.test(msg)) throw new ValidationError('这条事件已经被标记遗忘：' + id)
    throw new StoreError('写标记失败：' + msg)
  }
  return { event_id: id, reason: String(reason ?? ''), at }
}

/** 事件总数（含已遗忘），用于 rebuild 与自检 */
export function countEvents(db) {
  const row = db.prepare('SELECT COUNT(*) AS c FROM event').get()
  return Number(row?.c ?? 0)
}

/**
 * 从账本重建派生。
 * M0 只做「读全量 + 计数」的骨架，derive 落地后返回真正的状态模型。
 */
export function rebuild(db) {
  const events = readEvents(db, { includeForgotten: true })
  return { events: events.length, builtAt: new Date().toISOString() }
}
