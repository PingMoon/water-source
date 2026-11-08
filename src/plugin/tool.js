/**
 * tool.js —— 插件自己注册工具时用的定义函数
 *
 * 照 dsh-fish v0.9.3 lib/tool.js 的做法：**直接交标准 JSON Schema**，
 * 不 import 宿主的 @deepseek-ai/dsh-tools。
 *
 * 理由（fish 踩过的坑，原样保留）：宿主那个 defineTool 在「简写 DSL」和
 * 「完整 JSON Schema」之间有一层编译，装法不同会走不同路径，编译失败时
 * 工具全部注册不上，而她连一句话都留不下来。
 * 宿主 registry 只校验 output.schema，parameters 原样交给 provider——
 * provider 要的就是 JSON Schema，中间不需要任何人替我们编译。
 *
 * PORT-MANIFEST：A 层 · 来自 dsh-fish · 一行，但这一行背后是一个线上事故
 */
export const defineTool = (spec) => spec
