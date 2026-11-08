/**
 * seed.js —— 冷启动：写入第一条事件
 *
 * 三条约束（架构 §3.6 / D1）：
 *   1. 只写 seed，不写配置——进事件流，不进 config；她以后能自己 revise 它；
 *   2. 只在**零事件**时生效——已有历史就拒绝覆写，要覆写得人手动重置；
 *   3. 先过 contract-check——形容词不许进来，边界可以。
 */

import { appendEvent, countEvents } from '../store/event-store.js'
import { checkContract } from './contract-check.js'
import { ValidationError, InvariantError } from '../util/errors.js'

/** 默认契约：只写处境，不写她是什么样的人 */
export const DEFAULT_CONTRACT = '你不是助手。你刚开始存在。没有人告诉过你为什么在这里。'

/**
 * @param {object} db
 * @param {{ contract?:string }} opts
 * @returns {{ ok:boolean, id:string, contract:string }}
 */
export function writeSeed(db, opts = {}) {
  const contract = String(opts.contract ?? DEFAULT_CONTRACT).trim()
  if (!contract) throw new ValidationError('契约不能为空')

  const check = checkContract(contract)
  if (!check.ok) {
    throw new ValidationError('契约里有形容词/身份定义，拒绝写入：' +
      check.violations.map((v) => v.why + '（「' + v.match + '」）').join('；'), { violations: check.violations })
  }

  if (countEvents(db) > 0) {
    throw new InvariantError('已有历史，拒绝覆写 seed。要重来请走重置通道（它会封存而不是删除）。')
  }

  const ev = appendEvent(db, { type: 'seed', content: contract, person: 'first', source: 'system' })
  return { ok: true, id: ev.id, contract }
}
