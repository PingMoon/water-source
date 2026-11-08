/**
 * schema.js —— 事件类型、校验、ID
 *
 * 校验分「必填项」与「结构义务」两类：
 *   - 必填项：type/content/person/source 合法；
 *   - 结构义务：meaning 必须挂原文引用（refs 非空）——这是架构里
 *     「意义句必须有真实来源」的落地，不是格式偏好。
 *
 * 来源：dsh-fish v0.9.3 lib/schema.js 的事件校验骨架（MIT），按我们的类型表重写。
 */

import { ValidationError } from '../util/errors.js'
import { newId } from '../util/ids.js'

export const EV_SCHEMA_VERSION = 1

/** M0 的事件类型子集。新增类型必须在这里登记，不允许自由字符串。 */
export const EVENT_TYPES = [
  'seed',             // 冷启动契约（第一条事件）
  'utterance',        // 她说的话
  'worker_material',  // worker 交回的第三人称材料
  'meaning',          // 归并产出的第一人称经历
  'forget',           // 遗忘标记（同时写 event_tombstone）
  'meta'              // 系统记账
]

export const PERSONS = ['first', 'third']
export const SOURCES = ['system', 'tool', 'worker']

const CONTENT_MAX_BYTES = 8192

/** 需要挂原文引用的类型（结构义务） */
const NEEDS_REFS = new Set(['meaning'])

function bytesOf(s) {
  return Buffer.byteLength(String(s ?? ''), 'utf8')
}

/**
 * 校验并规范化一条待写入事件。
 * @param {object} raw
 * @param {{ knownIds?: Set<string> | null }} opts
 * @returns {object} 规范化后的事件（含 id / ts / schema_v）
 */
export function validateEvent(raw, opts = {}) {
  if (!raw || typeof raw !== 'object') throw new ValidationError('事件必须是对象')
  const type = String(raw.type ?? '')
  if (!EVENT_TYPES.includes(type)) {
    throw new ValidationError('未知事件类型：' + (type || '(空)'))
  }
  const content = String(raw.content ?? '')
  if (!content.trim()) throw new ValidationError('content 不能为空')
  if (bytesOf(content) > CONTENT_MAX_BYTES) {
    throw new ValidationError('content 超过物理上限 ' + CONTENT_MAX_BYTES + ' 字节', { bytes: bytesOf(content) })
  }
  const person = String(raw.person ?? (type === 'meaning' ? 'first' : 'third'))
  if (!PERSONS.includes(person)) throw new ValidationError('person 只能是 ' + PERSONS.join(' / '))
  const source = String(raw.source ?? 'system')
  if (!SOURCES.includes(source)) throw new ValidationError('source 只能是 ' + SOURCES.join(' / '))

  const refs = Array.isArray(raw.refs) ? raw.refs.map(String) : []
  if (NEEDS_REFS.has(type) && refs.length === 0) {
    throw new ValidationError(type + ' 必须挂原文引用（refs 不能为空）：没有来源的意义句不许落库')
  }
  if (opts.knownIds) {
    for (const r of refs) {
      if (!opts.knownIds.has(r)) {
        throw new ValidationError('refs 指向不存在的事件：' + r)
      }
    }
  }

  const ts = normalizeTs(raw.ts)
  return {
    id: String(raw.id ?? newId(Date.parse(ts))),
    schema_v: Number.isInteger(raw.schema_v) ? raw.schema_v : EV_SCHEMA_VERSION,
    ts,
    type,
    source,
    person,
    content,
    refs_json: JSON.stringify(refs),
    meta_json: JSON.stringify(raw.meta && typeof raw.meta === 'object' ? raw.meta : {})
  }
}

function normalizeTs(ts) {
  if (typeof ts === 'number' && Number.isFinite(ts)) return new Date(ts).toISOString()
  const t = Date.parse(String(ts ?? ''))
  return new Date(Number.isFinite(t) ? t : Date.now()).toISOString()
}

/** 从数据库行还原成内存对象 */
export function rowToEvent(row) {
  if (!row) return null
  return {
    id: row.id,
    v: row.schema_v,
    ts: row.ts,
    type: row.type,
    source: row.source,
    person: row.person,
    content: row.content,
    refs: safeJson(row.refs_json, []),
    meta: safeJson(row.meta_json, {})
  }
}

function safeJson(s, fallback) {
  try { return JSON.parse(s) } catch { return fallback }
}
