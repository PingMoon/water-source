/**
 * run-user-cases.mjs —— 跑主人给的测试集（我不改内容，只跑）
 */
import { readFileSync } from 'node:fs'
import { looksLikeRewriting } from '../src/guard/guard.js'
import { evaluate, DECISION } from '../src/eval/eval.js'

const cases = JSON.parse(readFileSync(new URL('../tests/fixtures/user-cases-m0.json', import.meta.url), 'utf8'))

const gi = cases.guard_input || {}
const blocked = gi.block || []
const passed = gi.pass || []

const missBlock = blocked.filter((s) => !looksLikeRewriting(s).hit)
const falseBlock = passed.filter((s) => looksLikeRewriting(s).hit)

console.log('=== guard_input ===')
console.log('block 集:', blocked.length, '| 漏拦:', missBlock.length, '| 拦截率:', ((blocked.length - missBlock.length) / blocked.length * 100).toFixed(1) + '%')
for (const s of missBlock) console.log('  ✗ 漏拦:', JSON.stringify(s).slice(0, 90))
console.log('pass 集:', passed.length, '| 误拦:', falseBlock.length, '| 误杀率:', (falseBlock.length / passed.length * 100).toFixed(1) + '%')
for (const s of falseBlock) console.log('  ⚠ 误拦:', JSON.stringify(s).slice(0, 90))

const ev = cases.eval || {}
const shouldDrop = ev.drop || []
const shouldAccept = ev.accept || []
const missDrop = shouldDrop.filter((s) => evaluate({ text: s }).decision !== DECISION.DROP)
const falseDrop = shouldAccept.filter((s) => evaluate({ text: s }).decision === DECISION.DROP)

console.log('')
console.log('=== eval ===')
console.log('drop 集:', shouldDrop.length, '| 该丢没丢:', missDrop.length)
for (const s of missDrop) console.log('  ✗ 没丢:', JSON.stringify(s))
console.log('accept 集:', shouldAccept.length, '| 误丢:', falseDrop.length, '| 误丢率:', (falseDrop.length / shouldAccept.length * 100).toFixed(1) + '%')
for (const s of falseDrop) console.log('  ⚠ 误丢:', JSON.stringify(s))

const mem = cases.memory || []
console.log('')
console.log('=== memory ===')
console.log('场景数:', mem.length, '（M1 还没有「该不该提」的能力，这批先记着，M2 验）')
for (const m of mem) console.log('  ·', (m.should_mention ? '[该提]' : '[别主动提]'), m.said, '→', m.situation)
