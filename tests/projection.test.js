/** projection.test.js —— 投影：弱化版与改写版，都不许带原文与 id */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildProjection, summarize, rewriteProjection } from '../src/derive/projection.js'

const model = {
  day: 9,
  stage: 2,
  stageName: '自主',
  name: '老张',
  topBeliefs: [
    { id: 'ev_ABC123', text: '我不喜欢在人多的地方讲话', ts: '2026-11-01T00:00:00.000Z', refs: 2 },
    { id: 'ev_DEF456', text: '我倾向于先做再说', ts: '2026-11-02T00:00:00.000Z', refs: 1 }
  ]
}

const fake = (content) => ({ chat: async () => ({ content }) })
const boom = { chat: async () => { throw new Error('boom') } }

// ---- 弱化版 ----

test('弱化版：不含事件 id', () => {
  const s = JSON.stringify(buildProjection(model))
  assert.ok(!s.includes('ev_'), s)
})

test('弱化版：保留阶段与称呼', () => {
  const p = buildProjection(model)
  assert.equal(p.stage, 2)
  assert.equal(p.name, '老张')
  assert.equal(p.rewritten, false)
})

test('弱化版：超长截断', () => {
  const p = buildProjection({ topBeliefs: [{ text: '字'.repeat(200) }] })
  assert.ok(p.beliefs[0].length <= 60)
})

test('summarize 去掉引用痕迹与换行', () => {
  const s = summarize('这条判断很重要\n（见 refs: ev_1, ev_2）')
  assert.ok(!s.includes('\n'))
  assert.ok(!s.includes('ev_1'))
})

// ---- 改写版 ----

test('改写版：合格改写 → rewritten:true，且不带原文', async () => {
  const p = await rewriteProjection(model, {
    llm: fake(JSON.stringify({ items: ['对人群场合持回避态度', '倾向先行动后思考'] }))
  })
  assert.equal(p.rewritten, true)
  assert.equal(p.beliefs.length, 2)
  const s = JSON.stringify(p)
  assert.ok(!s.includes('ev_'))
  assert.ok(!s.includes('人多的地方'), '改写过的东西里出现了原文')
})

test('改写版：模型复读 → 降级，不冒险出本机', async () => {
  const p = await rewriteProjection(model, {
    llm: fake(JSON.stringify({ items: ['我不喜欢在人多的地方讲话', '我倾向于先做再说'] }))
  })
  assert.equal(p.rewritten, false)
  assert.equal(p.degraded, 'too_similar')
})

test('改写版：模型失败 → 降级，不抛', async () => {
  const p = await rewriteProjection(model, { llm: boom })
  assert.equal(p.rewritten, false)
  assert.equal(p.degraded, 'llm_error')
})

test('改写版：没有 llm → 降级到弱化版', async () => {
  const p = await rewriteProjection(model, {})
  assert.equal(p.rewritten, false)
  assert.equal(p.degraded, 'no_llm')
})

test('改写版：空判断 → 直接返回，不调模型', async () => {
  let called = false
  const p = await rewriteProjection({ topBeliefs: [] }, { llm: { chat: async () => { called = true; return { content: '{}' } } } })
  assert.equal(called, false)
  assert.equal(p.rewritten, true)
  assert.deepEqual(p.beliefs, [])
})

test('改写版：返回非 JSON → 降级', async () => {
  const p = await rewriteProjection(model, { llm: fake('我觉得她挺内向的') })
  assert.equal(p.rewritten, false)
  assert.equal(p.degraded, 'empty_rewrite')
})
