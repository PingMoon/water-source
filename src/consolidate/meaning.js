/**
 * meaning.js —— 归并第二步：意义化（LLM）
 *
 * 输入：有序材料清单。输出：若干条「这件事对我意味着什么」的草稿。
 *
 * 三条硬规则：
 *   1. **模型只产候选**，落不落库由 veto（写入门）决定；
 *   2. 每条必须带 refs，且 refs 必须是**本批材料里真实存在的 id**；
 *   3. **复读检测**：意义句和材料像到 0.85 以上，判为「没消化」，丢弃。
 */

import { LlmError } from '../llm/client.js'
import { similarity } from '../ledger/write-gate.js'

/** 意义化阈值：和材料像到这个程度，等于没消化 */
export const DUPLICATE_SIM = 0.85

const SYSTEM = [
  '你在读一批材料，要把它们变成「我」的经历。',
  '只输出 JSON 数组，不要解释，不要代码块。每个元素形如：',
  '{"meaning": "一句以「我」开头的话", "refs": ["材料id1"]}',
  '',
  '硬规则：',
  '1. 每句话必须是「我」的视角 —— 以「我」开头，或明确是「我」的感受 / 判断 / 打算；',
  '2. 不许复述材料原文。材料说的是「发生了什么」，你要写的是「这件事让我怎么样」；',
  '3. 一条只讲一件事；',
  '4. refs 必须是材料清单里真实出现过的 id，不许编；',
  '5. 如果材料对你没有任何影响，返回 []；',
  '6. 不要写「今天 / 昨天」，时间交给系统；不要总结腔。',
  '',
  '反例（会被系统判为「没消化」，直接丢弃）：',
  '  材料：JEV 在 ALFWorld 上只有 35%',
  '  坏：JEV 在 ALFWorld 上只有 35%',
  '  坏：JEV 在序列决策上表现很差',
  '',
  '正例：',
  '  好：我不敢拿它去做要连着做决定的事',
  '  好：我原本以为它什么都能干，现在知道自己想多了'
].join('\n')

/**
 * @param {Array<{event:object}>} ordered
 * @param {{ llm:{chat:Function}, signal?:AbortSignal }} opts
 * @returns {Promise<{drafts:object[], dropped:object[]}>}
 */
export async function makeMeaning(ordered = [], opts = {}) {
  const llm = opts.llm
  if (!llm || typeof llm.chat !== 'function') throw new LlmError('makeMeaning 需要 llm.chat')
  if (!ordered.length) return { drafts: [], dropped: [] }

  const known = new Set(ordered.map((o) => o.event.id))
  const body = ordered
    .map((o, i) => `${i + 1}. [${o.event.id}] ${String(o.event.content).replace(/\s+/g, ' ').slice(0, 500)}`)
    .join('\n')

  const res = await llm.chat(
    [{ role: 'system', content: SYSTEM }, { role: 'user', content: body }],
    { temperature: 0, signal: opts.signal }
  )
  const parsed = parseDrafts(res.content, known)
  return screenDuplicates(parsed, ordered)
}

/** 复读检测：meaning 与它引用的材料过于相似 = 没消化 */
export function screenDuplicates({ drafts, dropped }, ordered = []) {
  const byId = new Map(ordered.map((o) => [o.event.id, String(o.event.content)]))
  const kept = []
  const drop2 = [...dropped]
  for (const d of drafts) {
    let worst = 0
    for (const r of d.refs) {
      const src = byId.get(r)
      if (!src) continue
      worst = Math.max(worst, similarity(d.content, src))
    }
    if (worst >= DUPLICATE_SIM) {
      drop2.push({ why: 'duplicated_source', sim: Number(worst.toFixed(3)), draft: d.content.slice(0, 80) })
    } else {
      kept.push(d)
    }
  }
  return { drafts: kept, dropped: drop2 }
}

/** 解析 + 逐条校验；不合规的进 dropped，不静默修 */
export function parseDrafts(raw, known) {
  const text = String(raw ?? '').trim()
  const json = extractJson(text)
  if (!json) return { drafts: [], dropped: [{ why: 'not_json', raw: text.slice(0, 200) }] }
  let arr
  try { arr = JSON.parse(json) } catch {
    return { drafts: [], dropped: [{ why: 'json_parse_failed', raw: text.slice(0, 200) }] }
  }
  if (!Array.isArray(arr)) return { drafts: [], dropped: [{ why: 'not_array' }] }

  const drafts = []
  const dropped = []
  for (const item of arr) {
    const meaning = String(item?.meaning ?? '').trim()
    const refs = Array.isArray(item?.refs) ? item.refs.map(String) : []
    if (!meaning) { dropped.push({ why: 'empty_meaning', item }); continue }
    if (!refs.length) { dropped.push({ why: 'no_refs', item }); continue }
    const bad = refs.filter((r) => !known.has(r))
    if (bad.length) { dropped.push({ why: 'unknown_refs', bad, item }); continue }
    drafts.push({ content: meaning, refs, meta: {} })
  }
  return { drafts, dropped }
}

/** 模型有时会包一层代码块或前后加话，先抠出最外层的数组 */
function extractJson(text) {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const body = fence ? fence[1] : text
  const start = body.indexOf('[')
  const end = body.lastIndexOf(']')
  if (start < 0 || end <= start) return null
  return body.slice(start, end + 1)
}
