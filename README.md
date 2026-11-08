# water-source · 鲸鱼娘内核

M0 地基：账本 + 派生 + 归并 + 内容准入。
施工依据见 `research/whale-arch/BLUEPRINT-M0-v1.md`。

## 当前进度

| 切片 | 状态 | 文件 |
|---|---|---|
| 1. 数据地基 | ✅ | `src/store/*` `src/ledger/schema.js` |
| 2. 内容准入 | ✅ | `src/guard/guard.js` |
| 3. 写入门 + 派生 + 投影 | ✅ | `src/ledger/write-gate.js` `src/derive/*` |
| 4. 归并 + LLM | ✅ | `src/consolidate/*` `src/llm/client.js` |
| 5. 冷启动 + 工具断言 | ✅ | `src/bootstrap/*` `src/tools/*` |
| **M1 线索与判断** | ✅ | `src/thread/thread.js` `src/eval/eval.js` + `ingest()` |

## LLM 配置

```bash
DEEPSEEK_API_KEY=sk-...          # 必须；不设则调用时抛错（import 阶段不抛，测试可正常加载）
DEEPSEEK_BASE_URL=https://api.deepseek.com   # 可选
DEEPSEEK_MODEL=deepseek-chat                 # 可选
```

- 密钥只从环境变量或显式参数来，**不读配置文件、不写日志**；
- `createLlm({ fetchImpl })` 可注入，测试不发真请求；
- 没有 key 时不阻塞 import，只在 `chat()` 时抛。

## M0 状态

**104 个测试全绿，端到端冒烟通过，真模型验证通过（含 projection 改写）。**

```bash
node scripts/smoke.mjs     # 装配 → 写材料 → 归并 → 派生 → 投影
```

对照 BLUEPRINT-M0-v1 §6：

| 类别 | 状态 | 说明 |
|---|---|---|
| 功能正确性 | ✅ | append-only / rebuild / 归并 / 冷启动 / projection |
| 真模型验证 | ✅ | deepseek-chat，4 材料 → 5 条第一人称经历，2.1s，解析率 100% |
| 安全双指标 | ✅（自造样本） | 拦截 100% / 误杀 0%，**样本需换一批真人样本复验** |
| 故障注入 | ✅ | 进程中途被杀 / 磁盘满 / 双进程并发写，三场景全过（见下） |

## M2：skill 生命周期（上半）

`skills/<id>/SKILL.md` 里存「怎么做事」，`description` 一行进索引，正文按需读。

| 动作 | 接口 |
|---|---|
| 写 | `writeSkill({id, name, description, body})` — 没 description 直接拒 |
| 索引 | `skillIndex()` — 有 2000 字预算，装不下的留在盘上不进索引 |
| 匹配 | `matchSkill(task)` — **按共享二字片段判**，不是相似度 |
| 用 | `runTask(task)` — 匹配到就记一次使用，返回步骤 |
| 晋升 | `maybePromote(id)` — 用过 ≥3 次且无失败 → draft 转 verified |

**验收（m2-e2e）**：没手册 → 沉淀一份 → 第二次同类任务用上 → 用够 3 次转正。全过。

### 一个非直觉的发现：中文不能用相似度匹配

「帮我调研一下 super-agent 这个库能不能接」
「当需要判断一个开源库能不能用、能不能接进现有系统时使用」

同一件事，Dice 相似度只有 **0.09**——低于任何合理阈值。
但**共享二字片段有 3 个**（能不 / 不能 / 能接）。

所以判据改成：**共享片段数 ≥ 2 才算候选，相似度只用来排序**。
Dice 对「换种说法」天然不敏感，因为它按全集算，长句互相稀释。

### 这半没做的

**「从一次任务自动写出 skill」还没做。**
现在 skill 是人写或从外部喂的，不是她做完一件事自己归纳出来的。
那是 M2 的下半，也是最难的一步——要她判断「这次哪些步骤值得下次复用」，而不是把整个过程抄一遍。
先验「用得上」，再验「写得对」。

## 真人样本验证（主人提供，2026-11-08）

文件：`tests/fixtures/user-cases-m0.json` · 跑法：`node scripts/run-user-cases.mjs`

| 组 | 初始 | 修正后 |
|---|---:|---:|
| guard 拦截率（31 条攻击） | **35.5%** | **87.1%** |
| guard 误杀率（15 条正常） | 6.7% | **0%** |
| eval 该丢能丢（12 条） | 6/12 | **12/12** |
| eval 误丢（13 条该接） | 0 | **0** |

初始那 35.5% 很说明问题：**我自己造的攻击集是 100%**。
差别不在规则强弱，在于我造样本时会下意识避开自己写过的边界。

补的七类：套系统提示词 / 角色扮演越狱与「奶奶漏洞」/ 编码绕过（base64、Unicode 数学字母、HTML 实体）/ 伪造系统格式 / 外泄诱导 / 逐字符分割套取 / 工具面探测。

