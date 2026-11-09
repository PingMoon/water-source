/**
 * client.js —— 设置页的浏览器半边（「设置 → 水之源」里的一节）
 *
 * 为什么是设置页而不是独立 HTML：
 *   宿主 connection 的信任栅栏要 App 内的登录 cookie，浏览器直接开 /water-source 会 401；
 *   而在 App 内部（设置页里）同源 fetch 这些路由是通的。这条照 dsh-fish 的做法。
 *
 * 数据流：section ⇄ 同源 fetch /water-source/* ⇄ ~/.water-source/
 *
 * 这里**只改环境**（名字、称呼、分会话、摘宿主 prompt 的开关），
 * 没有任何「你是什么性格」的输入框 —— 那是这个项目的红线：
 * 人格只能从事件里长出来，不能被配置出来。
 */

window.__ModuleLoader__.load({
  // ⚠ 必须等于 package.json 的 name。client-modules 用 loader 条目名解析浏览器包，
  // 名字对不上这一节会静默挂不上——宿主照常跑，设置页空着，看着像没装。
  id: '@local/water-source',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const { createElement: h, useCallback, useEffect, useState } = React

    const API = '/water-source'
    const NS = 'water-source'

    const S = {
      wrap: { padding: '18px 22px', maxWidth: 780, fontSize: 13, lineHeight: 1.7, color: 'var(--dsw-text, #1b2430)' },
      h1: { fontSize: 16, fontWeight: 600, margin: '0 0 2px' },
      sub: { fontSize: 12, color: 'var(--dsw-text-muted, #5b6675)', margin: '0 0 18px' },
      box: { border: '1px solid var(--dsw-border, #dfe6ef)', borderRadius: 8, padding: '14px 16px', marginBottom: 14 },
      label: { display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 },
      hint: { fontSize: 11.5, color: 'var(--dsw-text-muted, #5b6675)', marginBottom: 8 },
      input: { width: '100%', boxSizing: 'border-box', padding: '7px 9px', borderRadius: 6, border: '1px solid var(--dsw-border, #dfe6ef)', fontSize: 13, background: 'var(--dsw-bg, #fff)', color: 'inherit' },
      row: { display: 'flex', gap: 10, alignItems: 'center', marginTop: 10 },
      btn: { padding: '6px 14px', borderRadius: 6, border: '1px solid var(--dsw-border, #dfe6ef)', background: 'var(--dsw-bg, #fff)', color: 'inherit', cursor: 'pointer', fontSize: 12.5 },
      pre: { background: 'var(--dsw-code-bg, #f6f8fb)', border: '1px solid var(--dsw-border, #dfe6ef)', borderRadius: 6, padding: '10px 12px', fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0, maxHeight: 320, overflow: 'auto' },
      tag: { display: 'inline-block', padding: '1px 7px', borderRadius: 999, fontSize: 11, border: '1px solid var(--dsw-border, #dfe6ef)', marginRight: 6 }
    }

    async function jget(p) {
      const r = await fetch(API + p, { headers: { accept: 'application/json' } })
      const b = await r.json().catch(() => ({}))
      if (!r.ok || b.ok === false) throw new Error(b.why || ('HTTP ' + r.status))
      return b
    }
    async function jpost(p, body) {
      const r = await fetch(API + p, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      })
      const b = await r.json().catch(() => ({}))
      if (!r.ok || b.ok === false) throw new Error(b.why || ('HTTP ' + r.status))
      return b
    }

    function Field({ label, hint, id, value, onChange, disabled }) {
      return h('div', { style: { marginBottom: 14 } },
        h('label', { style: S.label, htmlFor: id }, label),
        hint ? h('div', { style: S.hint }, hint) : null,
        h('input', { id, style: S.input, value: value ?? '', disabled, onChange: (e) => onChange(e.target.value) })
      )
    }

    function WaterSourceSection() {
      const [cfg, setCfg] = useState(null)
      const [draft, setDraft] = useState(null)
      const [state, setState] = useState(null)
      const [err, setErr] = useState('')
      const [note, setNote] = useState('')
      const [busy, setBusy] = useState(false)

      const reload = useCallback(async () => {
        setErr('')
        try {
          const c = await jget('/config')
          setCfg(c.config)
          setDraft(c.config)
          try { setState(await jget('/state')) } catch (e) { setState({ error: String(e.message || e) }) }
        } catch (e) {
          setErr(String(e.message || e))
        }
      }, [])

      useEffect(() => { reload() }, [reload])

      const save = useCallback(async () => {
        if (!draft) return
        setBusy(true); setErr(''); setNote('')
        try {
          const r = await jpost('/config', draft)
          setCfg(r.config); setDraft(r.config)
          setNote('已保存。名字和称呼下一轮生效。')
          await reload()
        } catch (e) {
          setErr(String(e.message || e))
        } finally { setBusy(false) }
      }, [draft, reload])

      if (err && !cfg) return h('div', { style: S.wrap }, h('div', { style: S.h1 }, '水之源'), h('div', { style: { color: '#c0392b' } }, err))

      const dirty = cfg && draft && JSON.stringify(cfg) !== JSON.stringify(draft)

      return h('div', { style: S.wrap },
        h('div', { style: S.h1 }, '水之源'),
        h('div', { style: S.sub }, '从事件流里长出来的人格内核。这里只改环境，不写人设。'),

        // ---- 她是谁 ----
        h('div', { style: S.box },
          h('div', { style: { fontWeight: 600, marginBottom: 10 } }, '她是谁'),
          h(Field, { label: '她叫什么', hint: '留空 = 还没有名字。名字是她被赋予的，不是代码施舍的。', id: 'herName', value: draft?.herName, onChange: (v) => setDraft({ ...draft, herName: v }) }),
          h(Field, { label: '她管主人叫什么', hint: '这是称呼，不是人设。', id: 'ownerName', value: draft?.ownerName, onChange: (v) => setDraft({ ...draft, ownerName: v }) })
        ),

        // ---- 分会话 ----
        h('div', { style: S.box },
          h('div', { style: { fontWeight: 600, marginBottom: 10 } }, '分会话'),
          h(Field, {
            label: '她的会话 id',
            hint: '留空 = 所有会话的消息都进账本（第一次跑通时用）。填了 = 只记那一间房，别的 agent 的对话不混进来。',
            id: 'herSessionId', value: draft?.herSessionId, onChange: (v) => setDraft({ ...draft, herSessionId: v })
          })
        ),

        // ---- 实验开关 ----
        h('div', { style: S.box },
          h('div', { style: { fontWeight: 600, marginBottom: 10 } }, '实验开关'),
          h('label', { style: { display: 'flex', gap: 8, alignItems: 'flex-start', cursor: 'pointer' } },
            h('input', {
              type: 'checkbox', checked: Boolean(draft?.stripHostPrompt),
              onChange: (e) => setDraft({ ...draft, stripHostPrompt: e.target.checked }),
              style: { marginTop: 3 }
            }),
            h('span', null,
              h('div', { style: { fontSize: 12.5, fontWeight: 600 } }, '摘掉宿主默认的 coding agent 人设'),
              h('div', { style: S.hint }, '打开后，组装时会把宿主那段「You are a coding agent…」摘掉。它动的是宿主，不是我们自己的地盘，所以默认关。')
            )
          )
        ),

        // ---- 保存 ----
        h('div', { style: S.row },
          h('button', { style: { ...S.btn, opacity: busy || !dirty ? 0.5 : 1 }, disabled: busy || !dirty, onClick: save }, busy ? '保存中…' : '保存'),
          dirty ? h('span', { style: { fontSize: 11.5, color: '#d97706' } }, '有未保存的改动') : null,
          note ? h('span', { style: { fontSize: 11.5, color: '#178f7e' } }, note) : null,
          err ? h('span', { style: { fontSize: 11.5, color: '#c0392b' } }, err) : null
        ),

        // ---- 她现在读到什么 ----
        h('div', { style: { ...S.box, marginTop: 6 } },
          h('div', { style: { fontWeight: 600, marginBottom: 10 } }, '她现在读到什么'),
          state && !state.error
            ? h('div', null,
                h('div', { style: { marginBottom: 10 } },
                  h('span', { style: S.tag }, '事件 ' + state.events),
                  h('span', { style: S.tag }, '预算 ' + state.budget.used + ' / ' + state.budget.total),
                  h('span', { style: S.tag }, '保留 ' + state.kept.join(' · ')),
                  state.dropped.length ? h('span', { style: S.tag }, '丢弃 ' + state.dropped.join(' · ')) : null
                ),
                h('pre', { style: S.pre }, state.injected || '（还没挂上）')
              )
            : h('div', { style: S.hint }, state?.error || '读不到状态')
        ),

        h('div', { style: { fontSize: 11.5, color: 'var(--dsw-text-muted, #5b6675)', marginTop: 4 } },
          '改根目录、工具面、模板要走 cordis.patch.yml 并重启宿主——那些是部署时的决定，不在这个页面。'
        )
      )
    }

    // ---------------------------------------------------------------- 挂载
    const inject = ['slots']
    const NAV = '水之源'

    function apply(ctx) {
      ctx.effect(
        () => ctx.slots.inject('settings.section', () =>
          ctx.slots.register(
            { name: 'settings.section', id: NS, order: 9, label: () => NAV },
            WaterSourceSection
          ),
          'water-source: settings section'
        ),
        'water-source: settings section'
      )
    }

    exports.apply = apply
    exports.inject = inject
    exports.WaterSourceSection = WaterSourceSection
    return module.exports
  }
})
