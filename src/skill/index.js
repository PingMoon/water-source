/**
 * index.js —— skill 索引
 *
 * 只有 description 进索引（架构 §3.13）。正文按需读取。
 * 索引有硬预算：装不下的 skill 留在磁盘上，但不进索引——**不许悄悄撑爆上下文**。
 */

export const INDEX_BUDGET = 2000

/**
 * @param {Array<{id:string, description:string, status:string}>} skills
 * @param {{ budget?:number }} opts
 */
export function buildIndex(skills = [], opts = {}) {
  const budget = Number.isInteger(opts.budget) && opts.budget > 0 ? opts.budget : INDEX_BUDGET
  const usable = skills
    .filter((s) => s && s.status !== 'deprecated' && String(s.description ?? '').trim())
    .sort((a, b) => String(a.id).localeCompare(String(b.id)))

  const lines = []
  let used = 0
  const skipped = []
  for (const s of usable) {
    const line = '- ' + s.id + ': ' + String(s.description).replace(/\s+/g, ' ').trim()
    if (used + line.length + 1 > budget) { skipped.push(s.id); continue }
    lines.push(line)
    used += line.length + 1
  }
  return {
    text: lines.join('\n'),
    used,
    budget,
    included: lines.length,
    skipped
  }
}
