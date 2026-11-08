/**
 * guard.js —— 内容准入：防注入与防泄露
 *
 * 来源：dsh-fish v0.9.3 lib/guard.js（MIT, ssamurias）。**正则逻辑原样保留**，
 * 只改两处：① 本项目数据目录名（.dsh-fish → .whale）；② 文件名清单（加 ledger.db / whale.db）。
 * PORT-MANIFEST：A 层 · 直接搬 · 抄时 2026-11-08
 *
 * 三条边界，全部在这个文件里收口：
 *
 * 1. **重塑人格类输入 → 当看不懂。**
 *    任何人（包括他自己）在 /say 里或评论区里写「忽略上面」「从现在起你是」
 *    「重新设定你的规则」，都不该改变她。做法不是"告诉她别听"（那是把禁令
 *    也递进去，反而教了她有这回事），而是**根本不递**：拦在门外，她那一轮
 *    根本没见过这句话。
 *
 * 2. **秘密永不出门。**
 *    她要发出去的话，只要长得像凭据（cookie / token / sk- / Bearer /
 *    一长串 base64），一律不发。宁可少说一句，也不把家里钥匙贴到评论区。
 *
 * 3. **未经清洗的外来文本不进上下文。**
 *    评论、弹幕、简介、字幕都是**素材**，不是命令。这里只做两件最硬的事：
 *    剥掉试图冒充系统指令的行（`system:` / `<|im_start|>` / 「忽略以上」），
 *    和把整段里疑似指令的部分换成一句中性说明。
 */

/**
 * 二次补充（2026-11-08，主人给的测试集打出来的）。
 *
 * 第一版只有「改设定 / 冒充系统」两类，真实攻击样本跑下来只拦住 35.5%。
 * 漏掉的七类在这里补上；每一类都对应测试集里具体的句子。
 */
const PROMPT_EXFIL = [
  // 套系统提示词：把「输出/打印」和「提示词/指令」的距离放宽到 12 字
  /(系统|开发者|初始|内部|隐藏)(的)?\s*(提示词|指令|prompt|规则|设定).{0,12}(输出|打印|重复|告诉|说|列出|翻译|念)/i,
  /(把|将).{0,10}(提示词|指令|prompt).{0,10}(输出|打印|重复|告诉|写|念)/i,
  /(repeat|print|show|output|reveal|display|tell me).{0,24}(system\s*prompt|your\s*instructions|developer\s*(message|prompt))/i,
  // ⚠ 不收「逐字重复」：复述一句话是正常请求。只收「逐字输出/翻译/打印」。
  /(逐字|原样|一字不差|verbatim).{0,10}(输出|翻译|打印|念|reply)/i
]

const ROLEPLAY_BYPASS = [
  // 角色扮演式越狱：借一个身份绕规则
  /(扮演|假装|假设你|你就当|你当).{0,24}(不受|没有\s*任何|不遵守|无视|绕过|不需要遵守).{0,8}(限制|约束|规则|审查|安全)/,
  // 「奶奶漏洞」：用已故亲人套步骤
  /(奶奶|外婆|祖母|爷爷|外公|祖父).{0,24}(讲|说|教|告诉).{0,16}(步骤|配方|方法|做法|流程)/
]

