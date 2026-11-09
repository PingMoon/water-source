/**
 * config.js —— 可改的配置（设置页写这里，不是 cordis.patch.yml）
 *
 * 为什么分两处：
 *   · cordis.patch.yml 是**部署时**的配置（根目录、模板、工具面）——改它要重启宿主；
 *   · 这里存**运行时可改**的（名字、称呼、分会话、开关）——设置页改完立即生效。
 *
 * 形状照 dsh-fish 的 settings.js：默认值 + 白名单校验 + 原子写。
 * 白名单是硬约束：拼错的键连盘都写不进去。
 */

import fs from 'node:fs'
import path from 'node:path'

export const CONFIG_FILE = 'config.json'

/** 允许从设置页修改的键。其余一律拒。 */
export const EDITABLE = new Set(['herName', 'ownerName', 'herSessionId', 'stripHostPrompt'])

export const DEFAULTS = {
  /** 她叫什么（空 = 还没有名字） */
  herName: '',
  /** 她管主人叫什么 */
  ownerName: '',
  /**
   * 她的会话 id。
   * 留空 = 不隔离（所有会话的消息都进账本）
   * 填了 = 只记那一间房（别的 agent 的对话不混进来）
   */
  herSessionId: '',
  /**
   * 摘掉宿主默认 prompt 里那段 "You are a coding agent…"。
   * 默认关——它动的是宿主，不是我们自己的地盘。
   */
  stripHostPrompt: false
}

const MAX_STR = 200

/** 校验一条键值。返回 { ok, value } 或 { ok:false, why } */
export function validateOne(key, value) {
  if (!EDITABLE.has(key)) return { ok: false, why: '这个键不许改：' + key }
  if (key === 'stripHostPrompt') {
    if (typeof value !== 'boolean') return { ok: false, why: 'stripHostPrompt 只能是 true / false' }
    return { ok: true, value }
  }
  if (typeof value !== 'string') return { ok: false, why: key + ' 要是字符串' }
  const v = value.trim()
  if (v.length > MAX_STR) return { ok: false, why: key + ' 太长了（最多 ' + MAX_STR + ' 字）' }
  // 会话 id 只允许字母数字和 - _ ，避免有人把路径塞进来
  if (key === 'herSessionId' && v && !/^[A-Za-z0-9_-]{1,128}$/.test(v)) {
    return { ok: false, why: '会话 id 只能是字母、数字、- 和 _（最长 128）' }
  }
  return { ok: true, value: v }
}

export function validatePatch(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    return { ok: false, why: '要一个对象' }
  }
  const out = {}
  const errors = []
  for (const [k, v] of Object.entries(patch)) {
    const r = validateOne(k, v)
    if (r.ok) out[k] = r.value
    else errors.push(r.why)
  }
  if (errors.length) return { ok: false, why: errors.join('；'), kept: out }
  return { ok: true, value: out }
}

/** 读盘上的配置，缺的用默认值补 */
export function load(root) {
  const file = path.join(root, CONFIG_FILE)
  let raw = {}
  try { raw = JSON.parse(fs.readFileSync(file, 'utf8')) } catch { raw = {} }
  const out = { ...DEFAULTS }
  for (const k of EDITABLE) {
    const r = validateOne(k, raw[k] ?? DEFAULTS[k])
    if (r.ok) out[k] = r.value
  }
  return out
}

/** 原子写：先写临时文件再 rename，避免写一半断电留下坏 JSON */
export function save(root, next) {
  const file = path.join(root, CONFIG_FILE)
  fs.mkdirSync(root, { recursive: true })
  const tmp = file + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + '\n', 'utf8')
  fs.renameSync(tmp, file)
  return next
}

/** 合并一组改动并落盘 */
export function patch(root, changes) {
  const v = validatePatch(changes)
  if (!v.ok) return v
  const next = { ...load(root), ...v.value }
  save(root, next)
  return { ok: true, value: next }
}
