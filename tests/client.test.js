/**
 * client.test.js —— 设置页的静态契约
 *
 * 浏览器那半边跑不进 node（要 window.__ModuleLoader__），
 * 但有两件事**必须对齐**，对不齐就会静默挂不上——这比崩还难查：
 *   1. loader id 必须等于 package.json 的 name
 *   2. inject 必须含 slots
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const src = readFileSync(new URL('../src/plugin/client.js', import.meta.url), 'utf8')

test('client.js 必须是合法 JS（2026-11-09 崩过一次，整个 App 起不来）', () => {
  // 浏览器那半边解析失败不会只白屏——宿主启动阶段崩掉。
  // 真机事故：把 '#c0392b' 批替换成 var(--x, #c0392b)，引号没了，Unexpected token 'var'。
  assert.doesNotThrow(() => new Function(src), 'client.js 有语法错误')
})

test('loader id 等于包名（对不齐浏览器那半边会静默不加载）', () => {
  const m = src.match(/id:\s*'([^']+)'/)
  assert.ok(m, '没找到 id')
  assert.equal(m[1], pkg.name)
})

test('package.json 声明了 client 与 exports', () => {
  assert.equal(pkg.exports['./client'], './src/plugin/client.js')
  assert.equal(pkg.dsh.client.platform, 'web')
  assert.ok(Array.isArray(pkg.dsh.client.inject))
})

test('客户端 inject 含 slots，并注册 settings.section', () => {
  assert.ok(/inject = \['slots'\]/.test(src))
  assert.ok(src.includes("'settings.section'"))
  assert.ok(src.includes('ctx.slots.register'))
})

test('设置页里没有任何「改性格」的输入框', () => {
  // 红线：人格只能从事件里长出来，不能被配置出来。
  // 只查**代码与文案**，不查注释——注释里说「这里不写性格」是说明，不是控件。
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
  const forbidden = ['性格', 'personality', '人格设定', '你是一个']
  for (const f of forbidden) {
    assert.ok(!code.includes(f), '设置页里不该出现：' + f)
  }
})
