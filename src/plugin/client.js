/**
 * client.js —— 设置页的浏览器半边（「设置 → 水之源」）
 *
 * 对标 dsh-fish 的「设置 → 大肥鱼」：按她生活的各个面分页，不按代码模块分页。
 * 设计见 docs/SETTINGS-DESIGN.md。
 *
 * 数据流：页面 ⇄ 同源 fetch /water-source/* ⇄ ~/.water-source/
 *
 * ⚠ loader id 必须等于 package.json 的 name，否则浏览器那半边**静默不加载**：
 *   宿主照常跑、设置页空着，比崩还难查。
 * ⚠ 这个文件是浏览器脚本，任何语法错误会让宿主在启动阶段崩掉
 *   （2026-11-09 踩过：批次替换 CSS 变量时吃掉了引号）。
 */

window.__ModuleLoader__.load({
  id: '@local/water-source',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const { createElement: h, useCallback, useEffect, useState } = React

    const API = '/water-source'

    // ---- 主题变量：只用宿主真实存在的（从 dsh-fish client.js 挖出来的）----
    const T = {
      ink: 'var(--dsw-alias-label-primary, inherit)',
      dim: 'var(--dsw-alias-label-secondary, inherit)',
      faint: 'var(--dsw-alias-label-tertiary, inherit)',
      border: 'var(--dsw-alias-border-l2, currentColor)',
      bg: 'var(--dsw-alias-bg-l1, rgba(127,127,127,0.06))',
      err: 'var(--dsw-alias-label-error, #c0392b)',
      ok: 'var(--dsw-alias-state-business-primary, #178f7e)'
    }

    const S = {
      wrap: { padding: '18px 22px', maxWidth: 820, fontSize: 13, lineHeight: 1.7, color: T.ink },
      h1: { fontSize: 16, fontWeight: 600, margin: '0 0 2px' },
      sub: { fontSize: 12, color: T.dim, margin: '0 0 14px' },
      tabs: { display: 'flex', gap: 4, borderBottom: '1px solid ' + T.border, marginBottom: 16, flexWrap: 'wrap' },
      tab: (on) => ({ padding: '7px 14px', fontSize: 12.5, cursor: 'pointer', border: 'none', borderBottom: '2px solid ' + (on ? T.ok : 'transparent'), background: 'transparent', color: on ? T.ink : T.dim, fontWeight: on ? 600 : 400 }),
      help: { fontSize: 12, color: T.dim, margin: '0 0 16px', padding: '8px 12px', borderLeft: '3px solid ' + T.border, background: T.bg },
      box: { border: '1px solid ' + T.border, borderRadius: 8, padding: '14px 16px', marginBottom: 14 },
      boxTitle: { fontWeight: 600, marginBottom: 10, fontSize: 13 },
      label: { display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 },
      hint: { fontSize: 11.5, color: T.dim, marginBottom: 8 },
      input: { width: '100%', boxSizing: 'border-box', padding: '7px 9px', borderRadius: 6, border: '1px solid ' + T.border, fontSize: 13, background: T.bg, color: 'inherit' },
      row: { display: 'flex', gap: 10, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' },
      btn: { padding: '6px 14px', borderRadius: 6, border: '1px solid ' + T.border, background: T.bg, color: 'inherit', cursor: 'pointer', fontSize: 12.5 },
      pre: { background: T.bg, border: '1px solid ' + T.border, borderRadius: 6, padding: '10px 12px', fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0, maxHeight: 320, overflow: 'auto', color: T.ink },
      tag: { display: 'inline-block', padding: '1px 7px', borderRadius: 999, fontSize: 11, border: '1px solid ' + T.border, marginRight: 6, color: T.dim },
      kv: { display: 'grid', gridTemplateColumns: '130px 1fr', gap: '6px 12px', fontSize: 12.5 },
      k: { color: T.dim },
      empty: { fontSize: 12, color: T.faint, fontStyle: 'italic' }
    }

    async function jget(p) {
      const r = await fetch(API + p, { headers: { accept: 'application/json' } })
      const b = await r.json().catch(() => ({}))
      if (!r.ok || b.ok === false) throw new Error(b.why || ('HTTP ' + r.status))
      return b
    }
    async function jpost(p, body) {
      const r = await fetch(API + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      const b = await r.json().catch(() => ({}))
      if (!r.ok || b.ok === false) throw new Error(b.why || ('HTTP ' + r.status))
      return b
    }

    const fmtSize = (n) => n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : n >= 1024 ? (n / 1024).toFixed(0) + ' KB' : n + ' B'
    const fmtTime = (iso) => { const t = Date.parse(iso); if (!Number.isFinite(t)) return ''; const d = new Date(t); return (d.getMonth() + 1) + '-' + String(d.getDate()).padStart(2, '0') + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') }

    function Block({ title, children }) {
      return h('div', { style: S.box }, title ? h('div', { style: S.boxTitle }, title) : null, children)
    }
    function Empty({ children }) { return h('div', { style: S.empty }, children) }
    function KV({ rows }) {
      return h('div', { style: S.kv }, ...rows.flatMap(([k, v], i) => [h('div', { key: 'k' + i, style: S.k }, k), h('div', { key: 'v' + i }, v)]))
    }

    // ---------------- 1 状态 ----------------
    function NowPage({ state, err, reload }) {
      if (err) return h(Block, null, h('div', { style: { color: T.err } }, err))
      if (!state) return h(Empty, null, '读取中…')
      const b = state.budget ?? { used: 0, total: 2400 }
      return h('div', null,
        h(Block, { title: '她现在读到什么' },
          h('div', { style: { marginBottom: 10 } },
            h('span', { style: S.tag }, '事件 ' + state.events),
            h('span', { style: S.tag }, '预算 ' + b.used + ' / ' + b.total),
            h('span', { style: S.tag }, '保留 ' + (state.kept || []).join(' · ')),
            (state.dropped || []).length ? h('span', { style: S.tag }, '丢弃 ' + state.dropped.join(' · ')) : null
          ),
          h('pre', { style: S.pre }, state.injected || '（还没挂上）')
        ),
        h(Block, { title: '账本按类型' },
          Object.keys(state.byType || {}).length
            ? h('div', null, Object.entries(state.byType).map(([k, v]) => h('span', { key: k, style: S.tag }, k + ' ' + v)))
            : h(Empty, null, '还没有事件')
        ),
        h('div', { style: S.row }, h('button', { style: S.btn, onClick: reload }, '刷新'))
      )
    }

    // ---------------- 2 记忆 ----------------
    function MemoryPage({ data, err }) {
      if (err) return h(Block, null, h('div', { style: { color: T.err } }, err))
      if (!data) return h(Empty, null, '读取中…')
      const list = (arr) => arr.length
        ? h('div', null, arr.map((e, i) => h('div', { key: i, style: { marginBottom: 6 } },
            h('span', { style: { color: T.faint, fontSize: 11, marginRight: 8 } }, fmtTime(e.ts)),
            h('span', null, '「' + e.content + '」'))))
        : h(Empty, null, '还没有')
      return h('div', null,
        h(Block, { title: '总览' },
          h('div', null,
            h('span', { style: S.tag }, '全部 ' + data.total),
            h('span', { style: S.tag }, '可见 ' + data.visible),
            Object.entries(data.byType || {}).map(([k, v]) => h('span', { key: k, style: S.tag }, k + ' ' + v))
          )
        ),
        h(Block, { title: '她说过的话（这些是她的）' }, list(data.her)),
        h(Block, { title: '他最近说过' }, list(data.owner)),
        h(Block, { title: '被标记遗忘的' },
          data.forgotten.length
            ? h('div', null, data.forgotten.map((e, i) => h('div', { key: i, style: { marginBottom: 6, color: T.dim } },
                h('span', { style: { fontSize: 11, marginRight: 8 } }, fmtTime(e.ts)),
                h('span', null, '[' + e.type + '] ' + e.content))))
            : h(Empty, null, '没有')),
        h('div', { style: { fontSize: 11.5, color: T.faint, marginTop: 8 } }, '账本只追加。忘了也是记一条墓碑，不是抹掉。')
      )
    }

    // ---------------- 3 住所 ----------------
    function HomePage({ data, err, draft, setDraft, save, note }) {
      if (err) return h(Block, null, h('div', { style: { color: T.err } }, err))
      if (!data) return h(Empty, null, '读取中…')
      return h('div', null,
        h(Block, { title: '数据在哪' },
          h(KV, { rows: [
            ['数据目录', data.root],
            ['账本', fmtSize(data.db.bytes)],
            ['WAL', fmtSize(data.db.walBytes)],
            ['她的 preset', data.preset]
          ] })
        ),
        h(Block, { title: '她的会话' },
          h('label', { style: S.label }, 'herSessionId'),
          h('div', { style: S.hint }, '留空 = 所有会话的消息都进账本。填了 = 只记那一间房。'),
          h('input', { style: S.input, value: draft?.herSessionId ?? '', onChange: (e) => setDraft({ ...draft, herSessionId: e.target.value }) }),
          h('div', { style: S.row },
            h('button', { style: S.btn, onClick: save }, '保存'),
            note ? h('span', { style: { fontSize: 11.5, color: T.ok } }, note) : null
          )
        ),
        h(Block, { title: '自检' },
          h('div', { style: S.hint }, '跑一遍账本完整性和装配，报告问题。'),
          h('button', { style: S.btn, onClick: () => location.reload() }, '重载页面')
        )
      )
    }

    // ---------------- 4 插件 ----------------
    function PluginPage({ data, err, cfg, draft, setDraft, save, note }) {
      if (err) return h(Block, null, h('div', { style: { color: T.err } }, err))
      return h('div', null,
        h(Block, { title: '版本' },
          data ? h(KV, { rows: [['water-source', data.version], ['preset', data.preset]] }) : h(Empty, null, '读取中…')
        ),
        h(Block, { title: '路由' },
          data ? h('div', null, (data.routes || []).map((r) => h('div', { key: r, style: { fontSize: 12 } }, '· ' + r))) : null
        ),
        h(Block, { title: '她叫什么' },
          h('label', { style: S.label }, 'herName'),
          h('input', { style: S.input, value: draft?.herName ?? '', onChange: (e) => setDraft({ ...draft, herName: e.target.value }) }),
          h('div', { style: { height: 10 } }),
          h('label', { style: S.label }, 'ownerName'),
          h('input', { style: S.input, value: draft?.ownerName ?? '', onChange: (e) => setDraft({ ...draft, ownerName: e.target.value }) }),
          h('div', { style: S.row },
            h('button', { style: S.btn, onClick: save }, '保存'),
            note ? h('span', { style: { fontSize: 11.5, color: T.ok } }, note) : null
          )
        ),
        h(Block, { title: '已退休的开关' },
          h('div', { style: S.hint }, data?.note ?? 'stripHostPrompt：preset 里 persona 的 prefix 已经是她了，不需要注入后再摘。')
        )
      )
    }

    // ---------------- 主组件 ----------------
    const TABS = [
      ['now', '状态'],
      ['memory', '记忆'],
      ['home', '住所'],
      ['plugin', '插件']
    ]
    const TAB_HELP = {
      now: '现在是什么状态、走了多远、她此刻读到什么。这一页只读，唯一的验收工具。',
      memory: '她记得什么。只读——账本只追加，忘了也是记一条墓碑。',
      home: '住在哪：数据目录、账本大小、她的会话。',
      plugin: '版本、路由、名字和称呼。'
    }

    function WaterSourceSection() {
      const [tab, setTab] = useState('now')
      const [state, setState] = useState(null)
      const [mem, setMem] = useState(null)
      const [home, setHome] = useState(null)
      const [plug, setPlug] = useState(null)
      const [cfg, setCfg] = useState(null)
      const [draft, setDraft] = useState(null)
      const [err, setErr] = useState({})
      const [note, setNote] = useState('')

      const load = useCallback(async () => {
        const next = {}
        try { setState(await jget('/state')); delete next.now } catch (e) { next.now = String(e.message || e) }
        try { setMem(await jget('/memory')); delete next.memory } catch (e) { next.memory = String(e.message || e) }
        try { setHome(await jget('/home')); delete next.home } catch (e) { next.home = String(e.message || e) }
        try { setPlug(await jget('/plugin')); delete next.plugin } catch (e) { next.plugin = String(e.message || e) }
        try { const c = await jget('/config'); setCfg(c.config); setDraft((d) => d ?? c.config) } catch (e) { next.config = String(e.message || e) }
        setErr(next)
      }, [])

      useEffect(() => { load() }, [load])

      const save = useCallback(async () => {
        setNote('')
        try {
          const patch = { herName: draft?.herName ?? '', ownerName: draft?.ownerName ?? '', herSessionId: draft?.herSessionId ?? '' }
          const r = await jpost('/config', patch)
          setCfg(r.config)
          setNote('已保存，下一轮生效')
          await load()
        } catch (e) { setNote('保存失败：' + String(e.message || e)) }
      }, [draft, load])

      return h('div', { style: S.wrap },
        h('div', { style: S.h1 }, '水之源'),
        h('div', { style: S.sub }, '从一个一个事件里长出来的人格。这里只改环境，不写人设。'),
        h('div', { style: S.tabs }, TABS.map(([id, name]) =>
          h('button', { key: id, style: S.tab(tab === id), onClick: () => setTab(id) }, name))),
        h('div', { style: S.help }, TAB_HELP[tab]),
        tab === 'now' ? h(NowPage, { state, err: err.now, reload: load }) : null,
        tab === 'memory' ? h(MemoryPage, { data: mem, err: err.memory }) : null,
        tab === 'home' ? h(HomePage, { data: home, err: err.home, draft, setDraft, save, note }) : null,
        tab === 'plugin' ? h(PluginPage, { data: plug, err: err.plugin, cfg, draft, setDraft, save, note }) : null,
        h('div', { style: { fontSize: 11.5, color: T.faint, marginTop: 12 } },
          '设计见 docs/SETTINGS-DESIGN.md。「成长 / 教导 / 原理 / 数据」四页在后续版本。')
      )
    }

    const inject = ['slots']
    const NAV = '水之源'

    function apply(ctx) {
      ctx.effect(
        () => ctx.slots.inject('settings.section', () =>
          ctx.slots.register({ name: 'settings.section', id: 'water-source', order: 9, label: () => NAV }, WaterSourceSection),
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
