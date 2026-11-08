# 代码生命周期

## 分支

| 分支 | 用途 |
|---|---|
| `main` | 稳定线，随时可装进 DSH |
| `feat/<短名>` | 新功能 |
| `fix/<短名>` | 修 bug |
| `docs/<短名>` | 只改文档 |

不设 `develop`——一个人开发，多一条长期分支只是多一次合并。

## 提交消息

格式：`<type>(<scope>): <中文描述>`

- type：feat / fix / refactor / test / docs / chore
- scope：store / guard / derive / consolidate / skill / eval / plugin / ci
- 描述写**做了什么、为什么**，不写「修改了文件」

## 合并

- 一个 PR 只做一件事
- 合并用 **squash**
- 合并前必须 CI 绿

## 版本

| 版本 | 对应 |
|---|---|
| 0.1.x | M0 地基 |
| 0.2.x | M1 流水线 |
| 0.3.x | M2 skill |
| 0.4.x | M3 团队 |

## 发版

1. CI 绿 + 本地 `node --test` 绿
2. 更新 `CHANGELOG.md`
3. `git tag v0.x.y` 并推送
4. 在 DSH 里重装一次验证

## 不许做的事

- 不许 force push main——历史是账本，和她的 self-log 同一条原则
- 不许把 `~/.water-source/` 或任何 `.db` 提交进来
- 不许把 API key 写进任何文件（只走环境变量）
- 不许删除 PORT-MANIFEST 的来源记录
