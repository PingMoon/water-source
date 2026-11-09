import fs from 'node:fs'
const ASAR = 'C:\\Users\\12626\\AppData\\Local\\Programs\\DeepSeek Harness\\resources\\app.asar'
const fd = fs.openSync(ASAR, 'r')
const head = Buffer.alloc(16)
fs.readSync(fd, head, 0, 16, 0)
const jsonLen = head.readUInt32LE(12)
const jsonBuf = Buffer.alloc(jsonLen)
fs.readSync(fd, jsonBuf, 0, jsonLen, 16)
const tree = JSON.parse(jsonBuf.toString('utf8'))
const re = new RegExp(process.argv[2], 'i')
const found = []
function walk(node, p) {
  for (const [k, v] of Object.entries(node.files ?? {})) {
    const np = p + '/' + k
    if (v.files) walk(v, np)
    else if (re.test(np)) found.push({ p: np, size: v.size })
  }
}
walk(tree, '')
fs.closeSync(fd)
for (const f of found.slice(0, 25)) console.log(f.p + '  ' + f.size + 'B')
console.log('共 ' + found.length + ' 个')
