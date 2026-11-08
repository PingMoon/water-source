/**
 * veto.js —— 归并第三步：否决（复用写入门）
 *
 * 为什么不单独写一套判据：**写入门和否决是同一次判断**——
 * 「worker 交上来的结论该不该变成我的记忆」。分成两套，迟早出现
 * 「写入门放行、否决拒绝」这种自相矛盾。
 *
 * 这里只加批处理外壳，判据本体在 src/ledger/write-gate.js。
 */

import { decide, ACTION, VETO } from '../ledger/write-gate.js'

export { ACTION, VETO }

/**
 * 批量过否决。
 * @param {Array<{content:string, refs:string[], meta?:object}>} drafts
 * @param {{ knownIds?:Set<string>, beliefs?:object[], ticket?:object }} ctx
 * @returns {{ accepted:object[], rejected:object[] }}
 */
export function checkVeto(drafts = [], ctx = {}) {
  const accepted = []
  const rejected = []
  for (const d of drafts) {
    const r = decide(d, ctx)
    if (r.action === ACTION.REJECT) rejected.push({ draft: d, reasonCode: r.reasonCode, detail: r.detail })
    else accepted.push({ draft: d, action: r.action })
  }
  return { accepted, rejected }
}
