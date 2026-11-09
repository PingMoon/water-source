import fs from 'node:fs'
const ASAR = 'C:\\Users\\12626\\AppData\\Local\\Programs\\DeepSeek Harness\\resources\\app.asar'
const st = fs.statSync(ASAR)
console.log('大小: ' + (st.size / 1024 / 1024).toFixed(1) + ' MB')

// asar: [4字节 pickle 长度][4字节 header 长度][4字节 json 长度][json][内容]
const fd = fs.openSync(ASAR, 'r')
const head = Buffer.alloc(16)
fs.readSync(fd, head, 0, 16, 0)
const jsonLen = head.readUInt32LE(12)
const jsonBuf = Buffer.alloc(jsonLen)
fs.readSync(fd, jsonBuf, 0, jsonLen, 16)
const tree = JSON.parse(jsonBuf.toString('utf8'))

// 找 web-server 相关文件
const found = []
function walk(node, p) {
  for (const [k, v] of Object.entries(node.files ?? {})) {
    const np = p + '/' + k
    if (v.files) walk(v, np)
    else if (/web.?server|connection/i.test(np) && /\.js$/.test(np)) found.push({ p: np, size: v.size, offset: v.offset })
  }
}
walk(tree, '')
console.log('候选文件 ' + found.length + ' 个')
for (const f of found.slice(0, 20)) console.log('  ' + f.p + '  ' + f.size + 'B')
fs.closeSync(fd)
