# 移植清单（PORT-MANIFEST）

> 规则：抄进来的东西，从那天起就跟上游分叉了。这张表是**同步的唯一依据**。
> 每次从上游拉修复，更新「最近核对」并写一行变更。上游有破坏性改动时标 `DIVERGED`，不要静默跟随。

| 文件 | 来源仓库 | 抄时版本 | 抄时日期 | 改了什么 | 最近核对 | 待跟进 |
|---|---|---|---|---|---|---|
| `src/util/ids.js` | ssamurias/dsh-fish | v0.9.3 | 2026-11-08 | 原样移植 `newId/encodeTime/randomPart/increment`，仅移动位置；新增 `idTime()` | 2026-11-08 | 无 |
| `src/store/migrations.js` | dsh-persona | 0.18.1 | 2026-11-08 | 借 `ensureSchema` 的「版本化 + 单事务 + 失败回滚」形状；SQL 全部重写 | 2026-11-08 | 无 |
| `src/store/db.js` | dsh-persona | 0.18.1 | 2026-11-08 | 借 pragma 组合（WAL / synchronous / busy_timeout）；重写为 ESM 并用 `node:sqlite` | 2026-11-08 | 无 |
| `src/store/event-store.js` | dsh-fish | v0.9.3 | 2026-11-08 | 借「唯一写入口 + 显式报错」形状；存储换 SQLite，JSONL 逻辑全部丢弃 | 2026-11-08 | 无 |
| `src/ledger/schema.js` | dsh-fish | v0.9.3 | 2026-11-08 | 借校验骨架与「refs 存在性」思路；事件类型表全部按本项目重写 | 2026-11-08 | 无 |
| `src/guard/guard.js` | dsh-fish | v0.9.3 | 2026-11-08 | **DIVERGED**（4 处）：① 补 compact 匹配（防「忽 略 上 面」空格绕过）；② 规则补「配置」；③ 补单反斜杠 UNC；④ `screenOutgoing` 增加 `{channel}` 参数（分层出口） | 2026-11-08 | 上游若改正则，人工比对后再合，**不要自动覆盖** |

| `src/ledger/write-gate.js` | dsh-persona | 0.18.1 | 2026-11-08 | 借「纯函数 + 动作枚举」形状；三条判据、相似度、极性全部自写 | 2026-11-08 | 无 |
| `src/derive/derive.js` | dsh-fish | v0.9.3 | 2026-11-08 | 借纯函数范式与「显著性排序 + 折叠」思路；字段与算法全部自写 | 2026-11-08 | 无 |

| `src/consolidate/pipeline.js` | dsh-persona | 0.18.1 | 2026-11-08 | 借 `consolidation_run` 的「running→done/failed 状态机」；编排逻辑自写 | 2026-11-08 | **上游曾因「重复计数」修过窗口取法，将来比对时注意** |

## 未移植但已评估

| 文件 | 结论 | 理由 |
|---|---|---|
| fish `lib/atomic-file.mjs` | 暂缓 | 账本改用 SQLite 后，原子写只服务配置文件/导出/备份；那三处落地时再搬 |
| ~~fish `lib/guard.js`~~ | ✅ 已搬（切片 2） | 见上表 DIVERGED 说明 |
| fish `lib/derive.js` | 不搬 | 绑定它自己的事件类型与词表，只借纯函数范式 |
| sa `store/backup.ts` | 参考 | WAL-safe 备份的语义可借，代码绑 SQLite 且是 TS |
