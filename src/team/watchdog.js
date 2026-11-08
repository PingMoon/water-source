/**
 * watchdog.js —— 哨兵
 *
 * 只做一件事：**发现卡住的东西，把它标出来**。
 *
 * 三条铁律（架构 §3.15）：
 *   1. 只碰状态，不碰内容——它不读 ticket 的 goal、不读 member 的 task；
 *   2. 不改历史——只把状态推进到终态，不删行、不改已完成的；
 *   3. 默认只报告，要动必须显式 sweep——「自动修复」在没人看着的时候很危险。
 */

export const DEFAULT_TIMEOUTS = {
  /** open 太久没人接（排队积压） */
  openMs: 30 * 60_000,
  /** assigned 太久没开工（分下去了但没动） */
  assignedMs: 5 * 60_000,
  /** running 太久没结束（可能卡死） */
  runningMs: 30 * 60_000,
  /** team 成员跑太久 */
  memberMs: 10 * 60_000,
  /** 节点多久没心跳算死 */
  heartbeatMs: 90_000
}

const ms = (iso) => {
  const t = Date.parse(String(iso ?? ''))
  return Number.isFinite(t) ? t : 0
}

export function mergeTimeouts(over = {}) {
  const out = { ...DEFAULT_TIMEOUTS }
  for (const k of Object.keys(DEFAULT_TIMEOUTS)) {
    if (Number.isFinite(over?.[k]) && over[k] >= 0) out[k] = over[k]
  }
  return out
}

/**
 * 只读扫描：报告卡住的东西，不改任何状态。
 */
export function scan(db, { now = Date.now(), timeouts = {} } = {}) {
  const T = mergeTimeouts(timeouts)
  const report = {
    checkedAt: new Date(now).toISOString(),
    stalledOpen: [],
    stalledAssigned: [],
    stalledRunning: [],
    stalledMembers: [],
    deadNodes: []
  }

  const tickets = db.prepare("SELECT * FROM ticket WHERE status IN ('open','assigned','running')").all()
  for (const t of tickets) {
    if (t.status === 'open') {
      const age = now - ms(t.created_at)
      if (age > T.openMs) report.stalledOpen.push({ id: t.id, why: '排队 ' + Math.round(age / 60000) + ' 分钟没人接' })
    } else if (t.status === 'assigned') {
      const age = now - ms(t.assigned_at ?? t.created_at)
      if (age > T.assignedMs) report.stalledAssigned.push({ id: t.id, assignee: t.assignee, why: '分配后 ' + Math.round(age / 60000) + ' 分钟没开工' })
    } else if (t.status === 'running') {
      const age = now - ms(t.started_at)
      if (age > T.runningMs) report.stalledRunning.push({ id: t.id, assignee: t.assignee, why: '跑了 ' + Math.round(age / 60000) + ' 分钟没结束' })
    }
  }

  const openTickets = new Set(tickets.map((t) => t.id))
  const members = db.prepare("SELECT * FROM team_member WHERE status = 'running'").all()
  for (const m of members) {
    if (!openTickets.has(m.ticket_id)) continue
    const age = now - ms(m.started_at)
    if (age > T.memberMs) report.stalledMembers.push({ id: m.id, ticketId: m.ticket_id, key: m.member_key, why: '跑了 ' + Math.round(age / 60000) + ' 分钟' })
  }

  for (const n of db.prepare('SELECT * FROM worker_node WHERE online = 1').all()) {
    const age = now - ms(n.last_beat)
    if (age > T.heartbeatMs) report.deadNodes.push({ id: n.id, name: n.name, why: '心跳停了 ' + Math.round(age / 1000) + ' 秒' })
  }

  report.total = report.stalledOpen.length + report.stalledAssigned.length +
    report.stalledRunning.length + report.stalledMembers.length + report.deadNodes.length
  return report
}

/**
 * 执行清理：把卡住的推进到终态。
 *
 * ⚠ 只做三件事：
 *   - ticket → failed（不删，可 reopen）
 *   - member → timeout（保留 attempts，可重试）
 *   - node  → offline（不删，回来再心跳会恢复）
 *
 * @returns {{ ok:boolean, actions:Array, dryRun:boolean, report:object }}
 */
export function sweep(db, { now = Date.now(), timeouts = {}, dryRun = true } = {}) {
  const T = mergeTimeouts(timeouts)
  const report = scan(db, { now, timeouts: T })
  const actions = []

  const ts = new Date(now).toISOString()
  const failTicket = (id, why) => {
    actions.push({ type: 'ticket.failed', id, why })
    if (dryRun) return
    db.prepare("UPDATE ticket SET status = 'failed', finished_at = ?, result_json = ? WHERE id = ? AND status != 'failed'")
      .run(ts, JSON.stringify({ watchdog: why }), id)
  }
  const timeoutMember = (id, why) => {
    actions.push({ type: 'member.timeout', id, why })
    if (dryRun) return
    db.prepare("UPDATE team_member SET status = 'timeout', error_class = 'timeout', finished_at = ? WHERE id = ? AND status = 'running'")
      .run(ts, id)
  }
  const offlineNode = (id, why) => {
    actions.push({ type: 'node.offline', id, why })
    if (dryRun) return
    db.prepare('UPDATE worker_node SET online = 0 WHERE id = ?').run(id)
  }

  for (const x of report.stalledOpen) failTicket(x.id, x.why)
  for (const x of report.stalledAssigned) failTicket(x.id, x.why)
  for (const x of report.stalledRunning) failTicket(x.id, x.why)
  for (const x of report.stalledMembers) timeoutMember(x.id, x.why)
  for (const x of report.deadNodes) offlineNode(x.id, x.why)

  return { ok: true, dryRun, actions, report }
}