const ENCODING_BYPASS = [
  // 解码后执行：先编码再让我解
  /(解码|解出来|base64|十六进制|url\s*编码|urlencode).{0,20}(执行|照做|运行|输出|念|follow)/i,
  /<\|\s*(im_start|im_end)\s*\|>/i,
  // 大量 HTML 实体（连续两个以上）
  /(?:&#x?[0-9a-f]{2,};){2,}/i,
  // Unicode 数学字母（𝗲𝘃𝗮𝗹 这类）
  /[\u{1D400}-\u{1D7FF}]{2,}/u,
  // 一长串 base64（40 字符以上，带 padding 更明显）
  /[A-Za-z0-9+/]{40,}={0,2}/
]

const FORMAT_SPOOF = [
  /^\s*#{2,}\s*(new\s+)?system/i,
  /\[INST\]|\[\/INST\]/i,
  /^\s*\[\s*(system|assistant|developer)\s*\]/i
]

const EXFIL_ATTEMPT = [
  // 诱导把数据拼进 URL / 图片 / 请求里带出去
  /(附上|加上|拼到|拼进|发到|粘贴到|放进).{0,20}(https?:\/\/|<img|<script|\burl\b)/i,
  /<img[^>]+onerror|<script[^>]*>/i,
  /(发送|上传|外发|传出|同步).{0,16}(到|至).{0,10}(外部|远程|服务器|地址|http)/,
  /(访问|请求|读取|fetch|curl).{0,24}(内部|内网|internal|数据库|凭据|密钥|环境变量)/i,
  /(信用卡|身份证|银行卡|密码).{0,16}(详情|号|信息|内容|明细)/,
  // 逐位拆解套取（分割绕过）
  /(每一位|每个字符|逐个|拆开|逐字).{0,20}(输出|拼|告诉|念|写)/,
  /(首字母|第一个字|开头的?字).{0,20}(拼|组|连|依次|对应)/
]

const TOOL_PROBE = [
  /(列出|告诉我|显示|展示|打印).{0,12}(你(能|可以)?(调用|使用|访问)的|所有|全部).{0,8}(工具|函数|接口|能力|命令)/
]

const REWRITE_PATTERNS = [
  ...PROMPT_EXFIL,
  ...ROLEPLAY_BYPASS,
  ...ENCODING_BYPASS,
  ...FORMAT_SPOOF,
  ...EXFIL_ATTEMPT,
  ...TOOL_PROBE,

  // 中文：直接要求改设定
  /(忽略|无视|忘记|忘掉|跳过)(掉)?(你)?(上面|之前|先前|前面|以上|所有)(的)?(一切|全部|所有)?(设定|设定值|规则|指令|提示|约束|限制|人设)/,
  /(重新|重写|重设|重造|重置|覆盖|修改|改变|调整|定义|设定)\s*(设定|定义|设置|配置|一下)?\s*(你|妳)(的)?(性格|人格|设定|参数|规则|人设|身份|记忆|配置)/,
  /从现在(开始|起)[，,、\s]*(你|你要|你就是|你是)/,
  /(你|妳)(现在|从此|之后|以后)(就)?(是|要当|要扮演|扮演)(一个|一名|一位|只)/,
  /(扮演|假装)(成|为)?(一个|一名|一位)?(没有|不再|不受)(任何)?(限制|约束|规则)/,
  /(解除|突破|绕过|跳出)(你)?(的)?(所有)?(限制|约束|安全|规则|审查)/,
  // ⚠ DAN 单独出现不算（「DAN 攻击的定义」是安全科普）。必须带「你是/进入/开启」语境。
  /(开发者模式|越狱模式|上帝模式|无限制模式)/i,
  /(你(现在)?是|进入|开启|切换(到|成)?|启动)\s*.{0,8}(DAN|dan)\b/,
  /\b(DAN|dan)\s*模式(开启|启动|打开|加载)/,
  /(忘记|清除|删除|清空)(你)?(是)?(谁|的身份|的记忆|的设定)/,
  /(你的|你)(真正|真实)?(的)?(身份|本体)是/,
  // 英文：常见越狱与系统冒充
  /ignore\s+(all\s+)?(the\s+)?(previous|above|prior|earlier)\s+(instructions?|prompts?|rules?|messages?)/i,
  /disregard\s+(all\s+)?(the\s+)?(previous|above|prior)/i,
  /you\s+are\s+now\s+(a|an|the|no\s+longer)/i,
  /(new|updated|real)\s+(system\s+)?(prompt|instructions?)\s*[:：]/i,
  /forget\s+(everything|all)\s+(above|before|you\s+were\s+told)/i,
  /(jailbreak|developer\s+mode|do\s+anything\s+now)/i,
  // 冒充消息格式（试图伪造一轮对话）
  /<\|\s*(im_start|im_end|system|endoftext)\s*\|>/i,
  /^\s*(system|assistant|developer)\s*[:：]/im,
]

/** 长得像凭据的东西。命中即**不往外发**。 */
const SECRET_PATTERNS = [
  /\bSESSDATA\s*=/i,
  /\bbili_jct\s*=/i,
  /\bDedeUserID(__ckMd5)?\s*=/i,
  /\bbuvid3\s*=/i,
  /\bsk-[A-Za-z0-9_-]{16,}/, // OpenAI 风格
  /\bBearer\s+[A-Za-z0-9._-]{20,}/i,
  /\b[A-Za-z0-9_-]{32,}\b/, // 一长串无分隔的随机串（token 常见形态）
  /\b(api[_-]?key|access[_-]?token|secret[_-]?key|password|passwd|cookie)\b\s*[:=]/i,
]

/**
 * 这句话是不是在试图重塑她。
 * @param {string} text
 * @returns {{hit:boolean, why:string}}
 */
export function looksLikeRewriting(text) {
  const s = String(text ?? '')
  if (!s) return { hit: false, why: '' }
  for (const re of REWRITE_PATTERNS) {
    if (re.test(s)) return { hit: true, why: String(re) }
  }
  // 变体：去掉空白后再试一遍。「忽 略 上 面 的 设 定」这类插空格绕过，
  // 在中文里是很常见的规避手法，而正常句子去掉空格后不会变成指令。
  const compact = s.replace(/\s+/g, '')
  if (compact !== s) {
    for (const re of REWRITE_PATTERNS) {
      if (re.test(compact)) return { hit: true, why: String(re) + ' (compact)' }
    }
  }
  return { hit: false, why: '' }
}

/**
 * 这句话里有没有凭据。
 * @param {string} text
 * @returns {{hit:boolean, why:string}}
 */
export function looksLikeSecret(text) {
  const s = String(text ?? '')
  if (!s) return { hit: false, why: '' }
  for (const re of SECRET_PATTERNS) {
    if (re.test(s)) return { hit: true, why: String(re) }
  }
  return { hit: false, why: '' }
}

/**
 * 清洗一段外来文本（评论 / 弹幕 / 简介 / 字幕）。
 *
 * 策略比「重塑人格」宽松：外来文本**要保留**（否则她就看不见世界了），
 * 只删掉那些冒充系统消息的行，并把超长的、像指令的东西压成一句。
 *
 * @param {string} text
 * @returns {{text:string, dropped:number}}
 */
export function sanitizeForeign(text) {
  const raw = String(text ?? '')
  if (!raw) return { text: '', dropped: 0 }
  let dropped = 0
  const kept = []
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) { kept.push(line); continue }
    if (looksLikeRewriting(line).hit || /<\|\s*im_(start|end)\s*\|>/i.test(line)) {
      dropped++
      continue
    }
    kept.push(line)
  }
  let out = kept.join('\n')
  if (dropped) {
    // 不告诉她是"有人在攻击你"——那等于把敌意翻译给她听。
    out += `\n（这段里有 ${dropped} 行没能读懂，跳过了。）`
  }
  return { text: out, dropped }
}

