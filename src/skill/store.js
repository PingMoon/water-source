/**
 * store.js —— SKILL.md 的读写
 *
 * 形态（架构 D14 / §3.13）：
 *   skills/<id>/SKILL.md
 *
 *   ---
 *   name: 短名
 *   description: 一句话说明「什么情况下用它」——**只有这一行进索引**
 *   status: draft | verified | deprecated
 *   ---
 *   （正文：步骤、检查项）
 *
 * 三条硬约束（抄 super-agent 的 skills 约定）：
 *   1. 只读 SKILL.md，且必须是普通文件（符号链接一律忽略）——防「技能变成任意文件读」；
 *   2. id 必须匹配 ^[a-z0-9][a-z0-9-]{0,63}$；
 *   3. 正文超过 16000 字截断并标记。
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'

export const SKILL_MAX_BYTES = 256 * 1024
export const BODY_MAX = 16_000
export const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/
export const STATUSES = ['draft', 'verified', 'deprecated']

function skillsDir(root) {
  return path.join(root, 'skills')
}

/** 解析 frontmatter + body（不引 yaml 依赖，M2 只认简单键值） */
export function parseSkill(text) {
  const s = String(text ?? '')
  const m = s.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!m) return { meta: {}, body: s.trim() }
  const meta = {}
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([a-zA-Z_][\w-]*):\s*(.*)$/)
    if (kv) meta[kv[1]] = kv[2].trim()
  }
  return { meta, body: m[2].trim() }
}

export function renderSkill({ name, description, status = 'draft', body = '' }) {
  return [
    '---',
    'name: ' + String(name ?? '').replace(/\n/g, ' '),
    'description: ' + String(description ?? '').replace(/\n/g, ' '),
    'status: ' + status,
    '---',
    '',
    String(body ?? '').trim(),
    ''
  ].join('\n')
}

export async function listSkills(root) {
  const dir = skillsDir(root)
  let ids = []
  try {
    const ents = await fs.readdir(dir, { withFileTypes: true })
    ids = ents.filter((e) => e.isDirectory() && ID_RE.test(e.name)).map((e) => e.name)
  } catch (err) {
    if (err.code === 'ENOENT') return []
    throw err
  }
  const out = []
  for (const id of ids.sort()) {
    const skill = await readSkill(root, id)
    if (skill) out.push(skill)
  }
  return out
}

export async function readSkill(root, id) {
  if (!ID_RE.test(String(id ?? ''))) return null
  const file = path.join(skillsDir(root), id, 'SKILL.md')
  let st
  try { st = await fs.lstat(file) } catch { return null }
  // 符号链接一律不认
  if (!st.isFile()) return null
  if (st.size > SKILL_MAX_BYTES) return null
  const text = await fs.readFile(file, 'utf8')
  const { meta, body } = parseSkill(text)
  const truncated = body.length > BODY_MAX
  return {
    id,
    name: meta.name || id,
    description: meta.description || '',
    status: STATUSES.includes(meta.status) ? meta.status : 'draft',
    body: truncated ? body.slice(0, BODY_MAX) : body,
    truncated,
    bytes: st.size
  }
}

export async function writeSkill(root, { id, name, description, status = 'draft', body = '' }) {
  if (!ID_RE.test(String(id ?? ''))) throw new Error('skill id 不合法：' + id)
  if (!String(description ?? '').trim()) throw new Error('skill 必须有 description（它决定什么时候被想起来）')
  const dir = path.join(skillsDir(root), id)
  await fs.mkdir(dir, { recursive: true })
  const file = path.join(dir, 'SKILL.md')
  await fs.writeFile(file, renderSkill({ name, description, status, body }), 'utf8')
  return readSkill(root, id)
}

export async function setStatus(root, id, status) {
  if (!STATUSES.includes(status)) throw new Error('status 只能是 ' + STATUSES.join(' / '))
  const cur = await readSkill(root, id)
  if (!cur) throw new Error('没有这个 skill：' + id)
  return writeSkill(root, { ...cur, status })
}
