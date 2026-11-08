/**
 * delegate.js —— 把「派活给 worker」变成一个可调用的工具
 *
 * 为什么是工具而不是自动触发：**自动开单会吵**。每条消息都判断「要不要
 * 开工单」，大半是白花 token；而模型自己知道什么时候需要独立执行者。
 *
 * 所以把判断权交回给女仆长：她调 delegate，才开单。
 *
 * 执行需要一个能调模型的客户端。插件拿不到宿主的模型配置，所以从
 * 环境变量取 DEEPSEEK_API_KEY——没有就明确说不，不假装能跑。
 */

import { plan, dispatch, DECISION } from '../team/orchestrator.js'
import { runTicket, runMember } from '../team/worker.js'
import { members } from '../team/team.js'
import { getTicket, transition } from '../team/ticket.js'

export const DEFAULT_SESSION_BUDGET = 8000
export const MAX_TEAM_RUNS = 3

/**
 * @param {{ db:object, makeLlm:()=>object|null, log?:Function }} deps
 */
export function createDelegate({ db, makeLlm, log = () => {} }) {
  return async function delegate({ goal } = {}) {
    const g = String(goal ?? '').trim()
    if (!g) return { ok: false, why: '没有说要做什么' }

    if (!db) return { ok: false, why: '账本没打开，delegate 不能执行' }
    const llm = makeLlm()
    if (!llm) {
      return {
        ok: false,
        why: '没有可用的模型客户端（缺 DEEPSEEK_API_KEY），delegate 不能执行。可以只记账不开单。'
      }
    }

    const p = await plan(g, { llm })
    if (p.decision === DECISION.REJECT) {
      return { ok: false, decision: 'reject', why: p.reason }
    }

    const d = dispatch(db, g, p, { now: Date.now() })
    if (!d.ok) return d

    let spent = 0
    const results = []

    if (p.decision === DECISION.SINGLE) {
      const r = await runTicket(db, d.ticket.id, { llm, budget: { maxTokens: 2500, maxCalls: 1 } })
      spent += r.result?.tokens ?? 0
      results.push({ key: 'single', ok: r.ok, text: r.result?.text ?? null, why: r.why ?? null, tokens: r.result?.tokens ?? 0 })
    } else {
      const list = members(db, d.ticket.id).slice(0, MAX_TEAM_RUNS)
      for (const m of list) {
        if (spent >= DEFAULT_SESSION_BUDGET) { results.push({ key: m.member_key, ok: false, why: '会话预算用尽' }); continue }
        const r = await runMember(db, m.id, { llm, budget: { maxTokens: 2000, maxCalls: 1 } })
        spent += r.result?.tokens ?? 0
        results.push({ key: m.member_key, ok: r.ok, text: r.result?.text ?? null, why: r.why ?? null, tokens: r.result?.tokens ?? 0 })
      }
    }

    // 收口：全部成功才 done，否则 failed（哨兵和人都能看到）
    //
    // ⚠ single 分支 runTicket 已经自己收口了（ticket 此时是 done/failed）；
    //   team 分支只推进成员，ticket 还停在 assigned —— 而状态机不允许
    //   assigned → done，必须先 running。这里补上那一跳。
    const allOk = results.length > 0 && results.every((r) => r.ok)
    try {
      let t = getTicket(db, d.ticket.id)
      if (t && t.status === 'assigned') {
        transition(db, d.ticket.id, 'running', { now: Date.now() })
        t = getTicket(db, d.ticket.id)
      }
      if (t && t.status === 'running') {
        transition(db, d.ticket.id, allOk ? 'done' : 'failed', {
          result: { plan: p.decision, reason: p.reason, spent, results }
        })
      }
    } catch (err) { log('收口失败：' + String(err?.message ?? err).slice(0, 120)) }

    return {
      ok: allOk,
      decision: p.decision,
      reason: p.reason,
      ticket: d.ticket.id,
      node: d.node,
      spent,
      results
    }
  }
}
