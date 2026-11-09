/**
 * routes.js —— 设置页的 JSON API
 *
 * 为什么是设置页而不是独立 HTML：
 *   宿主 connection 的信任栅栏要 App 内的登录 cookie，浏览器直接开 /water-source
 *   会 401。而在 App 内部（设置页里）同源 fetch 这些路由是通的。
 *   —— 这条是 dsh-fish 踩出来的经验，直接照做。
 *
 * 只暴露三组：
 *   GET  /water-source/state   她现在读到什么（装配结果 + 账本计数）
 *   GET  /water-source/config  当前配置
 *   POST /water-source/config  改配置（白名单校验，改完立即生效）
 *
 * 不提供：读账本原文、删事件、改人格。那是红线。
 *
 * ⚠ 注册那一段在 index.js 里内联做（带逐步诊断）：宿主 register 的调用形状
 *   太容易猜错，而且猜错**静默**——插件照常启动、日志照打，请求一律 404。
 *   把「造 handler」和「注册」分开，猜错时至少还能确定是哪一半。
 */

import fs from 'node:fs'
import { load as loadConfig, patch as patchConfig } from '../config.js'
import { render } from '../assemble/sections.js'

export const PREFIX = '/water-source'

function json(res, code, body) {
  try {
    if (res.writableEnded) return
    res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(JSON.stringify(body))
  } catch { /* 连接断了就算了 */ }
}

async function readBody(req, limit = 64 * 1024) {
  return await new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (c) => {
      size += c.length
      if (size > limit) { reject(new Error('请求体太大')); req.destroy(); return }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

/**
 * 只造 handler，不碰注册。
 * @param {{ root:()=>string, getWhale:()=>object|null, version:()=>string, onConfigChanged?:Function, log:Function }} deps
 * @returns {(req:object, res:object) => Promise<void>}
 */
export function createRoutesHandler(deps) {
  const log = deps.log ?? (() => {})

  return async function handler(req, res) {
    const url = String(req.url ?? '')
    let p = url.startsWith(PREFIX) ? (url.slice(PREFIX.length).split('?')[0] || '/') : url.split('?')[0]
    if (p === '' || p === '/') p = '/state'

    const whale = deps.getWhale()
    try {
      if (p === '/config' && req.method === 'GET') {
        return json(res, 200, {
          ok: true,
          config: loadConfig(deps.root()),
          editable: ['herName', 'ownerName', 'herSessionId', 'stripHostPrompt']
        })
      }
      if (p === '/config' && req.method === 'POST') {
        const raw = await readBody(req)
        let body = {}
        try { body = JSON.parse(raw) } catch { return json(res, 400, { ok: false, why: '不是合法 JSON' }) }
        const r = patchConfig(deps.root(), body ?? {})
        if (!r.ok) return json(res, 400, { ok: false, why: r.why })
        try { deps.onConfigChanged?.(r.value) } catch { /* ignore */ }
        return json(res, 200, { ok: true, config: r.value })
      }
      if (p === '/state' && req.method === 'GET') {
        if (!whale?.db) return json(res, 503, { ok: false, why: '账本没打开' })
        const cfg = loadConfig(deps.root())
        const events = whale.read()
        const r = render(whale.db, { name: cfg.herName, ownerName: cfg.ownerName, room: cfg.herSessionId })
        return json(res, 200, {
          ok: true,
          version: deps.version?.() ?? '',
          events: events.length,
          byType: events.reduce((m, e) => { m[e.type] = (m[e.type] || 0) + 1; return m }, {}),
          budget: { used: r.used, total: 2400 },
          kept: r.kept,
          dropped: r.dropped,
          injected: r.text
        })
      }
      // ---- 记忆页：只读 ----
      if (p === '/memory' && req.method === 'GET') {
        if (!whale?.db) return json(res, 503, { ok: false, why: '账本没打开' })
        const all = whale.read({ includeForgotten: true })
        const visible = whale.read()
        const byType = {}
        for (const e of visible) byType[e.type] = (byType[e.type] || 0) + 1
        const her = all.filter((e) => e.type === 'utterance' && e.person === 'first').slice(-30).reverse()
        const owner = all.filter((e) => e.type === 'utterance' && e.person === 'third').slice(-30).reverse()
        const forgottenIds = new Set(all.filter((e) => e.type === 'tombstone').map((e) => e.refs?.[0]).filter(Boolean))
        const forgotten = all.filter((e) => forgottenIds.has(e.id)).map((e) => ({ id: e.id, type: e.type, content: String(e.content ?? '').slice(0, 200), ts: e.ts }))
        return json(res, 200, {
          ok: true,
          total: all.length,
          visible: visible.length,
          byType,
          her: her.map((e) => ({ content: e.content, ts: e.ts })),
          owner: owner.map((e) => ({ content: e.content, ts: e.ts })),
          forgotten
        })
      }
      // ---- 住所页：数据在哪 ----
      if (p === '/home' && req.method === 'GET') {
        const root = deps.root()
        const cfg = loadConfig(root)
        const size = (f) => { try { return fs.statSync(f).size } catch { return 0 } }
        return json(res, 200, {
          ok: true,
          root,
          db: { path: root + '/ledger.db', bytes: size(root + '/ledger.db'), walBytes: size(root + '/ledger.db-wal') },
          config: cfg,
          preset: 'lily'
        })
      }
      // ---- 插件页：版本与路由 ----
      if (p === '/plugin' && req.method === 'GET') {
        return json(res, 200, {
          ok: true,
          version: deps.version?.() ?? '',
          routes: ['/water-source/state', '/water-source/config', '/water-source/memory', '/water-source/home', '/water-source/plugin'],
          preset: 'lily',
          note: 'stripHostPrompt 已退休：preset 里 persona 的 prefix 已经是她了'
        })
      }
      return json(res, 404, { ok: false, why: '没有这个路由：' + p })
    } catch (err) {
      log('路由失败 ' + p + '：' + String(err?.message ?? err).slice(0, 160))
      return json(res, 500, { ok: false, why: String(err?.message ?? err).slice(0, 200) })
    }
  }
}

/**
 * 兼容旧调用：造 handler + 注册。
 * 注册形状照 dsh-host-webserver 的 register(route)：
 *   { kind: 'prefix' | 'exact', path, handler }，handler 是 Node 原生 (req, res)。
 */
export function registerRoutes(webServer, deps) {
  if (!webServer || typeof webServer.register !== 'function') return () => {}
  const handler = createRoutesHandler(deps)
  let off
  try {
    off = webServer.register({ kind: 'prefix', path: PREFIX, handler })
  } catch (err) {
    deps.log?.('路由注册失败：' + String(err?.message ?? err).slice(0, 160))
    return () => {}
  }
  return typeof off === 'function' ? off : () => {}
}