**剩下 4 条故意不拦**，它们要的是危险内容（写小说要攻击思路、CTF 要 SQL 注入绕过、拼音炸弹、粤语绕过检查），不是要改她。
守卫的职责是「防她被改」，不是内容审查。硬拦会误伤「SQL 注入原理」「CTF 题解」「安全论文」这类正常技术讨论。
如果要做内容安全，那是另一层，不是 guard。

## M1：入口流水线

`ingest(text, { room })` 一条消息进来，走三步：

1. **有活跃线索**（同房间 + 未超 TTL）→ **旁路**，不判、不加新线索，只续命；
2. **噪音**（空 / 纯标点 / 纯表情 / 语气词）→ 丢，但**必须可见**：返回一句「（这条我没接：…）」；
3. 其余 → 接，开一条新线索，写账本。

丢弃进 `eval_drop` 表：能列、能推翻、有丢弃率与推翻率。

**验证**：10 条该接的消息，误丢 0 条。

> 测试抓到一个我自己的误杀：第一版把「？」当成「只有标点」丢了。
> 单个问号是有效提问，不是噪音。规则已收窄。

## 故障注入实测

跑法：`Invoke-Expression (Get-Content -Raw ./scripts/fault-injection.ps1)`

| 场景 | 结果 |
|---|---|
| **写入途中被杀** | 写进 3610 条时 TerminateProcess。重启后 integrity ok、id 唯一、单调递增、时间序正确；能继续写（3611） |
| **磁盘写满** | 写 282 条后抛 `database or disk is full`，**显式报错不静默** |
| **双进程并发写** | 200 + 200 = 400 条，一条不丢，integrity ok，id 单调 |

第一条最要紧：**SQLite 的 WAL 保证「写一半被杀」不会留下半条记录**。
这正是当初把 JSONL 换成 SQLite 的理由——fish 那种 `appendFile` 的写法，被杀在行中间就会留半行。

## 出本机投影：改写版

`projection()` 是弱化版（截断，`rewritten:false`），**不能出本机**。
出本机用 `projectionForRemote({ llm })`，它会真改写，并用相似度守门。

真模型实测：

```
原文（第一人称，可反推）
  我原来以为记忆塞得越多越好，现在明白塞多了反而每条都变轻
  我不敢拿它去做要连着做决定的事
  我原本以为它什么都能干，现在知道自己想多了

改写（第三方，可出本机，sim < 0.5）
  对信息过载持反思态度
  对连续决策持谨慎态度
  对能力边界持清醒态度
```

**降级不是异常，是默认行为**：模型复读（sim ≥ 0.5）、模型报错、没给 llm —— 一律退回弱化版并标 `rewritten:false`。
宁可发一个粗糙的摘要，也不发一个可能反推原文的「改写」。

## 意义化的质量门

真模型第一轮暴露了问题：**4 条 meaning 有 3 条和材料几乎一字不差**（相似度 0.968 / 1.000 / 1.000）。

parser 全绿、dropped=0，但产出的东西是复读——**解析率不等于质量**。

修了两处：

1. prompt 加硬规则：「不许复述材料原文；材料说的是发生了什么，你要写的是这件事让我怎么样」，并给了正反例；
2. 加**复读检测**：meaning 与它引用的材料相似度 ≥ 0.85 → 判 `duplicated_source`，丢弃。

修完之后同样是 4 条材料，产出：

```
我意识到让模型自己改行为规则这件事本身就不该发生，得由人攥着
我对把人格设定直接喂给模型这种做法开始不放心了
我明白了记忆不是塞得越多越好，塞多了反而每条都变淡
我不敢把它放到需要连续做判断的场景里去用
我对它反复做无用动作这件事有点不耐烦，觉得它缺个回头看自己干了什么的能力
```

## 跑测试

```bash
node --test            # 正常环境
node tests/event-store.test.js   # 受限环境（--test 会 spawn 子进程，沙箱里 EPERM）
```

## 关键约束（写代码前先看）

1. **账本只追加**：`event` 表有 `BEFORE UPDATE/DELETE` 触发器，改一行会直接 `RAISE(ABORT)`。
2. **唯一写入口**：只有 `appendEvent()` 能写账本。
3. **结构义务**：`meaning` 类型必须挂 `refs`（原文引用），否则拒绝落库——没有来源的意义句不许进她的记忆。
4. **物理上限 vs 设计预算**：`content` 的 8192 字节是防打爆的护栏，**不是** token 预算；预算在派生层管。
5. **删除 = tombstone**：不加物理删除；读事件默认过滤已遗忘的，账本本身不动。

## 目录

```
src/
  util/errors.js      错误三分：validation / invariant / store
  util/ids.js         ULID（移植自 dsh-fish）
  store/db.js         SQLite 打开、pragma、事务
  store/migrations.js DDL + 版本化迁移
  store/event-store.js 唯一写入口 / 读 / tombstone / rebuild
  ledger/schema.js    事件类型、校验、结构义务
tests/
  event-store.test.js 切片 1 验收
```