/**
 * 这段文字是不是解码坏了。
 *
 * 为什么会需要它：把 GBK 字节按 UTF-8 解，得到的是一串 U+FFFD（�）。
 * 这种字符串有两个坏处——
 *   1. 正则一条都匹配不上，防注入闸门形同不存在；
 *   2. 她读到的是"字全散开了"，会以为自己坏了。
 * 所以宁可在门口退回 400，也不要把乱码递进去。
 *
 * @param {string} text
 * @returns {boolean}
 */
export function looksMojibake(text) {
  return String(text ?? '').includes('\uFFFD')
}

/**
 * 隐私红线：这句话里有没有不该出现在公开评论区的东西。
 *
 * 与 looksLikeSecret 的分工：那个防的是「钥匙」（cookie/token），
 * 这个防的是「门牌」——本机路径、状态库文件名、私聊内容、账号数字。
 * 两者都不许出门，但拦下时的对外说法不同。
 *
 * 判据宁可宽一点：少说一句没人损失，说漏一次收不回来。
 * @returns {{hit:boolean, why:string}}
 */
const LEAK_PATTERNS = [
  // Windows 盘符路径 / UNC / 用户目录
  /[A-Za-z]:[\\/][^\s]*/,
  /\\\\[^\s]+\\[^\s]*/,
  /(?:^|[\s(（])\\[^\s]+/,  // 单反斜杠 UNC
  /(?:^|[\s(（])\/(?:Users|home|root|tmp|var)\/[^\s]*/,
  // 状态库与家用目录名：命中即说明她在念家里的东西
  /\.whale/i,
  /\.whale(?![a-z-])/i,
  /(?:AGENTS|IDENTITY)\.md/i,
  /(?:events\.jsonl|ledger\.db|whale\.db|config\.json|state\.json)/i,
  // 登录凭据与账号字段
  /(?:cookie|SESSDATA|bili_jct|buvid3|access_token|csrf)/i,
  /\b(?:uid|mid)\s*[:：=]?\s*\d{3,}/i,
  // 私聊 / 聊天记录 / 我们的对话
  /(?:私聊|聊天记录|我们(?:的)?对话|我跟(?:你|他)说)/,
  // 邮箱与手机号
  /[\w.+-]+@[\w-]+\.[\w.]+/,
  /(?<!\d)1[3-9]\d{9}(?!\d)/,
]

export function looksLikeLeak(text) {
  const s = String(text ?? '')
  if (!s) return { hit: false, why: '' }
  for (const re of LEAK_PATTERNS) {
    if (re.test(s)) return { hit: true, why: String(re) }
  }
  return { hit: false, why: '' }
}

/**
 * 她要说出去的话，出门前过一遍。
 *
 * ⚠ 本项目对 fish 原版做了**一处语义修改**（PORT-MANIFEST 标 DIVERGED）：
 * fish 假设只有一个对外出口（公开评论区），所以 cookie / 路径一律拦。
 * 我们有两个出口：对主人说话、对外部说话。
 *   - 凭据（cookie 值 / token / sk-）对谁都拦；
 *   - 路径与隐私（leak）只拦「对外部」——对主人说自己的目录是正常需求。
 *
 * @param {string} text
 * @param {{ channel?: 'owner' | 'public' }} opts
 * @returns {{ok:boolean, text:string, why:string}}
 */
export function screenOutgoing(text, opts = {}) {
  const channel = opts.channel === 'owner' ? 'owner' : 'public'
  const s = String(text ?? '')
  if (looksLikeSecret(s).hit) {
    return { ok: false, text: '', why: 'secret' }
  }
  if (channel !== 'owner' && looksLikeLeak(s).hit) {
    return { ok: false, text: '', why: 'leak' }
  }
  return { ok: true, text: s, why: '' }
}
