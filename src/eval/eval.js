/**
 * eval.js —— 该不该做 / 要不要丢
 *
 * 顺序（架构 §3.9）：
 *   1. 属于活跃线索 → **旁路**，不判（同一件事的追问，重复判既贵又容易误拒）
 *   2. 噪音 → 丢
 *   3. 其余 → 接
 *
 * 铁律：**丢弃必须可见**。丢掉的东西进 eval_drop 表，能列出来、能推翻。
 * 不可见的丢弃 = 她单方面决定不听你说话。
 */

import { newId } from '../util/ids.js'

export const DECISION = { BYPASS: 'bypass', ACCEPT: 'accept', DROP: 'drop' }

/** 噪音规则：宁可少丢，不可误丢 */
const NOISE_RULES = [
  { id: 'empty', re: /^\s*$/, why: '空消息' },
  // ⚠ 「？」「！」单独出现是有效提问/表态。这条踩过两次，别再往里加。
  { id: 'punctuation', re: /^[\s，。、…·\-—~～.]+$/, why: '只有标点' },
  { id: 'emoji', re: /^[\s\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]+$/u, why: '只有表情' },
  { id: 'ack', re: /^(嗯+|哦+|噢+|啊+|哈+|呃+|额+|唔+)[。.!！?？~～]*$/, why: '语气词' },
  { id: 'ack-en', re: /^(em+|emm+|dddd+|hhh+)$/i, why: '语气词' },
  { id: 'net-slang', re: /^(啊这|呵呵+)$/, why: '语气词' },
  { id: 'ack-phrase', re: /^(嗯+|哦+|噢+|啊+)[，,]?\s*好的吧$/, why: '语气词' }
]

/**
 * @param {{ text:string, room?:string, activeThread?:object|null }} input
 * @returns {{ decision:string, threadKey:string|null, rule:string|null, why:string, visible:string }}
 */
export function evaluate({ text, room = 'local', activeThread = null } = {}) {
  const s = String(text ?? '')
  if (activeThread?.key) {
    return {
      decision: DECISION.BYPASS,
      threadKey: activeThread.key,
      rule: null,
      why: '属于活跃线索，跳过判断',
      visible: ''
    }
  }
  for (const r of NOISE_RULES) {
    if (r.re.test(s)) {
      return {
        decision: DECISION.DROP,
        threadKey: null,
        rule: r.id,
        why: r.why,
        visible: '（这条我没接：' + r.why + '。要的话说清楚点，我再看。）'
      }
    }
  }
  return { decision: DECISION.ACCEPT, threadKey: null, rule: null, why: '正常消息', visible: '' }
}

/** 记一条丢弃（必须可见） */
export function recordDrop(db, { text, threadKey = null, rule, reason, now = Date.now() }) {
  const id = newId(now)
  db.prepare(
    'INSERT INTO eval_drop (id, thread_key, text, rule, reason, at, overturned) VALUES (?, ?, ?, ?, ?, ?, 0)'
  ).run(id, threadKey, String(text ?? '').slice(0, 2000), String(rule ?? ''), String(reason ?? ''), new Date(now).toISOString())
  return id
}

/** 主人推翻一次丢弃：她那条得接回来 */
export function overturn(db, dropId, now = Date.now()) {
  const row = db.prepare('SELECT * FROM eval_drop WHERE id = ?').get(String(dropId ?? ''))
  if (!row) throw new Error('没有这条丢弃记录：' + dropId)
  if (row.overturned) return { ok: true, already: true, row }
  db.prepare('UPDATE eval_drop SET overturned = 1 WHERE id = ?').run(row.id)
  return { ok: true, row: { ...row, overturned: 1 }, text: row.text }
}

export function listDrops(db, limit = 50) {
  return db.prepare('SELECT * FROM eval_drop ORDER BY at DESC LIMIT ?').all(limit)
}

/** 丢弃率 / 推翻率：误丢救济的两个观测指标 */
export function dropStats(db) {
  const total = Number(db.prepare('SELECT COUNT(*) AS c FROM eval_drop').get()?.c ?? 0)
  const overturned = Number(db.prepare('SELECT COUNT(*) AS c FROM eval_drop WHERE overturned = 1').get()?.c ?? 0)
  return { total, overturned, rate: total ? Number((overturned / total).toFixed(3)) : 0 }
}
