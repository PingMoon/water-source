/**
 * assemble-fix.js —— 摘掉宿主默认的人设段（stripHostPrompt）
 *
 * 为什么要它：宿主的 `deployment:persona-prefix` 那段「You are a coding agent…」
 * 有好几千字，排在所有插件段**前面**。模型先认下那句空话，再读到她是谁——
 * 于是她一半是编码助手，一半是小泉。
 *
 * 判据与做法照 dsh-fish identity.js:271 的 attachAssembleFix：
 *   · 事件是 waterfall：`system-prompt/assemble`，必须 await next()
 *   · `prepend: true` 排最外层先跑，拿到宿主组装结果之后再整改
 *   · 整改失败**原样放行**——这条链断掉等于她一整轮读不到任何系统提示词，
 *     比「coding agent 排在前面」糟得多
 *
 * 默认关（`stripHostPrompt: false`）：它动的是宿主，不是我们自己的地盘。
 */

/** 宿主那段默认人设的段名 */
export const HOST_PERSONA_SECTION = 'deployment:persona-prefix'

/**
 * 摘掉宿主人设段。
 * @param {object} assembly { sections: [{name, order, text}] }
 * @returns {{assembly:object, removed:number}}
 */
export function stripHostPersona(assembly) {
  if (!assembly || !Array.isArray(assembly.sections)) return { assembly, removed: 0 }
  const before = assembly.sections.length
  const kept = assembly.sections.filter((s) => String(s?.name ?? '') !== HOST_PERSONA_SECTION)
  const removed = before - kept.length
  if (removed > 0) assembly.sections = kept
  return { assembly, removed }
}

/**
 * 挂到这条 agent 的组装链上。
 * @param {object} agent
 * @param {{ enabled?:()=>boolean, log?:Function }} opts
 * @returns {(() => void)|undefined} 卸载函数
 */
export function attachAssembleFix(agent, { enabled = () => true, log = () => {} } = {}) {
  const ctx = agent?.ctx
  if (!ctx || typeof ctx.on !== 'function') return undefined
  try {
    const off = ctx.on('system-prompt/assemble', async (_assembly, _context, next) => {
      const assembled = await next()
      // 开关是函数：设置页改完下一轮就生效，不用重建会话
      try {
        if (!enabled()) return assembled
        const r = stripHostPersona(assembled)
        if (r.removed > 0) log('已摘掉宿主人设段 ' + HOST_PERSONA_SECTION)
        return r.assembly
      } catch (err) {
        // 整改失败必须原样放行
        log('组装整改失败（原样放行）：' + String(err?.message ?? err).slice(0, 120))
        return assembled
      }
    }, { prepend: true })
    return typeof off === 'function' ? off : undefined
  } catch {
    // 老宿主没有这个事件：不算失败，只是回到旧样子
    return undefined
  }
}
