import { test } from 'node:test'
import assert from 'node:assert/strict'
import { makeMeaning, parseDrafts } from '../src/consolidate/meaning.js'

const known = new Set(['ev_1', 'ev_2'])
const fake = (content) => ({ chat: async () => ({ content }) })

test('正常解析：一条带 refs 的草稿', async () => {
  const { drafts, dropped } = await makeMeaning(
    [{ event: { id: 'ev_1', content: 'JEV 序列决策弱' } }],
    { llm: fake('[{"meaning":"JEV 不适合做长链决策","refs":["ev_1"]}]') }
  )
  assert.equal(drafts.length, 1)
  assert.equal(dropped.length, 0)
  assert.deepEqual(drafts[0].refs, ['ev_1'])
})

test('代码块包裹也能抠出来', () => {
  const { drafts } = parseDrafts('好的：\n```json\n[{"meaning":"x","refs":["ev_1"]}]\n```', known)
  assert.equal(drafts.length, 1)
})

test('编造的 refs 一律丢弃，不纠正', () => {
  const { drafts, dropped } = parseDrafts('[{"meaning":"x","refs":["ev_FAKE"]}]', known)
  assert.equal(drafts.length, 0)
  assert.equal(dropped[0].why, 'unknown_refs')
})

test('没有 refs 的草稿丢弃', () => {
  const { drafts, dropped } = parseDrafts('[{"meaning":"x","refs":[]}]', known)
  assert.equal(drafts.length, 0)
  assert.equal(dropped[0].why, 'no_refs')
})

test('非 JSON 返回空，不编造', () => {
  const { drafts, dropped } = parseDrafts('我觉得这件事挺重要的', known)
  assert.equal(drafts.length, 0)
  assert.equal(dropped[0].why, 'not_json')
})

test('复读检测：meaning 与材料几乎一样 → 判为没消化', async () => {
  const material = 'JEV 在 ALFWorld 序列决策基准上只有 35% 正确率，还会重复无效动作'
  const { drafts, dropped } = await makeMeaning(
    [{ event: { id: 'ev_1', content: material } }],
    { llm: fake(JSON.stringify([{ meaning: material, refs: ['ev_1'] }])) }
  )
  assert.equal(drafts.length, 0, '复读没有被拦下')
  assert.equal(dropped[0].why, 'duplicated_source')
  assert.ok(dropped[0].sim >= 0.85)
})

test('真改写能通过复读检测', async () => {
  const material = 'JEV 在 ALFWorld 序列决策基准上只有 35% 正确率'
  const { drafts } = await makeMeaning(
    [{ event: { id: 'ev_1', content: material } }],
    { llm: fake(JSON.stringify([{ meaning: '我不敢拿它去做要连着做决定的事', refs: ['ev_1'] }])) }
  )
  assert.equal(drafts.length, 1)
})

test('空材料不发请求', async () => {
  let called = false
  const llm = { chat: async () => { called = true; return { content: '[]' } } }
  const r = await makeMeaning([], { llm })
  assert.equal(called, false)
  assert.deepEqual(r, { drafts: [], dropped: [] })
})
