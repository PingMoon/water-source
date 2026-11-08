/** write-gate.test.js —— 三条否决判据的验收 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decide, ACTION, VETO, similarity, polarity } from '../src/ledger/write-gate.js'

test('证据不足：refs 为空直接拒', () => {
  const r = decide({ content: '我今天想明白了' }, {})
  assert.equal(r.action, ACTION.REJECT)
  assert.equal(r.reasonCode, VETO.INSUFFICIENT_EVIDENCE)
})

test('证据不足：refs 指向不存在的事件', () => {
  const r = decide(
    { content: 'x', refs: ['ev_MISSING'] },
    { knownIds: new Set(['ev_OK']) }
  )
  assert.equal(r.reasonCode, VETO.INSUFFICIENT_EVIDENCE)
  assert.deepEqual(r.detail.missing, ['ev_MISSING'])
})

test('越界：ticket 对不上', () => {
  const r = decide(
    { content: 'x', refs: ['ev_1'], meta: { ticketId: 't-2' } },
    { knownIds: new Set(['ev_1']), ticket: { id: 't-1' } }
  )
  assert.equal(r.reasonCode, VETO.OUT_OF_SCOPE)
})

test('冲突：同一件事、极性相反，没有回应 → 拒', () => {
  const r = decide(
    { content: '我应该早点睡', refs: ['ev_1'] },
    { knownIds: new Set(['ev_1']), beliefs: [{ id: 'b1', text: '我不应该早点睡' }] }
  )
  assert.equal(r.reasonCode, VETO.CONFLICT_UNRESOLVED)
  assert.ok(r.detail.sim >= 0.5)
})

test('冲突：带回应标记则放行', () => {
  const r = decide(
    { content: '我应该早点睡', refs: ['ev_1'], meta: { resolvesRef: true } },
    { knownIds: new Set(['ev_1']), beliefs: [{ id: 'b1', text: '我不应该早点睡' }] }
  )
  assert.equal(r.action, ACTION.ACCEPT)
})

test('正常：有证据、不越界、不冲突 → 接受', () => {
  const r = decide(
    { content: 'JEV 不适合做长链决策', refs: ['ev_1', 'ev_2'], meta: { ticketId: 't-1' } },
    { knownIds: new Set(['ev_1', 'ev_2']), ticket: { id: 't-1' }, beliefs: [{ id: 'b1', text: '今天天气不错' }] }
  )
  assert.equal(r.action, ACTION.ACCEPT)
})

test('极性判定挖掉词素：别人 / 别的 不算否定', () => {
  assert.equal(polarity('我觉得应该让别人高兴'), 1)
  assert.equal(polarity('我不觉得应该让别人高兴'), -1)
})

test('相似度：同一件事换几个字仍然高', () => {
  const s = similarity('我应该早点睡觉', '我不应该早点睡觉')
  assert.ok(s >= 0.5, '实际 ' + s)
})
