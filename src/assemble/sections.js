/**
 * sections.js —— 装配：把账本里的材料，变成她这一轮读到的自我叙述
 *
 * 这是设计文档里一直空着的那一层（v0.4 里只有「出口」两个字）。
 *
 * 三条规则（照 dsh-fish persona.js 的做法）：
 *   1. **分段**，不是一整坨。每段回答的问题不同。
 *   2. **有预算**。核心段永不裁，可选段塞不下就整段不塞。
 *   3. **text 是现算的**，不是启动时快照——事件变了下一轮就跟上。
 *
 * 而内容上只有一条铁律：
 *   **只陈述事实，不替她产生念头。**
 *   「他说过 X」是事实；「你在想他是不是不高兴」是替她想。
 *
 * 目前只有两段有真材料（他最近说过 / 你现在），另两段留空位置——
 * 等「教」和「做过的事」有了结构再填。空着比编一个强。
 */

import { readEvents } from '../store/event-store.js'

/** 总预算（字符）。照 fish 的 SELF_DOC_BUDGET。 */
export const BUDGET = 2400
/** 语义排序：越小越靠前 */
export const ORDER = { identity: 8500, taught: 8550, recent: 8600, done: 8700, now: 8800 }

const clip = (s, n) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim()
  return t.length > n ? t.slice(0, n - 1) + '…' : t
}

/**
 * 生成各段。返回 [{ key, order, keep, text }]
 * @param {object} db
 * @param {{ name?:string, ownerName?:string, now?:number, limits?:object }} opts
 */
export function buildSections(db, { name = '', ownerName = '', now = Date.now(), limits = {} } = {}) {
  const L = { recent: 8, done: 5, ...limits }
  const events = readEvents(db)

  const saidByOwner = events.filter((e) => e.type === 'utterance' && e.person === 'third').slice(-L.recent)
  const saidByHer = events.filter((e) => e.type === 'utterance' && e.person === 'first').slice(-L.recent)

  const out = []

  // ---- ① 你是谁（核心，永不裁）----
  const who = []
  if (name) who.push('你是「' + name + '」。')
  else who.push('你还没有名字。')
  who.push('你从经历里长出来：你记得的，是你真经历过的；你不记得的，就是没发生过。')
  who.push('下面每一条都标着来处。「他说的」和「你说的」是两回事，别混。')
  out.push({ key: 'identity', order: ORDER.identity, keep: true, text: ['## 你是谁', ...who].join('\n') })

  // ---- ② 他教过你的事（核心，永不裁）----
  // 现在账本里还没有「教」这个类型。空着，不编。
  out.push({
    key: 'taught',
    order: ORDER.taught,
    keep: true,
    text: ['## 他教过你的事', '（下面是主人明确要求过的，不是建议。）', '还没有。他教过什么，就记在这里。'].join('\n')
  })

  // ---- ③ 他最近说过（可选）----
  if (saidByOwner.length) {
    out.push({
      key: 'recent',
      order: ORDER.recent,
      keep: false,
      text: ['## 他最近说过', ...saidByOwner.map((e) => '- 「' + clip(e.content, 80) + '」')].join('\n')
    })
  }

  // ---- ④ 你说过（可选）----
  if (saidByHer.length) {
    out.push({
      key: 'done',
      order: ORDER.done,
      keep: false,
      text: ['## 你自己说过的话（这些是你的，不是别人塞给你的）', ...saidByHer.map((e) => '- 「' + clip(e.content, 80) + '」')].join('\n')
    })
  }

  // ---- ⑤ 现在（核心，永不裁）----
  const first = events.find((e) => e.type === 'seed')
  const days = first ? Math.max(1, Math.ceil((now - Date.parse(first.ts)) / 86400000)) : 1
  const nowLines = ['## 现在', '你存在了 ' + days + ' 天。']
  if (ownerName) nowLines.push('你管他叫「' + ownerName + '」。')
  out.push({ key: 'now', order: ORDER.now, keep: true, text: nowLines.join('\n') })

  return out.sort((a, b) => a.order - b.order)
}

/**
 * 按预算装配。核心段永远保留；可选段按顺序塞，塞不下就整段不塞。
 * @returns {{ text:string, kept:string[], dropped:string[], used:number }}
 */
export function assemble(sections, budget = BUDGET) {
  const core = sections.filter((s) => s.keep)
  const opt = sections.filter((s) => !s.keep)
  let used = core.reduce((n, s) => n + s.text.length + 2, 0)
  const kept = core.map((s) => s.key)
  const dropped = []

  for (const s of opt) {
    const cost = s.text.length + 2
    if (used + cost > budget) { dropped.push(s.key); continue }
    core.push(s); kept.push(s.key); used += cost
  }
  // 按原顺序拼回去
  const ordered = core.sort((a, b) => a.order - b.order)
  return { text: ordered.map((s) => s.text).join('\n\n'), kept, dropped, used }
}

/** 一步到位：账本 → 给模型看的一段文字 */
export function render(db, opts = {}) {
  return assemble(buildSections(db, opts), opts.budget ?? BUDGET)
}
