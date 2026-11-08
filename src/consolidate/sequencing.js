/**
 * sequencing.js —— 归并第一步：定序（纯函数）
 *
 * 职责：决定「哪些 worker 材料进这次归并、按什么顺序」。**不调模型、不写盘。**
 *
 * 排序依据（可解释，不用权重玄学）：
 *   1. 还没被任何 meaning 引用过的优先——重复消化是浪费；
 *   2. 同条件下新的在前；
 *   3. 同一条永远排在同一个位置（稳定排序）。
 */

/**
 * @param {Array<object>} materials worker_material 事件
 * @param {{ referenced?: Set<string>, limit?: number }} opts
 * @returns {Array<{event:object, used:boolean, why:string}>}
 */
export function orderMaterials(materials = [], opts = {}) {
  const referenced = opts.referenced instanceof Set ? opts.referenced : new Set()
  const limit = Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : 20
  const scored = materials.map((e, idx) => {
    const used = referenced.has(e.id)
    const ts = Date.parse(e.ts) || 0
    return { event: e, used, ts, idx, why: used ? '已被引用过' : '新材料' }
  })
  scored.sort((a, b) => {
    if (a.used !== b.used) return a.used ? 1 : -1
    if (b.ts !== a.ts) return b.ts - a.ts
    return a.idx - b.idx
  })
  return scored.slice(0, limit).map(({ event, used, why }) => ({ event, used, why }))
}
