/**
 * pool.js —— 节点池
 *
 * 节点是**同质、可替换**的：没有身份，只有容量。专长靠挂载的虚拟角色，
 * 不靠「某一只鲸」。
 *
 * pickNode 的两条规则（照 super-agent 的 mesh 做法）：
 *   1. 最少负载 —— 卸载最轻的；
 *   2. **对同一个 ticket 稳定** —— 同一票多次问，只要负载没变，答案不变。
 *      否则「谁在干这活」会每问一次就变一个。
 */

import { transition, getTicket } from './ticket.js'

export function registerNode(db, { id, name, capacity = 1, now = Date.now() }) {
  const nid = String(id ?? '').trim()
  if (!nid) throw new Error('node 需要 id')
  const cap = Math.max(1, Math.floor(Number(capacity) || 1))
  db.prepare(
    'INSERT INTO worker_node (id, name, capacity, online, last_beat) VALUES (?, ?, ?, 1, ?) ' +
    'ON CONFLICT(id) DO UPDATE SET name = excluded.name, capacity = excluded.capacity, online = 1, last_beat = excluded.last_beat'
  ).run(nid, String(name ?? nid), cap, new Date(now).toISOString())
  return getNode(db, nid)
}

export function getNode(db, id) {
  return db.prepare('SELECT * FROM worker_node WHERE id = ?').get(String(id ?? '')) ?? null
}

export function listNodes(db) {
  return db.prepare('SELECT * FROM worker_node ORDER BY id').all()
}

export function heartbeat(db, id, now = Date.now()) {
  db.prepare('UPDATE worker_node SET last_beat = ?, online = 1 WHERE id = ?').run(new Date(now).toISOString(), String(id ?? ''))
  return getNode(db, id)
}

export function setOnline(db, id, online) {
  db.prepare('UPDATE worker_node SET online = ? WHERE id = ?').run(online ? 1 : 0, String(id ?? ''))
  return getNode(db, id)
}

/** 这个节点上还没结束的 ticket 数 */
export function loadOf(db, nodeId) {
  const row = db.prepare(
    "SELECT COUNT(*) AS c FROM ticket WHERE assignee = ? AND status IN ('assigned','running')"
  ).get(String(nodeId ?? ''))
  return Number(row?.c ?? 0)
}

function hash(s) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/**
 * 挑一个节点。
 * @returns {object|null} 没有可用节点时返回 null（调用方决定排队还是报错）
 */
export function pickNode(db, ticketId, { now = Date.now() } = {}) {
  const nodes = listNodes(db).filter((n) => n.online)
  if (!nodes.length) return null
  const scored = nodes
    .map((n) => {
      const load = loadOf(db, n.id)
      return { node: n, load, full: load >= Number(n.capacity), tie: hash(String(ticketId) + '|' + n.id) }
    })
    .filter((x) => !x.full)
    .sort((a, b) => a.load - b.load || a.tie - b.tie)
  return scored.length ? { ...scored[0].node, load: scored[0].load } : null
}

/** 分配：挑节点 + 把 ticket 推成 assigned */
export function assign(db, ticketId, { now = Date.now() } = {}) {
  const pick = pickNode(db, ticketId, { now })
  if (!pick) return { ok: false, why: '没有可用节点' }
  const t = getTicket(db, ticketId)
  if (!t) return { ok: false, why: '没有这个 ticket' }
  if (t.status !== 'open') return { ok: false, why: 'ticket 状态是 ' + t.status + '，不能分配' }
  transition(db, ticketId, 'assigned', { assignee: pick.id, now })
  return { ok: true, node: pick.id, load: pick.load }
}
