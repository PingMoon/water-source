/**
 * use.js —— skill 的使用记录与晋升
 *
 * 为什么单独记：架构 D14 说「学习落点是 SKILL.md」，但光写不算学会。
 * **被用过、且用成了**，才算。这张表是判断依据。
 *
 * 晋升规则（M2）：
 *   draft → verified：用过 ≥ 3 次，且没有 fail 记录。
 *   verified → deprecated：人工降级（或将来由评估门）。
 */

import { newId } from '../util/ids.js'

export const USE_OUTCOMES = ['ok', 'fail', 'unknown']
export const PROMOTE_MIN_USES = 3

export function recordUse(db, { skillId, task, outcome = 'unknown', now = Date.now() }) {
  if (!skillId) throw new Error('recordUse 需要 skillId')
  if (!USE_OUTCOMES.includes(outcome)) throw new Error('outcome 只能是 ' + USE_OUTCOMES.join(' / '))
  const id = newId(now)
  db.prepare('INSERT INTO skill_use (id, skill_id, task, outcome, at) VALUES (?, ?, ?, ?, ?)')
    .run(id, String(skillId), String(task ?? '').slice(0, 500), outcome, new Date(now).toISOString())
  return { id, skillId, task, outcome }
}

export function useStats(db, skillId) {
  const rows = db.prepare('SELECT outcome, COUNT(*) AS c FROM skill_use WHERE skill_id = ? GROUP BY outcome').all(String(skillId))
  const by = { ok: 0, fail: 0, unknown: 0 }
  for (const r of rows) by[r.outcome] = Number(r.c)
  const total = by.ok + by.fail + by.unknown
  return { total, ...by, canPromote: total >= PROMOTE_MIN_USES && by.fail === 0 }
}

export function recentUses(db, skillId, limit = 10) {
  return db.prepare('SELECT * FROM skill_use WHERE skill_id = ? ORDER BY at DESC LIMIT ?').all(String(skillId), limit)
}
