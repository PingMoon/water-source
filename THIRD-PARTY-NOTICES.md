# 第三方声明

本项目包含来自以下开源项目的代码或衍生代码。

---

## dsh-fish

- 仓库：<https://github.com/ssamurias/dsh-fish>
- 版本：v0.9.3
- 许可：MIT
- 使用范围：`src/util/ids.js`（ULID 实现原样移植）；`src/ledger/schema.js`、`src/store/event-store.js`（借校验与写入口形状，逻辑重写）

```
MIT License

Copyright (c) 2026 大肥鱼（dsh-fish）作者

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## dsh-persona

- 仓库：本地工作区 `dsh-persona`（作者自研，与上游大肥鱼设计同源）
- 版本：0.18.1
- 许可：MIT
- 使用范围：`src/store/db.js`、`src/store/migrations.js` 借鉴其 pragma 组合与迁移形状

---

## 未使用但已评估

- `LofiSu/deepseek-super-agent`（MIT）：仅借语义（Thread / Eval / Ticket / routines 四条调度语义），未使用其代码。
- `dsh-fish-memory`（自定义许可，SEE LICENSE）：未使用。
