/**
 * pipeline.js —— 归并流水线：定序 → 意义化 → 否决 → 落库
 *
 * 这个文件只做编排，不做判断。每一步的判断都在它自己的模块里，
 * 出问题时能一眼看出是哪一步。
 *
 * 三条约束：
 *   1. 一次归并一条 consolidate_run 记录，失败标 failed（可重跑）；
 *   2. 只有过了否决的才写 meaning；
 *   3. 被否决的**不留内容**，只留 reasonCode 与 draft 的 refs——
 *      否则否决本身就变成了一次记录。
 */

import { readEvents, appendEvent } from '../store/event-store.js'
import { orderMaterials } from './sequencing.js'
import { makeMeaning } from './meaning.js'
import { checkVeto } from './veto.js'
import { newId } from '../util/ids.js'

/**
 * @param {object} db
 * @param {{ llm:{chat:Function}, now?:number, limit?:number, signal?:AbortSignal }} opts
 */
export async function consolidate(db, opts = {}) {
  const runId = newId()
  const startedAt = new Date().toISOString()
  db.prepare(
    "INSERT INTO consolidate_run (id, started_at, status, stats_json) VALUES (?, ?, 'running', '{}')"
  ).run(runId, startedAt)

  const stats = { materials: 0, ordered: 0, drafts: 0, accepted: 0, rejected: 0, dropped: 0, runId }
  try {
    const events = readEvents(db, { includeForgotten: true })
    const referenced = new Set()
    for (const e of events) for (const r of e.refs || []) referenced.add(r)

    const materials = events.filter((e) => e.type === 'worker_material')
    stats.materials = materials.length

    const ordered = orderMaterials(materials, { referenced, limit: opts.limit })
    stats.ordered = ordered.length
    if (!ordered.length) {
      finish(db, runId, 'done', stats)
      return { ok: true, ...stats }
    }

    const { drafts, dropped } = await makeMeaning(ordered, { llm: opts.llm, signal: opts.signal })
    stats.drafts = drafts.length
    stats.dropped = dropped.length

    const knownIds = new Set(events.map((e) => e.id))
    const beliefs = events.filter((e) => e.type === 'meaning').map((e) => ({ id: e.id, text: e.content }))
    const { accepted, rejected } = checkVeto(drafts, { knownIds, beliefs })
    stats.rejected = rejected.length

    for (const a of accepted) {
      appendEvent(db, { type: 'meaning', content: a.draft.content, refs: a.draft.refs, meta: a.draft.meta }, { knownIds })
      stats.accepted++
    }

    // ⚠ 字段名不能跟 stats 撞：stats.dropped 是数字，这里若同名会把它覆盖成数组
    const tail = {
      droppedDetail: dropped.map((d) => ({ why: d.why, refs: d.bad ?? null })),
      vetoedDetail: rejected.map((r) => ({ reasonCode: r.reasonCode, refs: r.draft.refs, detail: r.detail }))
    }
    finish(db, runId, 'done', { ...stats, ...tail })
    return { ok: true, ...stats, ...tail }
  } catch (err) {
    finish(db, runId, 'failed', { ...stats, error: String(err?.message ?? err).slice(0, 300) })
    throw err
  }
}

function finish(db, runId, status, stats) {
  db.prepare('UPDATE consolidate_run SET finished_at = ?, status = ?, stats_json = ? WHERE id = ?')
    .run(new Date().toISOString(), status, JSON.stringify(stats), runId)
}

/** 读上一次 run 的记录（调试与验收用） */
export function lastRun(db) {
  const row = db.prepare('SELECT * FROM consolidate_run ORDER BY started_at DESC LIMIT 1').get()
  if (!row) return null
  let stats = {}
  try { stats = JSON.parse(row.stats_json) } catch { /* ignore */ }
  return { ...row, stats }
}
