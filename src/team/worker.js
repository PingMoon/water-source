/**
 * worker.js —— 让一个 ticket 真的跑起来（最小执行器）
 *
 * M3.5 的定位：**worker 不是 agent，是一次受控的模型调用**。
 * 它没有工具、看不到别的 ticket、只拿到自己的 goal。
 * 这是最小实现——真实 worker 要接 DSH 的 subagent，那时候才有工具面。
 *
 * 两条硬约束：
 *   1. **预算优先**：单 ticket 有 token 上限，超了记账并标注，不静默继续；
 *   2. **失败不吞**：执行失败把 ticket 推成 failed，原因写进 result_json，
 *      哨兵能看到、人能 reopen。
 */

import { getTicket, transition } from './ticket.js'
import { getMember, startMember, finishMember } from './team.js'
import { LlmError } from '../llm/client.js'

export const DEFAULT_BUDGET = {
  /** 单次 ticket 的 token 上限（输入+输出） */
  maxTokens: 4000,
  /** 单次 ticket 最多几次模型调用（M3.5 固定 1） */
  maxCalls: 1
}

const SYSTEM = [
  '你在完成一件独立的小事。',
  '只输出结果本身，不要解释你在做什么，不要客套。',
  '如果这件事你做不到（缺信息、缺工具），直接说做不到，并说明缺什么——不要编。'
].join('\n')

/**
 * 跑一个已分配的 ticket。
 * @param {{ llm:{chat:Function}, budget?:object, now?:number, signal?:AbortSignal }} opts
 */
export async function runTicket(db, ticketId, { llm, budget = {}, now = Date.now(), signal } = {}) {
  const t = getTicket(db, ticketId)
  if (!t) return { ok: false, why: '没有这个 ticket' }
  if (t.status !== 'assigned') return { ok: false, why: '只有 assigned 能跑，当前 ' + t.status }
  if (!llm || typeof llm.chat !== 'function') throw new LlmError('runTicket 需要 llm.chat')

  const B = { ...DEFAULT_BUDGET, ...sanitizeBudget(budget) }
  transition(db, ticketId, 'running', { now })

  const started = Date.now()
  try {
    if (B.maxCalls < 1) throw new Error('预算不允许任何调用')
    const res = await llm.chat(
      [{ role: 'system', content: SYSTEM }, { role: 'user', content: String(t.goal).slice(0, 2000) }],
      { temperature: 0.3, signal }
    )
    const usage = res.usage ?? null
    const tokens = totalTokens(usage)
    const overBudget = tokens > B.maxTokens
    const result = {
      text: String(res.content ?? '').trim(),
      model: res.model ?? null,
      usage,
      tokens,
      budget: B,
      overBudget,
      ms: Date.now() - started
    }
    transition(db, ticketId, 'done', { result, now: now + (Date.now() - started) })
    return { ok: true, ticketId, result }
  } catch (err) {
    const result = {
      error: String(err?.message ?? err).slice(0, 300),
      budget: B,
      ms: Date.now() - started
    }
    try { transition(db, ticketId, 'failed', { result, now: now + (Date.now() - started) }) } catch { /* 状态可能已经变了 */ }
    return { ok: false, ticketId, why: result.error }
  }
}

function sanitizeBudget(b = {}) {
  const out = {}
  if (Number.isFinite(b.maxTokens) && b.maxTokens > 0) out.maxTokens = Math.floor(b.maxTokens)
  if (Number.isFinite(b.maxCalls) && b.maxCalls > 0) out.maxCalls = Math.floor(b.maxCalls)
  return out
}

/** 不同 provider 的 usage 字段名不一样，统一取总数 */
export function totalTokens(usage) {
  if (!usage || typeof usage !== 'object') return 0
  const n = (x) => (Number.isFinite(x) ? Number(x) : 0)
  if (Number.isFinite(usage.total_tokens)) return n(usage.total_tokens)
  return n(usage.prompt_tokens) + n(usage.completion_tokens) +
    n(usage.input_tokens) + n(usage.output_tokens)
}

/**
 * 池子跑一轮：把所有 assigned 的 ticket 按顺序跑掉。
 * 只跑到预算/数量上限为止——**不许一口气把池子抽干**。
 */
export async function drain(db, { llm, budget = {}, limit = 3, now = Date.now(), signal } = {}) {
  const rows = db.prepare("SELECT id FROM ticket WHERE status = 'assigned' ORDER BY created_at LIMIT ?").all(limit)
  const out = []
  let spent = 0
  const cap = Number.isFinite(budget.sessionMaxTokens) ? budget.sessionMaxTokens : Infinity
  for (const r of rows) {
    if (spent >= cap) { out.push({ ticketId: r.id, ok: false, why: '会话预算用尽' }); continue }
    const res = await runTicket(db, r.id, { llm, budget, now, signal })
    out.push({ ticketId: r.id, ok: res.ok, tokens: res.result?.tokens ?? 0 })
    spent += res.result?.tokens ?? 0
  }
  return { ran: out.length, spent, results: out }
}

/**
 * 跑一个 team 成员：用它的 task 当一次独立的目标。
 *
 * 成员没有自己的 ticket——它在父 ticket 里。所以这里不碰 ticket 状态，
 * 只推进成员状态。父 ticket 由编排层收口。
 */
export async function runMember(db, memberId, { llm, budget = {}, now = Date.now(), signal } = {}) {
  const m = getMember(db, memberId)
  if (!m) return { ok: false, why: '没有这个成员' }
  if (m.status !== 'pending') return { ok: false, why: '只有 pending 能跑，当前 ' + m.status }
  if (!llm || typeof llm.chat !== 'function') throw new LlmError('runMember 需要 llm.chat')

  const B = { ...DEFAULT_BUDGET, ...sanitizeBudget(budget) }
  startMember(db, memberId, { now })
  const started = Date.now()
  try {
    const res = await llm.chat(
      [{ role: 'system', content: SYSTEM }, { role: 'user', content: String(m.task).slice(0, 2000) }],
      { temperature: 0.3, signal }
    )
    const usage = res.usage ?? null
    const tokens = totalTokens(usage)
    finishMember(db, memberId, { status: 'done', now: now + (Date.now() - started) })
    return {
      ok: true, memberId, key: m.member_key,
      result: { text: String(res.content ?? '').trim(), tokens, usage, overBudget: tokens > B.maxTokens, ms: Date.now() - started }
    }
  } catch (err) {
    const cls = err instanceof LlmError ? 'llm' : 'unknown'
    try { finishMember(db, memberId, { status: 'failed', errorClass: cls, now: now + (Date.now() - started) }) } catch { /* ignore */ }
    return { ok: false, memberId, key: m.member_key, why: String(err?.message ?? err).slice(0, 200) }
  }
}
