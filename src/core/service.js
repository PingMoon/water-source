/**
 * service.js —— 内核装配
 *
 * 把 M0 的五个零件接起来：
 *   db → 迁移 → 工具面断言 → seed → 账本 / 派生 / 投影 / 归并
 *
 * 只做装配，不做判断。启动顺序是**有意的**：
 *   断言在 seed 之前——工具面不对，连第一条事件都不该写。
 */

import { openDatabase, closeDatabase, integrityCheck } from '../store/db.js'
import { migrate, SCHEMA_VERSION, currentVersion } from '../store/migrations.js'
import { appendEvent, readEvents, addTombstone, rebuild, countEvents } from '../store/event-store.js'
import { assertTools } from '../tools/assertions.js'
import { writeSeed, DEFAULT_CONTRACT } from '../bootstrap/seed.js'
import { derive, foldLine } from '../derive/derive.js'
import { buildProjection, rewriteProjection } from '../derive/projection.js'
import { consolidate, lastRun } from '../consolidate/pipeline.js'
import { makeMeaning } from '../consolidate/meaning.js'
import { orderMaterials } from '../consolidate/sequencing.js'
import { decide } from '../ledger/write-gate.js'
import { checkContract } from '../bootstrap/contract-check.js'
import { activeThread, openThread, touchThread, listThreads, getThread } from '../thread/thread.js'
import { evaluate, recordDrop, overturn, listDrops, dropStats, DECISION } from '../eval/eval.js'
import { listSkills, readSkill, writeSkill, setStatus } from '../skill/store.js'
import { buildIndex } from '../skill/index.js'
import { matchSkill } from '../skill/match.js'
import { recordUse, useStats, recentUses } from '../skill/use.js'
import { induceSkill as induceFrom } from '../skill/induce.js'
import path from 'node:path'

/**
 * @param {{ dbPath:string, tools?:string[], templateId?:string, contract?:string }} opts
 */
