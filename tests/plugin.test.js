/**
 * plugin.test.js —— 插件接线的验收（用假 ctx，不启动 DSH）
 *
 * 验的是「装得进去、挂得对、停得干净」，不是「DSH 里表现好不好」。
 * 后者要真跑，骗不了。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { apply, name, inject, VERSION } from '../src/plugin/index.js'

function fakeCtx() {
  const state = {
    tools: [],
    listeners: {},
    sections: [],
    disposers: 0,
    logs: []
  }
  const ctx = {
    tools: { register: (t) => { state.tools.push(t); return () => { state.disposers++ } } },
    on: (ev, fn) => { state.listeners[ev] = fn },
    agents: { list: () => [] },
    logger: { info: (m) => state.logs.push(m), warn: (m) => state.logs.push(m) },
    effect: (fn) => { state.shutdown = fn }
  }
  return { ctx, state }
}

function fakeAgent(sections) {
  return {
    ctx: {
      systemPrompt: {
        context: (spec) => { sections.push(spec); return () => { /* noop */ } }
      }
    }
  }
}

test('导出契约：name / inject 是数组 / VERSION', () => {
  assert.equal(name, 'water-source')
  assert.ok(Array.isArray(inject), 'inject 必须是数组——写成对象会后者覆盖前者，服务静默缺失')
  assert.ok(inject.includes('tools'))
  assert.equal(inject.includes('systemPrompt'), false, 'systemPrompt 不该进 inject——缺了会把整个插件拖下水')
  assert.match(VERSION, /^\d+\.\d+\.\d+$/)
})

test('apply 能在没有 agent 的情况下完成初始化（不崩）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'whale-pl-'))
  try {
    const { ctx, state } = fakeCtx()
    const plugin = apply(ctx, { root: dir, tools: ['fs.read', 'fs.write', 'shell.run'], templateId: 'tp-default' })
    assert.ok(state.tools.length === 1, '应该注册 1 个工具')
    assert.equal(state.tools[0].name, 'remember')
    assert.ok(state.tools[0].parameters.type === 'object', 'parameters 必须是标准 JSON Schema')
    assert.equal(plugin.dispose instanceof Function, true)
    plugin.dispose()
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('remember 工具真的写进账本', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'whale-pl2-'))
  try {
    const { ctx, state } = fakeCtx()
    const plugin = apply(ctx, { root: dir, tools: ['fs.read', 'fs.write', 'shell.run'], templateId: 'tp-default' })
    const tool = state.tools[0]
    const r = await tool.execute({ text: '我不太能吃辣' })
    assert.deepEqual(r, { ok: true })
    const w = plugin._whale()
    const events = w.read({ types: ['utterance'] })
    assert.equal(events.length, 1)
    assert.equal(events[0].person, 'first')
    assert.equal(events[0].source, 'tool')
    plugin.dispose()
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('agent 创建后挂上 systemPrompt.context；有记忆时出内容，停用后空', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'whale-pl3-'))
  const sections = []
  try {
    const { ctx, state } = fakeCtx()
    const plugin = apply(ctx, { root: dir, tools: ['fs.read', 'fs.write', 'shell.run'], templateId: 'tp-default' })

    // 没有 agent 时，先不挂
    assert.equal(sections.length, 0)

    // 模拟 agent 创建
    state.listeners['agent/created']({ agent: fakeAgent(sections) })
    assert.equal(sections.length, 1, 'agent 创建后应该挂上 context')
    assert.equal(sections[0].name, 'water-source-memory')
    assert.equal(sections[0].interpolate, false, '必须是纯文本，不许被当模板解析')

    // 空记忆 → 空串
    assert.equal(sections[0].text(), '')

    // 写一条 meaning → 出现
    const w = plugin._whale()
    const base = w.append({ type: 'worker_material', content: 'JEV 在序列决策上只有 35%' })
    w.append({ type: 'meaning', content: '我不敢拿它去做长链决策', refs: [base.id] })
    const out = sections[0].text()
    assert.ok(out.includes('你记得的事'))
    assert.ok(out.includes('我不敢拿它去做长链决策'))

    plugin.dispose()
    assert.equal(sections[0].text(), '', '停用后不该再注入')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('打包清单：package.json 与 cordis.patch.yml 对得上', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(pkg.name, '@local/water-source')
  assert.equal(pkg.main, 'src/plugin/index.js')
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(pkg.type, 'module')
  const patch = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
  assert.ok(patch.includes('id: water-source'))
  assert.ok(patch.includes("@local/water-source"))
})
