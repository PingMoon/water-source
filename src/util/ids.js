/**
 * ids.js —— ULID（单调递增）
 *
 * 来源：dsh-fish v0.9.3 lib/schema.js（MIT, ssamurias）的 newId / encodeTime /
 * randomPart / increment，原样移植，仅改导出位置与文档。
 * PORT-MANIFEST: A 层 · 上游 ssamurias/dsh-fish · 抄时 v0.9.3
 *
 * 前 10 位时间（单调），后 16 位随机。同一毫秒内保证递增，
 * 于是「行序 = 时间序」，读出来不用额外排序。
 */

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

let lastMs = 0
let lastRand = null

export function newId(now = Date.now()) {
  let ms = now
  if (ms <= lastMs) ms = lastMs
  let rand
  if (ms === lastMs && lastRand) {
    rand = increment(lastRand)
  } else {
    rand = randomPart()
  }
  lastMs = ms
  lastRand = rand
  return 'ev_' + encodeTime(ms) + rand
}

function encodeTime(ms) {
  let s = ''
  let t = ms
  for (let i = 0; i < 10; i++) {
    s = CROCKFORD[t % 32] + s
    t = Math.floor(t / 32)
  }
  return s
}

function randomPart() {
  let s = ''
  for (let i = 0; i < 16; i++) s += CROCKFORD[Math.floor(Math.random() * 32)]
  return s
}

function increment(prev) {
  const arr = prev.split('')
  for (let i = arr.length - 1; i >= 0; i--) {
    const idx = CROCKFORD.indexOf(arr[i])
    if (idx < 31) { arr[i] = CROCKFORD[idx + 1]; return arr.join('') }
    arr[i] = '0'
  }
  return randomPart()
}

/** 从 id 里取毫秒时间（不解析 ts 字段，用于排序校验） */
export function idTime(id) {
  const s = String(id ?? '')
  const body = s.startsWith('ev_') ? s.slice(3) : s
  if (body.length < 10) return 0
  let t = 0
  for (const ch of body.slice(0, 10)) {
    const idx = CROCKFORD.indexOf(ch)
    if (idx < 0) return 0
    t = t * 32 + idx
  }
  return t
}
