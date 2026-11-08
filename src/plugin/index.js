/**
 * index.js —— DSH 插件入口
 *
 * 接线方式对齐 dsh-fish：
 *   - inject 必须是**一个数组**（写成对象字面量会后者覆盖前者，服务静默缺失）
 *   - apply(ctx, config) 里做：读配置 → 建内核 → 注册工具 → 挂 systemPrompt → 监听 agent
 *   - dispose：停计时器、关库。停用插件 = 零后台活动。
 */

import os from 'node:os'
import path from 'node:path'
import { createWhale } from '../core/service.js'
import { defineTool } from './tool.js'

export const name = 'whale'
export const VERSION = '0.1.0'

/** 一个数组写全。缺哪个服务，插件就不会被加载——所以只列真正需要的。 */
export const inject = ['tools', 'systemPrompt', 'agents']

const MEMORY_SECTION = 'whale-memory'
const REMEMBER_TOOL = 'remember'

export function apply(ctx, config = {}) {
  const root = String(config.root ?? process.env.WHALE_HOME ?? path.join(os.homedir(), '.whale'))
  const templateId = String(config.templateId ?? 'tp-default')
  const tools = Array.isArray(config.tools) ? config.tools : ['fs.read', 'fs.write', 'shell.run']
  const disposers = []
  const diag = []
  let whale = null
  let stopped = false

  const log = (msg) => {
    const line = '[whale] ' + msg
    diag.push(line)
    try { ctx?.logger?.info?.(line) } catch { /* 宿主 logger 不可用就算了 */ }
  }

  try {
    // 插件模式：工具面由 DSH 决定，所以跳过工具面断言（断言在独立运行时生效）
    whale = createWhale({ dbPath: path.join(root, 'ledger.db'), root, tools, templateId, assertTools: false })
    const boot = whale.boot()
    log('启动 · schema v' + boot.schemaVersion + ' · 事件 ' + boot.events + ' · 播种 ' + (boot.seeded ? '是' : '否'))
  } catch (err) {
    // 启动失败不能带走整个插件树——但必须留下痕迹，别静默变哑巴
    log('启动失败：' + String(err?.message ?? err).slice(0, 200))
    return { dispose() {} }
  }

  // ---- 工具：她自己记 ----
  try {
    if (ctx?.tools?.register) {
      const off = ctx.tools.register(defineTool({
        name: REMEMBER_TOOL,
        description: '把一件值得长期记住的事记下来（约定、偏好、边界、发生过的事）。日常琐事不要记。',
        parameters: {
          type: 'object',
          properties: {
            text: { type: 'string', description: '要记住的事，一句话说清。用第一人称写（「我」）。' },
            importance: { type: 'number', description: '0.5 = 普通（默认）；1 = 不能忘的（名字、忌讳、约定）' }
          },
          required: ['text'],
          additionalProperties: false
        },
        output: {
          schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean' } } },
          render: (_a, v) => [{ type: 'text', text: v && v.ok ? '✓' : '✗' }]
        },
        async execute(args) {
          if (stopped || !whale) return { ok: false }
          const text = String(args?.text ?? '').trim()
          if (!text) return { ok: false }
          whale.append({ type: 'utterance', content: text, person: 'first', source: 'tool' })
          return { ok: true }
        }
      }))
      if (typeof off === 'function') disposers.push(off)
    }
  } catch (err) {
    log('remember 工具没挂上：' + String(err?.message ?? err).slice(0, 160))
  }

  // ---- 注入：把「她记得的事」放进 systemPrompt.context ----
  // 用 context 不用 section：section 会改系统提示词，整段前缀缓存作废。
  function attachTo(agent) {
    try {
      if (!agent?.ctx?.systemPrompt?.context) return null
      return agent.ctx.systemPrompt.context({
        name: MEMORY_SECTION,
        order: 900,
        interpolate: false,
        text: () => {
          if (stopped || !whale) return ''
          try {
            const model = whale.state()
            const lines = (model.topBeliefs || []).map((b) => '- ' + String(b.text))
            const folded = whale.folded()
            if (!lines.length) return ''
            return ['【你记得的事】', ...lines, folded ? '- ' + folded : ''].filter(Boolean).join('\n')
          } catch { return '' }
        }
      })
    } catch (err) {
      log('systemPrompt 挂不上：' + String(err?.message ?? err).slice(0, 160))
      return null
    }
  }

  try {
    if (ctx?.on) {
      ctx.on('agent/created', (payload) => {
        const agent = payload?.agent ?? payload
        const off = attachTo(agent)
        if (typeof off === 'function') disposers.push(off)
      })
    }
  } catch (err) {
    log('agent/created 监听没挂上：' + String(err?.message ?? err).slice(0, 160))
  }

  // 已经存在的 agent 也要挂（插件中途启用的情况）
  try {
    for (const agent of ctx?.agents?.list?.() ?? []) {
      const off = attachTo(agent)
      if (typeof off === 'function') disposers.push(off)
    }
  } catch { /* 拿不到列表就算了，agent/created 会补 */ }

  function shutdown() {
    if (stopped) return
    stopped = true
    for (const d of disposers) { try { d() } catch { /* ignore */ } }
    try { whale?.close() } catch { /* ignore */ }
  }

  // cordis 4 不认 apply 返回的 { dispose }，只认 ctx.effect
  if (typeof ctx?.effect === 'function') ctx.effect(() => shutdown, 'whale.shutdown')
  else ctx?.on?.('dispose', shutdown)

  return {
    dispose() { shutdown() },
    // 给测试与观测用
    _diag: () => diag.slice(),
    _whale: () => whale
  }
}
