/**
 * write-gate.js —— 写入门的**确定性**判断（不调模型）
 *
 * 职责只有一个：worker 交上来的结论（meaning），女仆长该不该采纳。
 * 这是架构 D9「否决权只能依三条判据」的落地——判据写在这里，不写在提示词里。
 *
 * 三条判据：
 *   1. insufficient_evidence —— 没有原文引用，或引用指向不存在的事件
 *   2. conflict_unresolved   —— 与已有信念说的是同一件事且极性相反，没有回应
 *   3. out_of_scope          —— 超出了它被分配的 ticket 范围
 *
 * 来源：dsh-persona 0.18.1 write-gate 的「纯函数 + 动作枚举」形状（MIT），
 * 判据按本项目重写；相似度与极性判定参考 dsh-fish derive 的 detectTensions 思路。
 */

export const ACTION = { ACCEPT: 'accept', HEDGE: 'hedge', REJECT: 'reject' }

export const VETO = {
  INSUFFICIENT_EVIDENCE: 'insufficient_evidence',
  CONFLICT_UNRESOLVED: 'conflict_unresolved',
  OUT_OF_SCOPE: 'out_of_scope'
}

/** 否定词族。先挖掉词素（别人/别的/特别），再判极性。 */
const NON_NEG_WORDS = /(别人|别的|别处|别家|告别|区别|分别|特别|个别|级别|辨别|鉴别)/g
const NEG_CHARS = /[不没无别]|讨厌|拒绝|反感|不愿意?|不需要?|不敢/

export function stripNegation(text = '') {
  return String(text)
    .replace(NON_NEG_WORDS, '')
    .replace(NEG_CHARS, '')
    .replace(/[\s，。！？、,.!?；;：:「」“”"'（）()]/g, '')
}

export function polarity(text = '') {
  return NEG_CHARS.test(String(text).replace(NON_NEG_WORDS, '')) ? -1 : 1
}

function bigrams(s) {
  const m = new Map()
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2)
    m.set(g, (m.get(g) || 0) + 1)
  }
  return m
}

/** Dice 相似度 0~1 */
export function similarity(a, b) {
  const ca = stripNegation(a), cb = stripNegation(b)
  if (ca.length < 4 || cb.length < 4) return 0
  const ga = bigrams(ca), gb = bigrams(cb)
  let inter = 0
  for (const [g, n] of ga) {
    const m = gb.get(g)
    if (m) inter += Math.min(n, m)
  }
  const total = [...ga.values()].reduce((x, y) => x + y, 0) + [...gb.values()].reduce((x, y) => x + y, 0)
  return total ? (2 * inter) / total : 0
}

/**
 * 判断一条候选 meaning 能不能采纳。
 *
 * @param {{ content:string, refs?:string[], meta?:object }} candidate
 * @param {{ knownIds?:Set<string>, beliefs?:{id:string,text:string}[], ticket?:{id:string} }} ctx
 * @returns {{action:string, reasonCode:string|null, detail:object}}
 */
export function decide(candidate, ctx = {}) {
  const content = String(candidate?.content ?? '')
  const refs = Array.isArray(candidate?.refs) ? candidate.refs : []

  // 1. 证据
  if (!refs.length) {
    return { action: ACTION.REJECT, reasonCode: VETO.INSUFFICIENT_EVIDENCE, detail: { why: 'refs 为空' } }
  }
  if (ctx.knownIds) {
    const missing = refs.filter((r) => !ctx.knownIds.has(r))
    if (missing.length) {
      return { action: ACTION.REJECT, reasonCode: VETO.INSUFFICIENT_EVIDENCE, detail: { missing } }
    }
  }

  // 3. 范围（2 放在后面，因为冲突要先算）
  const ticketId = candidate?.meta?.ticketId
  if (ctx.ticket?.id && ticketId && ticketId !== ctx.ticket.id) {
    return {
      action: ACTION.REJECT,
      reasonCode: VETO.OUT_OF_SCOPE,
      detail: { ticketId, expected: ctx.ticket.id }
    }
  }

  // 2. 冲突：说的是同一件事、极性相反、且候选没带「回应」标记
  const beliefs = Array.isArray(ctx.beliefs) ? ctx.beliefs : []
  const resolved = candidate?.meta?.resolvesRef === true
  if (!resolved) {
    for (const b of beliefs) {
      const sim = similarity(content, b.text)
      if (sim < 0.5) continue
      if (polarity(content) === polarity(b.text)) continue
      return {
        action: ACTION.REJECT,
        reasonCode: VETO.CONFLICT_UNRESOLVED,
        detail: { against: b.id, sim: Number(sim.toFixed(2)) }
      }
    }
  }

  return { action: ACTION.ACCEPT, reasonCode: null, detail: { refs: refs.length } }
}
