/** derive.test.js —— 派生是纯函数，且只算算得出来的东西 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { derive, foldLine, DAY_MS, STAGE_NAMES } from '../src/derive/derive.js'

const T0 = Date.parse('2026-11-01T00:00:00.000Z')

function ev(id, type, content, tsOffsetDays, refs = []) {
  return { id, type, content, ts: new Date(T0 + tsOffsetDays * DAY_MS).toISOString(), refs, person: type === 'meaning' ? 'first' : 'third' }
}

test('空事件流：第 1 天，阶段 1', () => {
  const m = derive([], { now: T0 })
  assert.equal(m.day, 1)
  assert.equal(m.stage, 1)
  assert.equal(m.topBeliefs.length, 0)
})

test('天数与阶段：8 天前播种 → 第 9 天、阶段 2', () => {
  const m = derive([ev('ev_1', 'seed', '你刚开始存在', -8)], { now: T0 })
  assert.equal(m.day, 9)
  assert.equal(m.stage, 2)
  assert.equal(m.stageName, STAGE_NAMES[1])
})

test('显著性：被引用更多的排在前面', () => {
  const events = [
    ev('ev_a', 'seed', '起点', -1),
    ev('ev_1', 'meaning', '第一条判断', -5, ['ev_a']),
    ev('ev_2', 'meaning', '被反复引用的判断', -5, ['ev_a']),
    ev('ev_x', 'worker_material', '材料甲', -4),
    ev('ev_m1', 'meaning', '引用第二条的判断', -2, ['ev_2']),
    ev('ev_m2', 'meaning', '又引用第二条', -1, ['ev_2'])
  ]
  const m = derive(events, { now: T0 })
  assert.equal(m.beliefs[0].text, '被反复引用的判断')
  assert.ok(m.beliefs[0].refs >= 2)
})

test('遗忘：被 tombstone 的不出现，但总数还在', () => {
  const events = [ev('ev_1', 'seed', '起点', -2), ev('ev_2', 'meaning', '这条要忘掉', -1, ['ev_1'])]
  const m = derive(events, { now: T0, forgotten: new Set(['ev_2']) })
  assert.equal(m.beliefs.length, 0)
  assert.equal(m.counts.events, 1)
})

test('称呼：从「叫你 X」里取，取不到就空着不瞎猜', () => {
  const a = derive([ev('ev_1', 'utterance', '以后叫你老张吧', 0)], { now: T0 })
  assert.equal(a.name, '老张')
  const b = derive([ev('ev_1', 'utterance', '今天天气不错', 0)], { now: T0 })
  assert.equal(b.name, '')
})

test('纯函数：相同输入 + 相同 now 必得相同输出', () => {
  const events = [ev('ev_1', 'seed', '起点', -3), ev('ev_2', 'meaning', '一条判断', -1, ['ev_1'])]
  const a = derive(events, { now: T0 })
  const b = derive(events, { now: T0 })
  assert.deepEqual(a, b)
})

test('折叠：更早的判断压成一行，不删除', () => {
  const folded = [{ text: 'A' }, { text: 'B' }, { text: 'C' }, { text: 'D' }]
  const line = foldLine(folded)
  assert.ok(line.includes('A'))
  assert.ok(line.includes('还有 1 条更早的'))
})
