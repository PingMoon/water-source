/**
 * ticket.js —— 工单的生命周期
 *
 * 一个 ticket = 一件要做完的事。状态只能往前走：
 *   open → assigned → running → done / failed / cancelled
 *
 * 卡在 assigned 和卡在 running 是两种不同的故障，哨兵要能分开处理——
 * 所以用状态机，不用一个布尔。
 */

import { newId } from '../util/ids.js'

export const TICKET_STATUS = ['open', 'assigned', 'running', 'done', 'failed', 'cancelled']

const NEXT = {
  open: ['assigned', 'cancelled'],
  assigned: ['running', 'failed', 'cancelled'],
  running: ['done', 'failed', 'cancelled'],
  done: [],
  failed: ['open'],
  cancelled: []
}

export function createTicket(db, { goal, threadKey = null, now = Date.now(), id = null }) {
  const g = String(goal ?? '').trim()
  if (!g) throw new Error('ticket 需要 goal')
  const tid = id ?? newId(now)
  db.prepare(
    'INSERT INTO ticket (id, thread_key, goal, status, assignee, created_at, result_json) VALUES (?, ?, ?, ?, NULL, ?, ?)'
  ).run(tid, threadKey, g, 'open', new Date(now).toISOString(), '{}')
  return getTicket(db, tid)
}

export function getTicket(db, id) {
  return db.prepare('SELECT * FROM ticket WHERE id = ?').get(String(id ?? '')) ?? null
}

export function listTickets(db, { status = null, limit = 50 } = {}) {
  if (status) return db.prepare('SELECT * FROM ticket WHERE status = ? ORDER BY created_at DESC LIMIT ?').all(status, limit)
  return db.prepare('SELECT * FROM ticket ORDER BY created_at DESC LIMIT ?').all(limit)
}

export function transition(db, id, to, { assignee = undefined, result = undefined, now = Date.now() } = {}) {
  const t = getTicket(db, id)
  if (!t) throw new Error('没有这个 ticket：' + id)
  if (!TICKET_STATUS.includes(to)) throw new Error('未知状态：' + to)
  if (!NEXT[t.status].includes(to)) throw new Error('不允许的流转：' + t.status + ' → ' + to)

  const ts = new Date(now).toISOString()
  const sets = ['status = ?']
  const args = [to]
  if (assignee !== undefined) { sets.push('assignee = ?'); args.push(assignee) }
  if (to === 'running') { sets.push('started_at = ?'); args.push(ts) }
  if (to === 'done' || to === 'failed' || to === 'cancelled') { sets.push('finished_at = ?'); args.push(ts) }
  if (result !== undefined) { sets.push('result_json = ?'); args.push(JSON.stringify(result)) }
  args.push(id)
  db.prepare('UPDATE ticket SET ' + sets.join(', ') + ' WHERE id = ?').run(...args)
  return getTicket(db, id)
}

export function reopen(db, id) {
  const t = getTicket(db, id)
  if (!t) throw new Error('没有这个 ticket：' + id)
  if (t.status !== 'failed') throw new Error('只有 failed 能重开，当前 ' + t.status)
  db.prepare("UPDATE ticket SET status = 'open', assignee = NULL, started_at = NULL, finished_at = NULL WHERE id = ?").run(id)
  return getTicket(db, id)
}
