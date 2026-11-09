/**
 * caller.js —— 认「谁在调这个工具」
 *
 * 为什么要有：同一个工具，她自己在调、和宿主/别的 agent 在调，写下去的东西
 * 性质完全不同。我们早定过「只有她能写第一人称的话」，但实现里漏了认证：
 * person 是**参数**，不是**身份**——参数可以填，身份不能填。
 *
 * 真机形态（照 dsh-fish v0.9.3 lib/tenant.js 的 callerOf 抄的判据）：
 *   exec.agent.session    会话对象
 *   session.id            会话 id
 *   session.header.cwd    工作目录
 *
 * 区别是我们现在还没有「她的会话」这个概念（她还没有自己的 agent），
 * 所以这里只提供一个可判的身份，不替任何人做主。
 */

/** @returns {{sessionId:string, cwd:string, sandbox:string}} */
export function callerOf(exec) {
  const session = exec?.agent?.session ?? exec?.session ?? null
  const id = session?.id ?? session?.header?.id ?? ''
  const cwd = session?.header?.cwd ?? session?.cwd ?? ''
  return {
    sessionId: id ? String(id) : '',
    cwd: cwd ? String(cwd) : '',
    sandbox: String(session?.header?.sandbox ?? '')
  }
}

/**
 * 这次调用是不是「她自己」在调。
 *
 * 判据只看会话 id 是否等于登记在册的她的会话。没有登记 = 不是她。
 * 不按 cwd 判——cwd 是宿主给的，会随工作区变；会话 id 才是稳定的身份。
 *
 * @param {object} exec 宿主传的工具上下文
 * @param {string} herSessionId 她的会话 id（没配置就是空）
 */
export function isHer(exec, herSessionId) {
  const { sessionId } = callerOf(exec)
  const her = String(herSessionId ?? '')
  return Boolean(her) && sessionId === her
}