export function createWhale(opts = {}) {
  const dbPath = String(opts.dbPath ?? '')
  const root = String(opts.root ?? (dbPath ? path.dirname(dbPath) : ''))
  if (!dbPath) throw new Error('createWhale 需要 dbPath')
  const templateId = opts.templateId ?? 'tp-default'
  let db = null
  let status = null

  function boot() {
    db = openDatabase({ path: dbPath })
    const mig = migrate(db)
    const integrity = integrityCheck(db)
    if (!integrity.ok) {
      closeDatabase(db); db = null
      throw new Error('数据库完整性检查失败：' + integrity.problems.join('; '))
    }
    // 断言先于一切写入
    // 插件模式下工具面由宿主决定，启动时断言没有意义——断在独立运行时（CLI/测试）。
    const toolCheck = opts.assertTools === false
      ? { ok: true, skipped: true, why: '插件模式：工具面由宿主决定' }
      : assertTools(opts.tools ?? [], { templateId })
    let seeded = false
    if (countEvents(db) === 0) {
      writeSeed(db, { contract: opts.contract ?? DEFAULT_CONTRACT })
      seeded = true
    }
    status = {
      ok: true,
      dbPath,
      schemaVersion: currentVersion(db),
      expectedVersion: SCHEMA_VERSION,
      migrated: mig.applied,
      tools: toolCheck,
      seeded,
      events: countEvents(db)
    }
    return status
  }

  function requireDb() {
    if (!db) throw new Error('还没有 boot()')
    return db
  }

  function state(nowOpts = {}) {
    const events = readEvents(requireDb(), { includeForgotten: false })
    const forgotten = new Set(
      readEvents(requireDb(), { includeForgotten: true })
        .filter((e) => !events.find((x) => x.id === e.id))
        .map((e) => e.id)
    )
    return derive(events, { ...nowOpts, forgotten })
  }

  return {
    boot,
    close() { closeDatabase(db); db = null },
    status: () => status,
    append(raw, o) { return appendEvent(requireDb(), raw, o) },
    read(filter) { return readEvents(requireDb(), filter) },
    forget(eventId, reason) { return addTombstone(requireDb(), eventId, reason) },
    rebuild() { return rebuild(requireDb()) },
    state,
    projection(nowOpts) { return buildProjection(state(nowOpts)) },
    /** 改写版投影：出本机用这个，不是 projection() */
    async projectionForRemote(llmOpts, nowOpts) { return rewriteProjection(state(nowOpts), llmOpts) },
    folded(nowOpts) { return foldLine(state(nowOpts).folded) },
    consolidate(llmOpts) { return consolidate(requireDb(), llmOpts) },
    lastRun() { return lastRun(requireDb()) },
    // ---- M1：入口流水线 ----
    /** 一条消息进来：判 → 接 / 丢 / 旁路 */
    ingest(text, o = {}) {
      const db2 = requireDb()
      const now = Number.isFinite(o.now) ? o.now : Date.now()
      const room = String(o.room ?? 'local')
      const ttlMs = Number.isFinite(o.ttlMs) ? o.ttlMs : 30 * 60_000
      const active = activeThread(db2, room, now, ttlMs)
      const ev = evaluate({ text, room, activeThread: active })
      if (ev.decision === DECISION.DROP) {
        const dropId = recordDrop(db2, { text, rule: ev.rule, reason: ev.why, now })
        return { decision: 'drop', dropId, visible: ev.visible, why: ev.why, rule: ev.rule }
      }
      let threadKey = ev.threadKey
      if (ev.decision === DECISION.ACCEPT) threadKey = openThread(db2, room, now).key
      else touchThread(db2, threadKey, now)
      const event = appendEvent(db2, { type: 'utterance', content: String(text ?? ''), meta: { thread: threadKey, room } }, {})
      return { decision: ev.decision, threadKey, event, visible: '' }
    },
    threads(limit) { return listThreads(requireDb(), limit) },
    thread(key) { return getThread(requireDb(), key) },
    activeThread(room, o = {}) { return activeThread(requireDb(), room, o.now ?? Date.now(), o.ttlMs ?? 30 * 60_000) },
    drops(limit) { return listDrops(requireDb(), limit) },
    overturn(dropId) { return overturn(requireDb(), dropId) },
    dropStats() { return dropStats(requireDb()) },
    // ---- M2：skill 生命周期 ----
    async skills() { return listSkills(root) },
    async skill(id) { return readSkill(root, id) },
    async writeSkill(input) { return writeSkill(root, input) },
    async setSkillStatus(id, status) { return setStatus(root, id, status) },
    async skillIndex(o) { return buildIndex(await listSkills(root), o) },
    async matchSkill(task, o) { return matchSkill(task, await listSkills(root), o) },
    /** 一次任务：先找手册，找不到就明说「这次没有可用的」 */
    async runTask(task, o = {}) {
      const hits = await matchSkill(task, await listSkills(root), o)
      if (!hits.length) return { usedSkill: null, task, needsNewSkill: true }
      const best = hits[0]
      recordUse(requireDb(), { skillId: best.skill.id, task, outcome: o.outcome ?? 'unknown', now: o.now })
      return { usedSkill: best.skill.id, score: best.score, task, steps: best.skill.body, alternates: hits.slice(1).map((h) => h.skill.id) }
    },
    skillUse(skillId) { return useStats(requireDb(), skillId) },
    recentSkillUses(skillId, limit) { return recentUses(requireDb(), skillId, limit) },
    /** 够次数且没有失败 → 草稿转正 */
    async maybePromote(skillId) {
      const st = useStats(requireDb(), skillId)
      if (!st.canPromote) return { promoted: false, ...st }
      await setStatus(root, skillId, 'verified')
      return { promoted: true, ...st }
    },
    /** 从一次任务的材料里归纳一份 SKILL 草稿（draft），不是 verified */
    async learnFrom(materials, o = {}) {
      const r = await induceFrom({ materials, llm: o.llm, context: { goal: o.goal }, signal: o.signal })
      if (!r.ok) return r
      const written = await writeSkill(root, { ...r.skill, status: 'draft' })
      return { ok: true, skill: written }
    },
    // 纯函数导出，方便调用方单独用
    lib: { decide, orderMaterials, makeMeaning, checkContract, derive, buildProjection },
    get db() { return db }
  }
}
