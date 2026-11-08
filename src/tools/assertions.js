/**
 * assertions.js —— 启动期断言：工具面对不上就不许跑
 *
 * 这是 I1 的执行点。前面写「工具面 = 注册表清单」只是一句话，
 * 这里让它在启动时**物理失败**——不是警告，是拒绝启动。
 *
 * 规则：
 *   1. 实际工具集必须**完全等于**某个已注册模板的工具集（不允许超集）；
 *   2. 不允许「多个模板求并集」——那是最常见的越权方式；
 *   3. 不在任何模板里的工具，直接点名报出来。
 */

import { InvariantError } from '../util/errors.js'
import { loadTemplates } from './registry.js'

/**
 * @param {string[]} actual 实际注册的工具名
 * @param {{ templateId?:string, templates?:object[] }} opts
 */
export function assertTools(actual = [], opts = {}) {
  const templates = opts.templates ?? loadTemplates()
  const set = new Set(actual.map(String))
  const wanted = opts.templateId ? templates.filter((t) => t.id === opts.templateId) : templates

  if (opts.templateId && !wanted.length) {
    throw new InvariantError('模板不存在：' + opts.templateId, { available: templates.map((t) => t.id) })
  }

  for (const t of wanted) {
    const allowed = new Set(t.tools)
    const extra = [...set].filter((x) => !allowed.has(x))
    const missing = [...allowed].filter((x) => !set.has(x))
    if (!extra.length && !missing.length) {
      return { ok: true, templateId: t.id, tools: [...set] }
    }
  }

  const allKnown = new Set(templates.flatMap((t) => t.tools))
  const unknown = [...set].filter((x) => !allKnown.has(x))
  throw new InvariantError('工具面与任何已注册模板都不一致，拒绝启动', {
    actual: [...set],
    unknown,
    templates: templates.map((t) => t.id),
    hint: unknown.length
      ? '这些工具不在任何模板里：' + unknown.join(', ')
      : '工具集合是多个模板的并集，或缺少模板里的工具'
  })
}
