/**
 * derive.js —— 纯函数：事件流 -> 此刻的她
 *
 * 铁律（架构 A1/A3）：
 *   - 不写盘、不缓存、不读环境变量、不调模型；
 *   - 相同输入必得相同输出（now 除外）——这条由测试守。
 *
 * M0 只算「能验证的最小集」：天数、阶段、最显著判断、称呼、计数。
 * 疤 / 立场 / 情绪留到 M1——M0 算不出来就别假装算得出来。
 */

export const DAY_MS = 86_400_000
export const STAGE_NAMES = ['信任', '自主', '主动', '整合']
/** M0：阶段只按天推进。瓶颈判定（撞墙）在 M1 实现，这里不假装有。 */
const STAGE_SPAN_DAYS = 7

const NAME_SAY_RE = /(?:称呼你|叫你|称呼他|叫他|称他)(?:做|为|作|叫)?\s*[「“"']?([^\s，。！？、,.!?」”"']{1,8})/
const NAME_TAIL = /[了吧呢啊嘛哦诶欸呀哈哇哦嘞好]+$/

/**
 * @param {Array<object>} events 已按 id 升序的事件
 * @param {{ now?:number, shown?:number, forgotten?:Set<string> }} opts
 */
export function derive(events = [], opts = {}) {
  const now = Number.isFinite(opts.now) ? opts.now : Date.now()
  const forgotten = opts.forgotten instanceof Set ? opts.forgotten : new Set()
  const live = events.filter((e) => e && !forgotten.has(e.id))

  const seed = live.find((e) => e.type === 'seed')
  const startMs = seed ? Date.parse(seed.ts) : (live[0] ? Date.parse(live[0].ts) : now)
  const day = Math.max(1, Math.floor((now - startMs) / DAY_MS) + 1)
  const stage = Math.min(STAGE_NAMES.length, Math.floor((day - 1) / STAGE_SPAN_DAYS) + 1)

  // 引用计数：谁被别的条目引用过，谁就更「被这个系统承认过」
  const refCount = new Map()
  for (const e of live) {
    for (const r of Array.isArray(e.refs) ? e.refs : []) {
      refCount.set(r, (refCount.get(r) || 0) + 1)
    }
  }

  const beliefs = live
    .filter((e) => e.type === 'meaning')
    .map((e) => {
      const refs = refCount.get(e.id) || 0
      const ageDays = Math.max(0, (now - Date.parse(e.ts)) / DAY_MS)
      const salience = refs * 2 + Math.exp(-ageDays / 30)
      return { id: e.id, text: e.content, ts: e.ts, refs, salience: Number(salience.toFixed(4)) }
    })
    .sort((a, b) => b.salience - a.salience || Date.parse(b.ts) - Date.parse(a.ts))

  const shown = Number.isInteger(opts.shown) && opts.shown > 0 ? opts.shown : 3
  const name = pickName(live)

  return {
    day,
    stage,
    stageName: STAGE_NAMES[stage - 1],
    beliefs,
    topBeliefs: beliefs.slice(0, shown),
    folded: beliefs.slice(shown),
    name,
    counts: {
      events: live.length,
      meanings: beliefs.length,
      utterances: live.filter((e) => e.type === 'utterance').length,
      workerMaterials: live.filter((e) => e.type === 'worker_material').length
    },
    derivedAt: new Date(now).toISOString()
  }
}

function pickName(events) {
  // 从新到旧找「叫你 X」；找不到返回空串（不瞎猜）
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]
    if (e.type !== 'utterance' && e.type !== 'meaning') continue
    const m = String(e.content ?? '').match(NAME_SAY_RE)
    if (!m) continue
    const cand = m[1].replace(NAME_TAIL, '')
    if (!cand || ['你', '我', '他', '她', '自己'].includes(cand)) continue
    return cand
  }
  return ''
}

/** 折叠：更早的判断压成一行，**不删除** */
export function foldLine(folded = []) {
  if (!folded.length) return ''
  const head = folded.slice(0, 3).map((b) => String(b.text).replace(/\s+/g, ' ').trim())
  let line = head.join('；')
  if (line.length > 160) line = line.slice(0, 159) + '…'
  return folded.length > head.length
    ? `${line}（还有 ${folded.length - head.length} 条更早的，你记不清原话了）`
    : line
}
