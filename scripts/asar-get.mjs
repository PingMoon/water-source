import fs from 'node:fs'
const ASAR = 'C:\\Users\\12626\\AppData\\Local\\Programs\\DeepSeek Harness\\resources\\app.asar'
const target = process.argv[2]
const fd = fs.openSync(ASAR, 'r')
const head = Buffer.alloc(16)
fs.readSync(fd, head, 0, 16, 0)
const jsonLen = head.readUInt32LE(12)
const jsonBuf = Buffer.alloc(jsonLen)
fs.readSync(fd, jsonBuf, 0, jsonLen, 16)
const tree = JSON.parse(jsonBuf.toString('utf8'))
const base = 8 + jsonLen  // 内容区起点（header 8 字节对齐）
function find(node, p) {
  for (const [k, v] of Object.entries(node.files ?? {})) {
    const np = p + '/' + k
    if (v.files) { const r = find(v, np); if (r) return r }
    else if (np === target) return v
  }
  return null
}
const f = find(tree, '')
if (!f) { console.log('没找到 ' + target); process.exit(1) }
const buf = Buffer.alloc(f.size)
fs.readSync(fd, buf, 0, f.size, base + Number(f.offset))
fs.closeSync(fd)
process.stdout.write(buf.toString('utf8'))
