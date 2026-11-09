/**
 * assemble-fix.test.js —— stripHostPrompt
 *
 * 要守住三件事：
 *   1. 开关关着时一个字不动
 *   2. 开关开着时只摘宿主那段，别人（包括我们自己）的段一个不碰
 *   3. 整改失败必须原样放行——链断了她一整轮读不到任何系统提示词
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { stripHostPersona, attachAssembleFix, HOST_PERSONA_SECTION } from '../src/plugin/assemble-fix.js'

const asm = () => ({
  sections: [
    { name: 'deployment:persona-prefix', text: 'You are a coding agent…' },
    { name: 'harness:identity', text: 'harness stuff' },
    { name: 'water-source-memory', text: '## 你是谁\n你是小泉。' }
  ]
})

test('摘掉宿主那段，别人的一个不动', () => {
  const a = asm()
  const r = stripHostPersona(a)
  assert.equal(r.removed, 1)
  assert.equal(a.sections.length, 2)
  assert.ok(!a.sections.some(s => s.name === HOST_PERSONA_SECTION))
  assert.ok(a.sections.some(s => s.name === 'water-source-memory'))
  assert.ok(a.sections.some(s => s.name === 'harness:identity'))
})

test('没有那段时什么都不做', () => {
  const a = { sections: [{ name: 'x', text: 'y' }] }
  const r = stripHostPersona(a)
  assert.equal(r.removed, 0)
  assert.equal(a.sections.length, 1)
})

test('形状不对时原样返回，不崩', () => {
  for (const bad of [null, {}, { sections: 'x' }]) {
    const r = stripHostPersona(bad)
    assert.equal(r.removed, 0)
  }
})

/** 模拟宿主的 waterfall：handler(assembly, context, next) → Promise */
function makeCtx() {
  const handlers = []
  return {
    on: (ev, fn, opts) => { if (ev === 'system-prompt/assemble') handlers.push({ fn, opts }); return () => {} },
    async run(assembly) {
      let cur = assembly
      for (const h of handlers) {
        cur = await h.fn(cur, {}, async () => cur)
      }
      return cur
    },
    handlers
  }
}

test('开关关着：原样放行', async () => {
  const ctx = makeCtx()
  attachAssembleFix({ ctx }, { enabled: () => false })
  const out = await ctx.run(asm())
  assert.equal(out.sections.length, 3, '关着就不该动')
})

test('开关开着：摘掉', async () => {
  const ctx = makeCtx()
  attachAssembleFix({ ctx }, { enabled: () => true })
  const out = await ctx.run(asm())
  assert.equal(out.sections.length, 2)
})

test('挂的是 prepend（先拿宿主结果再整改）', () => {
  const ctx = makeCtx()
  attachAssembleFix({ ctx }, { enabled: () => true })
  assert.equal(ctx.handlers[0].opts?.prepend, true)
})

test('宿主没这个事件时返回 undefined，不算失败', () => {
  const off = attachAssembleFix({ ctx: {} }, {})
  assert.equal(off, undefined)
})
