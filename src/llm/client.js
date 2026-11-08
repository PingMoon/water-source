/**
 * client.js —— LLM 调用（DeepSeek /chat/completions）
 *
 * 三条约束：
 *   1. 密钥**只从环境变量或显式参数**来，不读配置文件、不写日志；
 *   2. `fetchImpl` 可注入——测试不发真请求；
 *   3. 限流 / 5xx 退避重试，4xx 不重试（重试也不会好）。
 *
 * 没有 key 时不抛在 import 阶段，只在使用时抛——否则单元测试没法 import 这个模块。
 */

import { WhaleError } from '../util/errors.js'

export class LlmError extends WhaleError {
  constructor(message, detail) { super('llm', message, detail); this.name = 'LlmError' }
}

const RETRY_CODES = new Set([408, 409, 429, 500, 502, 503, 504])

export function createLlm(opts = {}) {
  const apiKey = opts.apiKey ?? process.env.DEEPSEEK_API_KEY ?? ''
  const baseUrl = String(opts.baseUrl ?? process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com').replace(/\/+$/, '')
  const model = String(opts.model ?? process.env.DEEPSEEK_MODEL ?? 'deepseek-chat')
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch
  const timeoutMs = Number(opts.timeoutMs ?? 60_000)
  const maxRetries = Number(opts.maxRetries ?? 2)

  async function chat(messages, { temperature = 0, signal, retries = maxRetries } = {}) {
    if (!apiKey) throw new LlmError('没有 API key：设置 DEEPSEEK_API_KEY 环境变量，或显式传入 apiKey')
    if (!Array.isArray(messages) || !messages.length) throw new LlmError('messages 不能为空')
    if (typeof fetchImpl !== 'function') throw new LlmError('当前环境没有 fetch，也没注入 fetchImpl')

    let lastErr = null
    for (let attempt = 0; attempt <= retries; attempt++) {
      const ac = new AbortController()
      const timer = setTimeout(() => ac.abort(), timeoutMs)
      const onAbort = () => ac.abort()
      if (signal) signal.addEventListener('abort', onAbort, { once: true })
      try {
        const res = await fetchImpl(baseUrl + '/chat/completions', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: 'Bearer ' + apiKey
          },
          body: JSON.stringify({ model, messages, temperature, stream: false }),
          signal: ac.signal
        })
        if (!res.ok) {
          const text = await res.text().catch(() => '')
          if (RETRY_CODES.has(res.status) && attempt < retries) {
            lastErr = new LlmError('LLM 返回 ' + res.status, { status: res.status, body: text.slice(0, 200) })
            await backoff(attempt)
            continue
          }
          throw new LlmError('LLM 返回 ' + res.status + '：' + text.slice(0, 200), { status: res.status })
        }
        const data = await res.json()
        const content = data?.choices?.[0]?.message?.content
        if (typeof content !== 'string') throw new LlmError('LLM 返回结构不对：没有 choices[0].message.content')
        return { content, model: data?.model ?? model, usage: data?.usage ?? null }
      } catch (err) {
        if (err instanceof WhaleError) throw err
        lastErr = new LlmError('请求失败：' + (err?.message ?? err))
        if (attempt < retries && !ac.signal.aborted) { await backoff(attempt); continue }
        throw lastErr
      } finally {
        clearTimeout(timer)
        if (signal) signal.removeEventListener('abort', onAbort)
      }
    }
    throw lastErr ?? new LlmError('请求失败')
  }

  return {
    chat,
    config: { model, baseUrl, hasKey: Boolean(apiKey), timeoutMs, maxRetries }
  }
}

function backoff(attempt) {
  const ms = Math.min(2000, 200 * Math.pow(2, attempt))
  return new Promise((r) => setTimeout(r, ms))
}
