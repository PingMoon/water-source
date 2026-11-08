/**
 * projection.js —— 出本机的派生视图
 *
 * 为什么要它：self-log 不出本机（架构 Q8/D24）。但云端的 worker 要知道
 * 「她是谁、在意什么」才能判断一个东西对她有没有用。
 *
 * 硬约束：
 *   - 不含事件 id（不可反推原文）；
 *   - 不含原文整句（改写或截断）；
 *   - 可被纯函数重建，不落盘。
 *
 * M0 只做「结构 + 截断」，真正的改写要 LLM，放在切片 4。
 * 所以 M0 的 projection 是**弱化版**：能用，但保真度不足——这点写在返回的
 * `rewritten: false` 里，调用方必须知道。
 */

const MAX_SUMMARY = 60

export function buildProjection(model, opts = {}) {
  const limit = Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : 3
  const beliefs = (model?.topBeliefs ?? []).slice(0, limit).map((b) => summarize(b.text))
  return {
    stage: model?.stage ?? 1,
    stageName: model?.stageName ?? '',
    day: model?.day ?? 1,
    beliefs,
    name: model?.name ?? '',
    generatedAt: new Date().toISOString(),
    rewritten: false
  }
}

/** 一句话压成短摘要：去掉引用痕迹、去掉换行、超长截断 */
export function summarize(text, max = MAX_SUMMARY) {
  let s = String(text ?? '')
    // 先整段去掉「（见 refs: ev_1, ev_2）」这类引用痕迹
    .replace(/[（(][^）)]*?(?:refs?|来源|参考|见)[^）)]*[)）]/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (s.length > max) s = s.slice(0, max - 1) + '…'
  return s
}


// ---------------------------------------------------------------------------
// 改写版投影（D24 的完整落地）
// ---------------------------------------------------------------------------

import { similarity } from '../ledger/write-gate.js'

/** 改写结果与原句的相似度上限：超过就是「原文截一段」，不可出本机 */
export const REWRITE_MAX_SIM = 0.5

const REWRITE_SYSTEM = [
  '你在把一段第一人称的自我判断，改写成第三方视角的简短描述。',
  '这些描述会发给外部工作节点，所以**不能让人从中反推出原话**。',
  '',
  '要求：',
  '- 每条不超过 20 字；',
  '- 不出现原句里的具体人名、数字、专有名词、项目名；',
  '- 写成「对…持…态度」或「她…」这样的中性描述；',
  '- 保留立场，丢掉细节；',
  '- 几条之间不要重复。',
  '',
  '只输出 JSON：{"items": ["…", "…"]}'
].join('\n')

/**
 * 把派生模型的判断改写成可出本机的投影。
 *
 * 失败不是错误，是**降级**：改写不成就退回 summarize 版本并标 rewritten:false。
 * 宁可发一个粗糙的摘要，也不发一个可能反推原文的「改写」。
 *
 * @param {object} model derive() 的输出
 * @param {{ llm:{chat:Function}, signal?:AbortSignal, limit?:number }} opts
 */
export async function rewriteProjection(model, opts = {}) {
  const limit = Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : 3
  const base = {
    stage: model?.stage ?? 1,
    stageName: model?.stageName ?? '',
    day: model?.day ?? 1,
    name: model?.name ?? ''
  }
  const source = (model?.topBeliefs ?? []).slice(0, limit)
  if (!source.length) {
    return { ...base, beliefs: [], rewritten: true, generatedAt: new Date().toISOString() }
  }
  if (!opts.llm || typeof opts.llm.chat !== 'function') {
    return { ...buildProjection(model, { limit }), degraded: 'no_llm' }
  }

  try {
    const body = source.map((b, i) => (i + 1) + '. ' + String(b.text).slice(0, 200)).join('\n')
    const res = await opts.llm.chat(
      [{ role: 'system', content: REWRITE_SYSTEM }, { role: 'user', content: body }],
      { temperature: 0, signal: opts.signal }
    )
    const items = parseItems(res.content)
    if (!items.length) return { ...buildProjection(model, { limit }), degraded: 'empty_rewrite' }

    // 逐条检查：像到 REWRITE_MAX_SIM 以上就是没改干净
    const safe = []
    for (const it of items) {
      let worst = 0
      for (const s of source) worst = Math.max(worst, similarity(it, s.text))
      if (worst >= REWRITE_MAX_SIM) return { ...buildProjection(model, { limit }), degraded: 'too_similar', worstSim: Number(worst.toFixed(3)) }
      safe.push(it)
    }

    return {
      ...base,
      beliefs: safe.slice(0, limit),
      rewritten: true,
      generatedAt: new Date().toISOString()
    }
  } catch (err) {
    return { ...buildProjection(model, { limit }), degraded: 'llm_error', why: String(err?.message ?? err).slice(0, 120) }
  }
}

function parseItems(raw) {
  const text = String(raw ?? '')
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const body = fence ? fence[1] : text
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start < 0 || end <= start) return []
  try {
    const obj = JSON.parse(body.slice(start, end + 1))
    return Array.isArray(obj?.items) ? obj.items.map((x) => String(x).trim()).filter(Boolean) : []
  } catch { return [] }
}
