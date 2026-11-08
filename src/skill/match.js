/**
 * match.js —— 挑 skill
 *
 * 判据刻意保守：**宁可没想起来，也不要用错手册**。
 * 用错手册比没有手册更糟——她会按错的步骤做，还觉得自己会了。
 */

import { similarity } from '../ledger/write-gate.js'

export const MATCH_MIN = 0.12
/** 至少共享这么多个「二字片段」——低于这个数，相似度再高也是巧合 */
export const MIN_SHARED = 2

/**
 * @param {string} task 当前任务描述
 * @param {Array<{id:string, description:string}>} skills
 * @param {{ min?:number, limit?:number }} opts
 */
export function matchSkill(task, skills = [], opts = {}) {
  // 判据是**共享片段数**，不是相似度。
  // 中文里「同一件事换种说法」的两句话，Dice 可能只有 0.09，
  // 但共享片段数是 2~3——那才是真正的信号。相似度只用来排序。
  const minShared = Number.isInteger(opts.shared) ? opts.shared : MIN_SHARED
  const limit = Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : 3
  const t = String(task ?? '').trim()
  if (!t) return []

  const scored = skills
    .filter((s) => s && s.status !== 'deprecated')
    .map((s) => {
      const desc = String(s.description ?? '')
      const content = String(s.body ?? '')
      // description 权重高（它就是「什么时候用」），正文给一点加成
      const descSim = similarity(t, desc)
      const bodySim = content ? similarity(t, content.slice(0, 300)) : 0
      const score = descSim * 0.8 + bodySim * 0.2
      const shared = sharedBigrams(t, desc + ' ' + content.slice(0, 300))
      return { skill: s, score: Number(score.toFixed(4)), descSim: Number(descSim.toFixed(4)), shared }
    })
    .filter((x) => x.shared >= minShared)
    .sort((a, b) => b.score - a.score || String(a.skill.id).localeCompare(String(b.skill.id)))
    .slice(0, limit)

  return scored
}

/**
 * 共享的二字片段个数。
 *
 * 为什么要它：中文的字符串相似度对「同一件事换种说法」很不敏感——
 * 「帮我调研这个库能不能接」和「判断一个开源库能不能用」Dice 只有 0.11。
 * 但共享片段数是 3，足以说明它们在说同一类事。
 */
export function sharedBigrams(a, b) {
  const grams = (s) => {
    const t = String(s ?? '').replace(/[\s\p{P}\p{S}]/gu, '')
    const set = new Set()
    for (let i = 0; i < t.length - 1; i++) set.add(t.slice(i, i + 2))
    return set
  }
  const ga = grams(a)
  const gb = grams(b)
  let n = 0
  for (const g of ga) if (gb.has(g)) n++
  return n
}
