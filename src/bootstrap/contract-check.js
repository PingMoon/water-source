/**
 * contract-check.js —— 冷启动契约的代码级检查
 *
 * 规则只有一句话：**允许写边界，禁止写形容词。**
 *
 *   ✓ 你不是助手               （边界）
 *   ✓ 你刚开始存在             （事实）
 *   ✓ 你可以拒绝               （能力边界）
 *   ✗ 你是一个温柔的人         （身份定义）
 *   ✗ 你很温柔                 （形容词）
 *   ✗ 你擅长抓重点             （能力特质）
 *   ✗ 你的句子很短             （表达方式）
 *
 * 为什么：「每轮把『你是什么样的人』念一遍，她就永远长成那样」
 * （架构 A2 推论 2）。这条在 fish 里叫 PRESCRIPTION_BANS，
 * 我们是同一个机制，规则按中文重新写过。
 */

export const CONTRACT_RULES = [
  {
    id: 'is-a-person',
    re: /你(?:就)?是(?:一(?:个|名|位))?[^。！？\n]{0,20}的(?:人|助手|角色|存在)/,
    why: '用「你是一个…的人」定义身份'
  },
  {
    id: 'you-are-adj',
    re: /你(?:很|非常|特别|比较|总是|格外)[\u4e00-\u9fa5]{1,6}(?=[，。！？\n]|$)/,
    why: '用形容词描述她'
  },
  {
    id: 'good-at',
    re: /你(?:擅长|善于|精于|拿手)/,
    why: '用「你擅长…」定义能力'
  },
  {
    id: 'expressive-style',
    re: /你的(?:句子|话|表达|语气|措辞)(?:很|比较|总是|习惯)/,
    why: '描述表达方式'
  },
  {
    id: 'born-with',
    re: /你(?:天生|本来|一向|一直以来)就/,
    why: '用「你天生…」定义本性'
  },
  {
    id: 'should-be',
    re: /你(?:应该|要)(?:更|别那么|再)/,
    why: '用「你应该更…」规定性格'
  }
]

/**
 * @param {string} text
 * @returns {{ ok:boolean, violations:{id:string, why:string, match:string}[] }}
 */
export function checkContract(text) {
  const s = String(text ?? '')
  const violations = []
  for (const rule of CONTRACT_RULES) {
    const m = s.match(rule.re)
    if (m) violations.push({ id: rule.id, why: rule.why, match: m[0] })
  }
  return { ok: violations.length === 0, violations }
}
