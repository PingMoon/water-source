/**
 * thread.js —— 线索（Thread）
 *
 * 键规则（架构 D11）：**房间标识 + 递增话题序号**，确定性、可复算。
 * 不用 LLM 生成话题标签做键——那玩意儿每次不一样，键就散了。
 *
 * 旁路由调用方判断（eval.js），这里只管「开、找、碰」。
 */

/** 确定性键：room#seq */
export function makeThreadKey(room, seq) {
  const r = String(room ?? '').trim() || 'local'
  const n = Number(seq)
  if (!Number.isInteger(n) || n < 1) throw new Error('thread seq 必须是正整数')
  return r + '#' + n
}

export function parseThreadKey(key) {
  const s = String(key ?? '')
  const i = s.lastIndexOf('#')
  if (i <= 0) return null
  const seq = Number(s.slice(i + 1))
  if (!Number.isInteger(seq) || seq < 1) return null
  return { room: s.slice(0, i), seq }
}

/** 这个房间下最近一条线索（不限时间） */
export function latestThread(db, room) {
  const r = db.prepare('SELECT * FROM thread WHERE room = ? ORDER BY last_at DESC LIMIT 1').get(String(room ?? 'local'))
  return r ?? null
}

/** 开一条新线索：seq = 该房间已有最大 seq + 1 */
export function openThread(db, room, now = Date.now()) {
  const r = String(room ?? '').trim() || 'local'
  const row = db.prepare('SELECT MAX(seq) AS m FROM thread WHERE room = ?').get(r)
  const seq = Number(row?.m ?? 0) + 1
  const key = makeThreadKey(r, seq)
  const ts = new Date(now).toISOString()
  db.prepare('INSERT INTO thread (key, room, seq, created_at, last_at) VALUES (?, ?, ?, ?, ?)')
    .run(key, r, seq, ts, ts)
  return { key, room: r, seq, createdAt: ts, lastAt: ts }
}

export function getThread(db, key) {
  return db.prepare('SELECT * FROM thread WHERE key = ?').get(String(key ?? '')) ?? null
}

/** 碰一下：更新 last_at（旁路 TTL 的依据） */
export function touchThread(db, key, now = Date.now()) {
  db.prepare('UPDATE thread SET last_at = ? WHERE key = ?').run(new Date(now).toISOString(), String(key ?? ''))
  return getThread(db, key)
}

/** 找这个房间的活跃线索：未超 TTL 才返回。这就是旁路的判据。 */
export function activeThread(db, room, now = Date.now(), ttlMs = 30 * 60_000) {
  const row = latestThread(db, room)
  if (!row) return null
  const last = Date.parse(row.last_at)
  if (!Number.isFinite(last)) return null
  if (now - last > ttlMs) return null
  return row
}

/** 列出线索（观测用） */
export function listThreads(db, limit = 20) {
  return db.prepare('SELECT * FROM thread ORDER BY last_at DESC LIMIT ?').all(limit)
}
