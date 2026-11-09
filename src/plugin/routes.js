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
 * 不提供：读账本原文、删事件、改人格。那是 B 的红线。
 */

import { load as loadConfig, patch as patchConfig } from '../config.js'
import { render } from '../assemble/sections.js'

const PREFIX = '/water-source'

function json(res, code, body) {
  try {
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
 * 注册路由。
 * @param {object} webServer 宿主的 webServer（有 route / addRoute 都认）
 * @param {{ getWhale:()=>object|null, log:Function }} deps
 * @returns {() => void} 注销
 */
export function registerRoutes(webServer, deps) {
  if (!webServer) return () => {}
  const add = webServer.route ?? webServer.addRoute ?? webServer.get
  if (typeof add !== 'function') return () => {}

  const handler = async (req, res, next) => {
    const url = String(req.url ?? '')
    if (!url.startsWith(PREFIX)) { if (next) next(); return }
    const p = url.slice(PREFIX.length).split('?')[0] || '/'
    const whale = deps.getWhale()
    try {
      if (p === '/config' && req.method === 'GET') {
        const root = deps.root()
        return json(res, 200, { ok: true, config: loadConfig(root), editable: ['herName', 'ownerName', 'herSessionId', 'stripHostPrompt'] })
      }
      if (p === '/config' && req.method === 'POST') {
        const raw = await readBody(req)
        let body = {}
        try { body = JSON.parse(raw) } catch { return json(res, 400, { ok: false, why: '不是合法 JSON' }) }
        const r = patchConfig(deps.root(), body ?? {})
        if (!r.ok) return json(res, 400, { ok: false, why: r.why })
        deps.onConfigChanged?.(r.value)
        return json(res, 200, { ok: true, config: r.value })
      }
      if (p === '/state' && req.method === 'GET') {
        if (!whale?.db) return json(res, 503, { ok: false, why: '账本没打开' })
        const cfg = loadConfig(deps.root())
        const events = whale.read()
        const r = render(whale.db, { name: cfg.herName, ownerName: cfg.ownerName, room: cfg.herSessionId })
        return json(res, 200, {
          ok: true,
          version: deps.version(),
          events: events.length,
          byType: events.reduce((m, e) => { m[e.type] = (m[e.type] || 0) + 1; return m }, {}),
          budget: { used: r.used, total: 2400 },
          kept: r.kept,
          dropped: r.dropped,
          injected: r.text
        })
      }
      return json(res, 404, { ok: false, why: '没有这个路由' })
    } catch (err) {
      deps.log('路由失败 ' + p + '：' + String(err?.message ?? err).slice(0, 160))
      return json(res, 500, { ok: false, why: String(err?.message ?? err).slice(0, 200) })
    }
  }

  const off = add(handler)
  return typeof off === 'function' ? off : () => {}
}
