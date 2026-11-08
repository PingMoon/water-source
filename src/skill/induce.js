/**
 * induce.js —— 从一次做过的事里，归纳出一份 SKILL 草稿
 *
 * 这是 M2 最难的一步，难点不在写，在**判断什么值得写**。
 *
 * 三条硬约束：
 *   1. 归纳的是「方法」，不是「流水账」——步骤要离开这一次也成立；
 *   2. 允许它说「这次没什么可复用的」（skip）——宁可不出手册，也不出垃圾手册；
 *   3. 产出是 draft，且记着来源。要人审或用过才转 verified。
 *
 * 为什么宁可 skip：一份错的手册比没有手册更糟——她会照着错的步骤做，
 * 还觉得自己会了。
 */

import { LlmError } from '../llm/client.js'

export const MAX_STEPS = 8

const SYSTEM = [
  '你在把一次做过的事，写成一份「以后遇到同类事情能照着做」的手册。',
  '',
  '输入是这次的材料：做了什么、遇到什么、结果如何。',
  '输出必须是 JSON，不要解释、不要代码块：',
  '',
  '{',
  '  "id": "英文短名，小写字母/数字/连字符，<=32 字符",',
  '  "name": "中文短名",',
  '  "description": "什么时候用这份手册，一句话，以「当…时使用」的形式",',
  '  "steps": ["步骤1", "步骤2"],',
  '  "pitfalls": ["这次踩到的坑，以后要避开"],',
  '  "skip": false',
  '}',
  '',
  '规则：',
  '1. 步骤要抽象成「怎么做这类事」，不是「这次做了什么」；',
  '2. 不写具体的人名、项目名、日期、数字、文件路径；',
  '3. 最多 8 步，每步一句话；',
  '4. 如果这次**没有可复用的方法**（只是一次性的事、或者纯运气），返回',
  '   {"skip": true, "why": "一句话说明为什么"}',
  '5. description 决定这份手册以后会不会被想起来——写得越具体越准，别写成「用于各种任务」。'
].join('\n')

/**
 * @param {{ materials: Array<{content:string}>, llm: {chat:Function}, signal?:AbortSignal, context?: object }} input
 * @returns {Promise<{ok:boolean, skill?:object, skipped?:boolean, why?:string}>}
 */
export async function induceSkill({ materials = [], llm, signal, context = {} } = {}) {
  if (!llm || typeof llm.chat !== 'function') throw new LlmError('induceSkill 需要 llm.chat')
  const list = materials.filter((m) => m && String(m.content ?? '').trim())
  if (!list.length) return { ok: false, skipped: true, why: '没有材料' }

  const body = [
    context.goal ? '这次要做的事：' + String(context.goal).slice(0, 200) : '',
    '材料：',
    ...list.map((m, i) => (i + 1) + '. ' + String(m.content).replace(/\s+/g, ' ').slice(0, 400))
  ].filter(Boolean).join('\n')

  const res = await llm.chat(
    [{ role: 'system', content: SYSTEM }, { role: 'user', content: body }],
    { temperature: 0.2, signal }
  )
  return normalize(parse(res.content))
}

export function normalize(raw) {
  if (!raw || typeof raw !== 'object') return { ok: false, skipped: true, why: 'not_json' }
  if (raw.skip === true) return { ok: false, skipped: true, why: String(raw.why ?? '模型判断没有可复用的方法') }

  const name = String(raw.name ?? '').trim()
  const description = String(raw.description ?? '').trim()
  const steps = Array.isArray(raw.steps) ? raw.steps.map((s) => String(s ?? '').trim()).filter(Boolean) : []
  if (!name) return { ok: false, skipped: true, why: 'name 为空' }
  if (!description) return { ok: false, skipped: true, why: 'description 为空（没有它就不会被想起来）' }
  if (!steps.length) return { ok: false, skipped: true, why: 'steps 为空' }

  const pitfalls = Array.isArray(raw.pitfalls) ? raw.pitfalls.map((s) => String(s ?? '').trim()).filter(Boolean) : []
  const id = slug(raw.id) || slug(name) || ('skill-' + Date.now())

  const lines = ['## 什么时候用', '', description, '', '## 步骤', '']
  steps.slice(0, MAX_STEPS).forEach((s, i) => lines.push((i + 1) + '. ' + s))
  if (pitfalls.length) {
    lines.push('', '## 坑', '')
    for (const p of pitfalls.slice(0, 5)) lines.push('- ' + p)
  }

  return {
    ok: true,
    skill: {
      id,
      name,
      description,
      body: lines.join('\n'),
      steps: steps.slice(0, MAX_STEPS),
      pitfalls: pitfalls.slice(0, 5)
    }
  }
}

/** 只留小写字母/数字/连字符，最长 32 */
export function slug(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 32)
}

/** 模型有时包代码块或加话，抠出最外层对象 */
export function parse(text) {
  const s = String(text ?? '')
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const body = fence ? fence[1] : s
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try { return JSON.parse(body.slice(start, end + 1)) } catch { return null }
}
