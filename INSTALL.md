# 怎么装进 DSH

接线方式与 `@ssamurias/dsh-fish` 一致。

## 一、结构

```
water-source/
├── package.json        # name/main/dsh.bundle.patch
├── cordis.patch.yml    # insert: id=water-source, name=@local/water-source
└── src/plugin/index.js # apply(ctx, config)
```

## 二、装法

在 DSH 里让它自己装最省事：

> 把 `C:\...\water-source` 这个目录作为一个本地插件装进 web profile。

命令行等价：

```bash
dsh plugin --profile web add file:C:/Users/12626/Documents/deepseek-harness/default-workspace/water-source
```

装完**重启一次 DSH**。

## 三、数据在哪

`~/.water-source/`（可用环境变量 `WATER_SOURCE_HOME` 或插件配置里的 `root` 覆盖）：

```
ledger.db     账本（事件只追加，触发器强制）
skills/       SKILL.md
```

## 四、验证装上了

1. 看日志里有没有 `[water-source] 启动 · schema v3 · 事件 N`
2. 让她调一次 `remember` 工具（直接在对话里说「记住我不吃辣」）
3. 看 `~/.water-source/ledger.db` 里有没有多一条 `source=tool` 的事件

## 五、这一版在 DSH 里做了什么、没做什么

| 做 | 没做 |
|---|---|
| 启动内核（账本/迁移/冷启动） | 会话里自动 ingest（还靠工具手动记） |
| 注册 `remember` 工具 | 归并流水线没接到调度器 |
| `systemPrompt.context` 注入「你记得的事」 | 没有 UI（设置页/记忆列表） |
| 停用时干净关闭 | 没有 skill 的自动生成 |

**这一版是「接进去了，还不会自己干活」。** 想让它自动记、自动归并，下一步要把
`agent/inbox` 事件接到 `ingest()`，再挂一个定时器跑 `consolidate()`。

## 六、出问题怎么看

日志前缀统一是 `[water-source]`。常见三条：

- `启动失败：...` —— 多半是 `~/.water-source` 权限或 node:sqlite 不可用（要 Node ≥22，建议 24）
- `remember 工具没挂上` —— 宿主 `ctx.tools` 不可用
- `systemPrompt 挂不上` —— 宿主版本没有 `agent.ctx.systemPrompt.context`
