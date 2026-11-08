import { test } from 'node:test'
import assert from 'node:assert/strict'
import { orderMaterials } from '../src/consolidate/sequencing.js'

const m = (id, ts, ) => ({ id, type: 'worker_material', content: id, ts: new Date(ts).toISOString() })
const D = (s) => Date.parse('2026-11-01T00:00:00Z') + s * 86400000

test('新材料优先于已被引用过的', () => {
  const list = [m('ev_a', D(0)), m('ev_b', D(1))]
  const out = orderMaterials(list, { referenced: new Set(['ev_b']) })
  assert.deepEqual(out.map((x) => x.event.id), ['ev_a', 'ev_b'])
  assert.equal(out[1].used, true)
})

test('同条件下新的在前', () => {
  const list = [m('ev_old', D(0)), m('ev_new', D(5))]
  const out = orderMaterials(list, {})
  assert.deepEqual(out.map((x) => x.event.id), ['ev_new', 'ev_old'])
})

test('稳定排序：同一条永远在同一位置', () => {
  const list = [m('ev_x', D(1)), m('ev_y', D(1)), m('ev_z', D(1))]
  const a = orderMaterials(list, {})
  const b = orderMaterials(list, {})
  assert.deepEqual(a.map((x) => x.event.id), b.map((x) => x.event.id))
})

test('limit 生效', () => {
  const list = Array.from({ length: 10 }, (_, i) => m('ev_' + i, D(i)))
  assert.equal(orderMaterials(list, { limit: 3 }).length, 3)
})

test('不改输入', () => {
  const list = [m('ev_a', D(0)), m('ev_b', D(1))]
  const before = JSON.stringify(list)
  orderMaterials(list, {})
  assert.equal(JSON.stringify(list), before)
})
