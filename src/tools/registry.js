/**
 * registry.js —— 工具面模板注册表
 *
 * 只做一件事：把「她能调什么」写成显式清单。
 * 不允许 ticket 自行取并集，不允许运行时拼装（架构 D7 / I1）。
 *
 * M0 只定结构，具体工具名在接 DSH 时填。
 */

export const TEMPLATES = {
  'tp-default': {
    id: 'tp-default',
    purpose: '通用执行',
    tools: ['fs.read', 'fs.write', 'shell.run'],
    note: '沙箱内文件读写与受限命令'
  },
  'tp-research': {
    id: 'tp-research',
    purpose: '资料研究',
    tools: ['http.fetch', 'search.query', 'fs.read'],
    note: '只读为主，不写不删'
  },
  'tp-ops': {
    id: 'tp-ops',
    purpose: '运维动作',
    tools: ['ops.logs', 'ops.restart', 'ops.disk'],
    note: '仅白名单闭包动作（见架构 §3.12）'
  }
}

export function loadTemplates() {
  return Object.values(TEMPLATES).map((t) => ({ ...t, tools: [...t.tools] }))
}

export function getTemplate(id) {
  const t = TEMPLATES[id]
  return t ? { ...t, tools: [...t.tools] } : null
}
