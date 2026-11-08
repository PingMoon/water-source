/**
 * orchestrator.js —— 女仆长的编排部分
 *
 * 一件活来了，它只做三个决定：
 *   1. **做不做**（reject：不值得、越界、重复）
 *   2. **拆不拆**（single / team）
 *   3. **派给谁**（pool.pickNode）
 *
 * 拆的判据（架构 §3.14）：
 *   **新子工作是否需要一个看不到当前上下文的执行者。**
 * 需要 → 拆；同一 worker 顺序切换工具面即可 → 不拆。
 *
 * 不是按「角色」拆，也不是按「阶段」拆。研究和代码各占一半的任务，
 * 只要上下文能连着走，就该一个 ticket 走完。
 *
 * 降级原则：模型给不出合法答案时，**默认 single**——做一件事，不拆。
 * 拆错的代价（上下文断、交接丢信息）比不拆大。
 */

import { LlmError } from '../llm/client.js'
import { createTicket, transition, getTicket } from './ticket.js'
import { assign, pickNode } from './pool.js'
import { openTeam, MAX_MEMBERS } from './team.js'

export const DECISION = { SINGLE: 'single', TEAM: 'team', REJECT: 'reject' }

const SYSTEM = [
  '你在决定一件事该怎么派给执行单元。',
  '',
  '只输出 JSON，不要解释、不要代码块：',
  '{',
  '  "decision": "single" | "team" | "reject",',
  '  "reason": "一句话说明为什么",',
  '  "tasks": [{"key": "英文短key", "task": "这一块要产出什么"}]',
  '}',
  '',
  '判据：',
  '- **拆不拆看一件事**：新子工作是否需要「一个看不到当前上下文的执行者」。',
  '  需要 → team；同一个执行者顺序做完就行 → single。',
  '- **不按角色拆**（不是「先研究鲸再代码鲸」）。按**可独立完成的产物**拆。',
  '- 交接会丢信息，所以能连着做就别拆。',
  '- team 最多 5 块，每块的 key 用英文小写连字符。',
  '- 不值得做（重复、越界、明显是闲聊）→ reject。',
  '',
  '示例：',
  '  「调研一个库并写接入 demo」→ single（研究完直接写，上下文连着）',
  '  「同时查三个完全不同的库、各出一份报告」→ team（三份独立产物，互不看上下文）',
  '  「帮我看看今天天气」→ reject（一句就能答，不值得开工单）'
].join('\n')

/**
 * 判断怎么派。纯判断，不写库。
 * @returns {Promise<{decision:string, reason:string, tasks:Array}>}
 */
export async function plan(goal, { llm, signal } = {}) {
  const g = String(goal ?? '').trim()
  if (!g) return { decision: DECISION.REJECT, reason: '空的，没什么可做的', tasks: [] }
  if (!llm || typeof llm.chat !== 'function') throw new LlmError('plan 需要 llm.chat')

  let parsed = null
  try {
    const res = await llm.chat(
      [{ role: 'system', content: SYSTEM }, { role: 'user', content: g.slice(0, 800) }],
      { temperature: 0, signal }
    )
    parsed = parse(res.content)
  } catch (err) {
    if (err instanceof LlmError) throw err
    parsed = null
  }
  return normalizePlan(parsed, g)
}

/** 模型输出不合规时降级到 single —— 拆错的代价比不拆大 */
export function normalizePlan(raw, goal = '') {
  if (!raw || typeof raw !== 'object') {
    return { decision: DECISION.SINGLE, reason: '模型没给出可用的判断，先按单件做', tasks: [] }
  }
  const d = String(raw.decision ?? '').toLowerCase()
  if (!Object.values(DECISION).includes(d)) {
    return { decision: DECISION.SINGLE, reason: '模型给的 decision 不可用，先按单件做', tasks: [] }
  }
  if (d === DECISION.REJECT) {
    return { decision: DECISION.REJECT, reason: String(raw.reason ?? '不值得做').slice(0, 200), tasks: [] }
  }
  if (d === DECISION.SINGLE) {
    return { decision: DECISION.SINGLE, reason: String(raw.reason ?? '上下文能连着走').slice(0, 200), tasks: [] }
  }
  // team：校验任务
  const rawTasks = Array.isArray(raw.tasks) ? raw.tasks : []
  const tasks = []
  const seen = new Set()
  for (const t of rawTasks) {
    const key = String(t?.key ?? '').trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').slice(0, 32)
    const task = String(t?.task ?? '').trim()
    if (!key || !task || seen.has(key)) continue
    seen.add(key)
    tasks.push({ key, task })
    if (tasks.length >= MAX_MEMBERS) break
  }
  if (tasks.length < 2) {
    return { decision: DECISION.SINGLE, reason: '拆不出两块以上，改按单件做', tasks: [] }
  }
  return { decision: DECISION.TEAM, reason: String(raw.reason ?? '需要独立上下文的执行者').slice(0, 200), tasks }
}

/**
 * 把计划派出去：开 ticket、分配节点、（team 就）开成员。
 *
 * @returns {{ ok:boolean, decision:string, ticket?:object, node?:string|null, members?:object[], why?:string }}
 */
export function dispatch(db, goal, planned, { now = Date.now(), threadKey = null } = {}) {
  const p = planned ?? { decision: DECISION.SINGLE, reason: '', tasks: [] }
  if (p.decision === DECISION.REJECT) {
    return { ok: false, decision: p.decision, why: p.reason }
  }
  const ticket = createTicket(db, { goal, threadKey, now })
  if (p.decision === DECISION.TEAM) {
    openTeam(db, ticket.id, p.tasks, { now })
  }
  const a = assign(db, ticket.id, { now })
  return {
    ok: true,
    decision: p.decision,
    ticket: getTicket(db, ticket.id),
    node: a.ok ? a.node : null,
    why: a.ok ? null : a.why,
    members: p.decision === DECISION.TEAM ? p.tasks.map((t) => t.key) : []
  }
}

/** plan + dispatch 一步到位 */
export async function orchestrate(db, goal, { llm, now = Date.now(), threadKey = null, signal } = {}) {
  const p = await plan(goal, { llm, signal })
  return dispatch(db, goal, p, { now, threadKey })
}

/** 模型有时包代码块，抠出最外层对象 */
export function parse(text) {
  const s = String(text ?? '')
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const body = fence ? fence[1] : s
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try { return JSON.parse(body.slice(start, end + 1)) } catch { return null }
}
