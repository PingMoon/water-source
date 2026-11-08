/**
 * team.js —— ticket 内的并发单元（架构 D26–D30）
 *
 * 定位：**不是调度层，是执行原语**。它不派生 ticket，只在一个 ticket 里
 * 并行跑几件事。类比线程池——不构成组织，只构成并发。
 *
 * 部分失败语义（D28–D30）：
 *   - 不连坐：一个成员失败，其他继续；
 *   - 幂等重试：重试是**同一行** attempts+1，不新增行（键 = member_key）；
 *   - 失败分类：可重试 / 不可重试，不可重试的直接标死；
 *   - 预算：单成员 ≤2 次，用尽由父级决定降级还是升级；
 *   - 不完整性必须进入归并：材料不全就要明说，不许默认补全。
 */

import { newId } from '../util/ids.js'

export const MEMBER_STATUS = ['pending', 'running', 'done', 'failed', 'timeout', 'skipped']
export const MAX_ATTEMPTS = 2
export const MAX_MEMBERS = 5

/** 可重试的错误类别；不在这张表里的一律不可重试 */
export const RETRIABLE = new Set(['timeout', 'rate_limit', 'network'])

/**
 * 给一个 ticket 开 team。
 * @param {{key:string, task:string}[]} tasks
 */
export function openTeam(db, ticketId, tasks, { now = Date.now() } = {}) {
  const list = Array.isArray(tasks) ? tasks : []
  if (!list.length) throw new Error('team 至少要一个成员')
  if (list.length > MAX_MEMBERS) throw new Error('单 ticket 不超过 ' + MAX_MEMBERS + ' 个成员')
  const seen = new Set()
  for (const t of list) {
    const k = String(t?.key ?? '').trim()
    if (!k) throw new Error('每个成员要有 key（也是幂等键）')
    if (seen.has(k)) throw new Error('成员 key 重复：' + k)
    seen.add(k)
  }
  const ts = new Date(now).toISOString()
  const ids = []
  for (const t of list) {
    const id = newId(now)
    db.prepare(
      'INSERT INTO team_member (id, ticket_id, member_key, task, status, attempts, started_at) VALUES (?, ?, ?, ?, ?, 0, ?)'
    ).run(id, ticketId, String(t.key), String(t.task ?? ''), 'pending', ts)
    ids.push(id)
  }
  return members(db, ticketId)
}

export function members(db, ticketId) {
  return db.prepare('SELECT * FROM team_member WHERE ticket_id = ? ORDER BY member_key').all(String(ticketId))
}

export function startMember(db, memberId, { now = Date.now() } = {}) {
  const m = getMember(db, memberId)
  if (!m) throw new Error('没有这个成员：' + memberId)
  db.prepare("UPDATE team_member SET status = 'running', started_at = ? WHERE id = ?").run(new Date(now).toISOString(), memberId)
  return getMember(db, memberId)
}

export function finishMember(db, memberId, { status = 'done', errorClass = null, now = Date.now() } = {}) {
  if (!['done', 'failed', 'timeout', 'skipped'].includes(status)) throw new Error('结束状态不合法：' + status)
  db.prepare('UPDATE team_member SET status = ?, error_class = ?, finished_at = ? WHERE id = ?')
    .run(status, errorClass, new Date(now).toISOString(), memberId)
  return getMember(db, memberId)
}

/**
 * 重试一个失败的成员。
 * @returns {{ok:boolean, why?:string, member?:object}}
 */
export function retryMember(db, memberId, { now = Date.now() } = {}) {
  const m = getMember(db, memberId)
  if (!m) return { ok: false, why: '没有这个成员' }
  if (!['failed', 'timeout'].includes(m.status)) return { ok: false, why: '只有 failed / timeout 能重试，当前 ' + m.status }
  if (!RETRIABLE.has(String(m.error_class ?? ''))) return { ok: false, why: '错误类别不可重试：' + (m.error_class ?? '未知') }
  if (Number(m.attempts) >= MAX_ATTEMPTS) return { ok: false, why: '重试预算用尽（已试 ' + m.attempts + ' 次）' }
  db.prepare("UPDATE team_member SET status = 'pending', attempts = attempts + 1, error_class = NULL, finished_at = NULL WHERE id = ?")
    .run(memberId)
  return { ok: true, member: getMember(db, memberId) }
}

export function getMember(db, id) {
  return db.prepare('SELECT * FROM team_member WHERE id = ?').get(String(id ?? '')) ?? null
}

/**
 * 索引：父级交给女仆长的东西。
 *
 * 只做索引，不做汇总——每份材料各自落盘，父级只说「哪几份、什么状态」。
 */
export function teamIndex(db, ticketId) {
  const all = members(db, ticketId)
  const by = { pending: 0, running: 0, done: 0, failed: 0, timeout: 0, skipped: 0 }
  for (const m of all) by[m.status] = (by[m.status] || 0) + 1
  const finished = by.done + by.failed + by.timeout + by.skipped
  return {
    ticketId,
    total: all.length,
    ...by,
    finished,
    // 不完整性：材料不全就必须让归并知道（D30）
    incomplete: by.failed + by.timeout + by.skipped > 0,
    missing: all.filter((m) => ['failed', 'timeout', 'skipped'].includes(m.status)).map((m) => m.member_key),
    items: all.map((m) => ({ key: m.member_key, status: m.status, attempts: m.attempts, errorClass: m.error_class }))
  }
}
