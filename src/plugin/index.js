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
import { mkdirSync, appendFileSync } from 'node:fs'
import { defineTool } from './tool.js'
import { registerIngest } from './ingest.js'
import { createDelegate } from './delegate.js'
import { createLlm } from '../llm/client.js'
import { isHer, callerOf } from './caller.js'
import { render as renderSections } from '../assemble/sections.js'
import { load as loadConfig } from '../config.js'
import { registerRoutes } from './routes.js'
import { attachAssembleFix } from './assemble-fix.js'

export const name = 'water-source'
export const VERSION = '0.1.0'

/** 一个数组写全。缺哪个服务，插件就不会被加载——所以只列真正需要的。 */
// ⚠ 只列**必须存在**的服务：缺一个，整个插件不会被加载。
// systemPrompt / agents 走可选探测（agent.ctx.systemPrompt?.context、ctx.agents?.list）。
// webServer 列进来是要注册设置页的 JSON 路由——fish 也列了，说明宿主一定有。
export const inject = ['tools', 'webServer']

const MEMORY_SECTION = 'water-source-memory'
const REMEMBER_TOOL = 'remember'

export function apply(ctx, config = {}) {
  const root = String(config.root ?? process.env.WATER_SOURCE_HOME ?? path.join(os.homedir(), '.water-source'))
  const templateId = String(config.templateId ?? 'tp-default')
  const tools = Array.isArray(config.tools) ? config.tools : ['fs.read', 'fs.write', 'shell.run']
  // 她的会话 id。没配置 = 还没有「她」自己的 agent，所以任何工具调用都不是她本人。
  const herSessionId = () => liveCfg.herSessionId
  // 她叫什么、管主人叫什么。**从配置来**，不写死在代码里——名字是她被赋予的，不是代码施舍的。
  // 部署时给的值是**默认值**，运行时可改的以 ~/.water-source/config.json 为准
  const bootCfg = loadConfig(root)
  const defaults = {
    herName: String(config.herName ?? bootCfg.herName ?? ''),
    ownerName: String(config.ownerName ?? bootCfg.ownerName ?? ''),
    herSessionId: String(config.herSessionId ?? bootCfg.herSessionId ?? ''),
    stripHostPrompt: Boolean(config.stripHostPrompt ?? bootCfg.stripHostPrompt ?? false)
  }
  let liveCfg = { ...bootCfg, ...defaults }
  const cfgGet = () => liveCfg
  const disposers = []
  const diag = []
  let whale = null
  let stopped = false

  const log = (msg) => {
    const line = '[water-source] ' + msg
    diag.push(line)
    try { ctx?.logger?.info?.(line) } catch { /* 宿主 logger 不可用就算了 */ }
  }

  try {
    // 插件模式：工具面由 DSH 决定，所以跳过工具面断言（断言在独立运行时生效）
    whale = createWhale({ dbPath: path.join(root, 'ledger.db'), root, tools, templateId, assertTools: false })
    const boot = whale.boot()
    log('启动 · schema v' + boot.schemaVersion + ' · 事件 ' + boot.events + ' · 播种 ' + (boot.seeded ? '是' : '否'))
  } catch (err) {
    // 启动失败不能带走整个插件树——但必须留下痕迹，别静默变哑巴。
    // 宿主 logger 在插件失败时常常收不到，所以同时写一份盘。
    const msg = String(err?.message ?? err).slice(0, 400)
    log('启动失败：' + msg)
    try {
      const dir = path.join(os.homedir(), '.dsh')
      mkdirSync(dir, { recursive: true })
      appendFileSync(path.join(dir, 'water-source-boot-error.log'),
        new Date().toISOString() + ' ' + msg + '\n' + String(err?.stack ?? '').split('\n').slice(0, 6).join('\n') + '\n')
    } catch { /* 连日志都写不了就真的没办法了 */ }
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
        async execute(args, exec) {
          if (stopped || !whale) return { ok: false }
          const text = String(args?.text ?? '').trim()
          if (!text) return { ok: false }
          // ⚠ person 由「谁在调」决定，不由参数决定。
          //
          // 之前这里写死 'first'——于是任何 agent 都能往账本里塞一句「我说的」，
          // 账本上还带着 person=first 这个凭据标记。那不是记忆，是伪造。
          // （实锤：2026-11-09 账本里那条「我叫小泉…」是别人替她写的。）
          //
          // 她自己的话走另一条路：session/event → ingest，那是真发生过的。
          const who = callerOf(exec)
          const person = isHer(exec, herSessionId()) ? 'first' : 'third'
          whale.append({ type: 'utterance', content: text, person, source: 'tool' })
          return { ok: true, person, caller: who.sessionId || 'system' }
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
        // 现算：事件变了下一轮就跟上，不用重建会话。
        // 内容来自装配层（src/assemble/sections.js），不是 derive 出来的结论。
        text: () => {
          if (stopped || !whale?.db) return ''
          try {
            const c = cfgGet()
            return renderSections(whale.db, { name: c.herName, ownerName: c.ownerName, room: c.herSessionId, now: Date.now() }).text
          } catch (err) {
            log('装配失败：' + String(err?.message ?? err).slice(0, 120))
            return ''
          }
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
        // stripHostPrompt：摘掉宿主那段 "You are a coding agent…"（默认关）
        try {
          const offFix = attachAssembleFix(agent, { enabled: () => Boolean(cfgGet().stripHostPrompt), log })
          if (typeof offFix === 'function') disposers.push(offFix)
        } catch (err) {
          log('组装钩子没挂上：' + String(err?.message ?? err).slice(0, 120))
        }
      })
    }
  } catch (err) {
    log('agent/created 监听没挂上：' + String(err?.message ?? err).slice(0, 160))
  }

  // ---- delegate：把活派给 worker ----
  try {
    const makeLlm = () => {
      const key = process.env.DEEPSEEK_API_KEY ?? process.env.DSH_DEEPSEEK_API_KEY
      if (!key) return null
      try { return createLlm({ apiKey: key, reasoningEffort: 'medium', timeoutMs: 120000 }) } catch { return null }
    }
    const delegateFn = createDelegate({ db: whale.db ?? null, makeLlm, log })
    if (whale.db) {
      const delegateTool = defineTool({
        name: 'delegate',
        description: '把一件需要独立执行者的事派给 worker 去做（会真实消耗 token）。适合：要做多步调研、要写代码、需要独立上下文的任务。不适合：闲聊、一句话能答的问题。',
        parameters: {
          type: 'object',
          properties: {
            goal: { type: 'string', description: '要做什么，一句话说清（用第一人称）' }
          },
          required: ['goal']
        },
        async execute(args) {
          return await delegateFn(args)
        }
      })
      disposers.push(ctx.tools.register(delegateTool))
      log('工具已注册: delegate')
    }
  } catch (err) {
    log('delegate 没挂上：' + String(err?.message ?? err).slice(0, 160))
  }

  // ---- 设置页的 JSON API ----
  // ⚠ 服务要用 ctx.get('webServer') 取——照 dsh-fish 的 safeGet。
  // 直接写 ctx.webServer 在 Cordis 4 里可能是 undefined，而且**静默**：
  // registerRoutes 收到 null 就 return 空函数，日志照打「已注册」，请求一律 404。
  try {
    let webServer = null
    try { webServer = typeof ctx.get === 'function' ? ctx.get('webServer') : null } catch { webServer = null }
    if (!webServer) webServer = ctx.webServer ?? null
    log('webServer: ' + (webServer ? (typeof webServer.register) : '缺失'))
    const offRoutes = registerRoutes(webServer, {
      root: () => root,
      getWhale: () => whale,
      version: () => VERSION,
      onConfigChanged: (next) => {
        liveCfg = { ...liveCfg, ...next }
        log('配置已更新：' + JSON.stringify(next))
      },
      log
    })
    if (typeof offRoutes === 'function') disposers.push(offRoutes)
    const routeOk = Boolean(webServer?.register)
    log('路由' + (routeOk ? '已注册' : '没注册（webServer.register 不存在）') + ': /water-source/{config,state}')
    try {
      const dir = path.join(os.homedir(), '.dsh')
      mkdirSync(dir, { recursive: true })
      // 注册之后 webServer 内部到底记了什么——这是决定性证据
      let diag = ''
      try {
        // 决定性自检：注册完之后，这个 webServer 自己认不认这条路由
        try {
          const m = typeof webServer?.match === 'function' ? webServer.match('/water-source/state') : undefined
          diag += ' selfMatch=' + (m ? ('命中:' + String(m.path ?? '')) : '未命中')
          if (webServer?.prefixes instanceof Map) diag += ' prefixesKeys=' + JSON.stringify([...webServer.prefixes.keys()])
        } catch (e) { diag += ' selfMatch抛错:' + String(e?.message ?? e).slice(0, 60) }
        const pf = webServer?.prefixes
        const ex = webServer?.exact
        const dump = (x) => {
          if (!x) return String(x)
          if (Array.isArray(x)) return 'arr[' + x.length + ']:' + JSON.stringify(x).slice(0, 600)
          if (x instanceof Map) return 'map[' + x.size + ']:' + JSON.stringify([...x.keys()]).slice(0, 600)
          if (typeof x === 'object') return 'obj:' + JSON.stringify(Object.keys(x)).slice(0, 400)
          return String(x)
        }
        diag = ' prefixes=' + dump(pf) + ' exact=' + dump(ex)
      } catch (e) { diag = ' dump失败:' + String(e?.message ?? e).slice(0, 80) }
      appendFileSync(path.join(dir, 'water-source-route.log'),
        new Date().toISOString() + ' webServer=' + (webServer ? 'yes' : 'null') +
        ' register=' + typeof webServer?.register + ' routeOk=' + routeOk + diag + '\n')
    } catch { /* ignore */ }
  } catch (err) {
    log('路由没挂上：' + String(err?.message ?? err).slice(0, 160))
  }

  // ---- 自动 ingest：真人说的话自己进流水线 ----
  try {
    const offIngest = registerIngest(ctx, { whale, log, herSessionId: herSessionId() })
    if (typeof offIngest === 'function') disposers.push(offIngest)
    log('已挂 session/event 观察者')
  } catch (err) {
    log('ingest 观察者没挂上：' + String(err?.message ?? err).slice(0, 160))
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
  if (typeof ctx?.effect === 'function') ctx.effect(() => shutdown, 'water-source.shutdown')
  else ctx?.on?.('dispose', shutdown)

  return {
    dispose() { shutdown() },
    // 给测试与观测用
    _diag: () => diag.slice(),
    _whale: () => whale
  }
}
