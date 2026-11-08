/**
 * ingest.js —— 把 DSH 会话里真人说的话接到 whale 的 ingest
 *
 * 来源判定照 dsh-fish v0.9.3 lib/turns.js 的 classifyMessage（MIT）。
 * 那张表是**黑名单不是白名单**——宿主的 source.kind 是开放集合，
 * 外渠道（qq / 别的桥）会自己起名，穷举不了。表里没有的一律当人。
 *
 * 铁律：这里基本只读会话事件，只调 whale.ingest；任何失败都吞掉——
 * 记账出错不能连累她说话。
 *
 * PORT-MANIFEST：B 层 · 借 classifyMessage / messageText 的判据，实现自写
 */

/** 宿主/插件自己拼的、确定不是人打的 source.kind */
export const MACHINE_KINDS = new Set([
  'runtime-context',
  'skill-catalog',
  'schedule',
  'system',
  'system-prompt',
  'tool',
  'plugin',
  'assistant'
])

/** 宿主拼的上下文按 source.form 再挡一层 */
export const MACHINE_FORMS = new Set(['snapshot', 'notice', 'catalog', 'instructions', 'recall'])

/** 我们自己 prompt 进去的消息，rpcId 带这些前缀 */
export const PLUGIN_RPC = /^(wake|say|boot|report|letter|sleep|nudge|probe|turn|sys|carry)[-_]/i

/**
 * @returns {'human'|'plugin'|'context'}
 */
export function classifyMessage(data) {
  const src = data?.source
  if (!src || typeof src !== 'object') return 'context'
  const kind = String(src.kind ?? '')
  if (!kind) return 'context'
  if (MACHINE_KINDS.has(kind) || kind.startsWith('plugin:')) return 'context'
  if (MACHINE_FORMS.has(src.form)) return 'context'
  const rid = String(src.rpcId ?? '')
  if (rid && PLUGIN_RPC.test(rid)) return 'plugin'
  if (kind === 'user') {
    // 客户端打的字一定带时区；没有的分不清是老客户端还是别的插件灌的
    return src.clientTimeZone ? 'human' : 'context'
  }
  return 'human'
}

/** 真机形态：{ role:'user', content:[{type:'text',text:'…'}], source:{…} }；老宿主可能只给 text */
export function messageText(data) {
  if (!data || typeof data !== 'object') return ''
  if (typeof data.text === 'string' && data.text.trim()) return data.text
  const c = data.content
  if (typeof c === 'string') return c
  if (Array.isArray(c)) {
    const parts = []
    for (const p of c) {
      if (!p) continue
      if (typeof p === 'string') parts.push(p)
      else if (typeof p.text === 'string' && (!p.type || p.type === 'text')) parts.push(p.text)
    }
    if (parts.length) return parts.join('\n')
  }
  if (typeof data.message?.content === 'string') return data.message.content
  return ''
}

/** 房间键：优先会话 id，退到 cwd，最后 'local' */
export function roomOf(session) {
  const id = session?.id ?? session?.sessionId ?? session?.key
  if (typeof id === 'string' && id) return id
  const cwd = session?.cwd ?? session?.workspace?.path
  if (typeof cwd === 'string' && cwd) return cwd
  return 'local'
}

/**
 * 挂上观察者。
 * @param {object} ctx 宿主 ctx（要有 on）
 * @param {{ whale: object, log?: Function }} deps
 * @returns {() => void} 注销函数
 */
export function registerIngest(ctx, deps = {}) {
  const whale = deps.whale
  const log = deps.log ?? (() => {})
  if (typeof ctx?.on !== 'function' || !whale) return () => {}
  const off = ctx.on('session/event', (session, event) => {
    try {
      if (String(event?.type ?? '') !== 'user/message') return
      const data = event?.data ?? event?.message ?? event
      if (classifyMessage(data) !== 'human') return
      const text = messageText(data)
      if (!text.trim()) return
      const r = whale.ingest(text, { room: roomOf(session) })
      if (r.decision === 'drop') log('[whale] 丢了一条：' + r.why)
    } catch (err) {
      // 吞掉：记账出错不能连累她说话
      log('[whale] ingest 失败：' + String(err?.message ?? err).slice(0, 120))
    }
  })
  return typeof off === 'function' ? off : () => {}
}
