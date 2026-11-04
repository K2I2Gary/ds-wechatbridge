// DSH「通到微信」· 网页半边
//
// 在 **DSH 设置** 左侧栏加一项「通到微信」：
//   装依赖 → 启动桥接 → 选会话 → 开关 → 试一下。
//
// ⚠ 这里不碰会话、不发消息，只是往宿主那几条 /dsh-wechat-bridge/* 路由上读写。

window.__ModuleLoader__.load({
  id: 'dsh-wechat-bridge',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports

    const React = require('react')
    const inject = ['slots']

    const B = '/dsh-wechat-bridge'
    const get = (p) => fetch(B + p, { cache: 'no-store' }).then((r) => r.json()).catch(() => null)
    const post = (p, body) =>
      fetch(B + p, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body || {}),
      })
        .then((r) => r.json())
        .catch(() => null)

    const h = React.createElement

    const S = {
      wrap: {
        padding: '12px 14px 24px',
        fontSize: 13,
        lineHeight: 1.7,
        background: 'var(--dsw-alias-bg-layer-1, rgba(255,255,255,.92))',
        border: '1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.08))',
        borderRadius: 12,
      },
      h: { fontSize: 14, fontWeight: 600, margin: '18px 0 8px' },
      dim: { opacity: 0.62, fontSize: 12 },
      card: {
        border: '1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.12))',
        borderRadius: 8,
        padding: '10px 12px',
        marginBottom: 10,
        background: 'var(--dsw-alias-bg-layer-1)',
      },
      row: { display: 'flex', gap: 10, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' },
      lab: { minWidth: 170, fontSize: 12.5 },
      input: {
        border: '1px solid var(--dsw-alias-border-l2)',
        borderRadius: 6,
        padding: '4px 8px',
        background: 'transparent',
        color: 'inherit',
        fontSize: 12.5,
        boxSizing: 'border-box',
      },
      hint: { opacity: 0.6, fontSize: 11.5, marginTop: 2 },
      ok: { color: 'var(--dsw-alias-state-business-primary)', fontSize: 12 },
      bad: { color: '#c0392b', fontSize: 12, fontWeight: 600 },
      pre: {
        whiteSpace: 'pre-wrap',
        fontSize: 11.5,
        lineHeight: 1.5,
        maxHeight: 220,
        overflow: 'auto',
        background: 'rgba(127,127,127,.08)',
        borderRadius: 6,
        padding: '8px 10px',
        fontFamily: 'ui-monospace, Consolas, monospace',
      },
      btn: (primary) => ({
        border: '1px solid var(--dsw-alias-border-l2)',
        borderRadius: 6,
        padding: '5px 12px',
        background: primary ? 'var(--dsw-alias-state-business-primary)' : 'transparent',
        color: primary ? '#fff' : 'inherit',
        cursor: 'pointer',
        fontSize: 12.5,
      }),
      tag: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        fontSize: 12,
        padding: '1px 4px 1px 8px',
        borderRadius: 999,
        border: '1px solid var(--dsw-alias-border-l2)',
        background: 'rgba(127,127,127,.08)',
      },
      tagX: {
        border: 'none',
        background: 'transparent',
        color: 'inherit',
        cursor: 'pointer',
        fontSize: 13,
        lineHeight: 1,
        padding: '2px 3px',
        opacity: 0.7,
      },
      head: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
      title: { fontSize: 15, fontWeight: 700 },
      tabs: { display: 'flex', gap: 6, marginTop: 14, marginBottom: 2 },
      toolbar: {
        display: 'flex',
        gap: 10,
        alignItems: 'center',
        flexWrap: 'wrap',
        position: 'sticky',
        top: 0,
        zIndex: 2,
        margin: '12px 0 4px',
        padding: '8px 0',
        background: 'var(--dsw-alias-bg-layer-1, rgba(255,255,255,.92))',
      },
      chips: { display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 },
      chip: {
        fontSize: 11.5,
        padding: '1px 8px',
        borderRadius: 999,
        border: '1px solid var(--dsw-alias-border-l2)',
        opacity: 0.65,
      },
      chipOn: {
        fontSize: 11.5,
        padding: '1px 8px',
        borderRadius: 999,
        border: '1px solid var(--dsw-alias-state-business-primary)',
        color: 'var(--dsw-alias-state-business-primary)',
      },
      sub: { fontSize: 13, fontWeight: 600, margin: '14px 0 6px' },
      fold: { marginTop: 10, borderTop: '1px dashed var(--dsw-alias-border-l2)', paddingTop: 6 },
      sum: { cursor: 'pointer', fontSize: 12, opacity: 0.7, userSelect: 'none' },
      gallery: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
        gap: 10,
        marginTop: 10,
      },
      imageCard: {
        border: '1px solid var(--dsw-alias-border-l2)',
        borderRadius: 8,
        padding: 8,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        minWidth: 0,
      },
      thumb: {
        width: '100%',
        height: 110,
        objectFit: 'contain',
        borderRadius: 6,
        background: 'rgba(127,127,127,.08)',
      },
      imageDesc: { fontSize: 12, lineHeight: 1.5, maxHeight: 54, overflow: 'auto' },
    }

    const 开关 = (值, 改) =>
      h('input', { type: 'checkbox', checked: !!值, onChange: (e) => 改(e.target.checked) })

    // 会话 id 有的带 session- 前缀、有的不带，比的时候统一剥掉
    const 键 = (id) => String(id == null ? '' : id).trim().replace(/^session-/, '')

    function Section() {
      const [态, 设态] = React.useState(null)
      const [脏, 设脏] = React.useState(false)
      const [说, 设说] = React.useState('')
      const [忙, 设忙] = React.useState(false)
      const [新屏蔽, 设新屏蔽] = React.useState('')
      const [新只听, 设新只听] = React.useState('')
      const [网搜词, 设网搜词] = React.useState('')
      const [网搜条数, 设网搜条数] = React.useState(5)
      const [网搜保存, 设网搜保存] = React.useState(true)
      const [网搜抓取, 设网搜抓取] = React.useState(true)
      const [网搜结果, 设网搜结果] = React.useState(null)
      const [网搜说明, 设网搜说明] = React.useState('')
      const [网搜组, 设网搜组] = React.useState([])
      const [网搜中, 设网搜中] = React.useState(false)
      const [视图, 设视图] = React.useState('设置')
      const [更新, 设更新] = React.useState(null)
      const [查中, 设查中] = React.useState(false)
      // 轮询是异步的：脏这个 state 到回调里可能还是旧值，所以拿 ref 兜一份
      const 脏ref = React.useRef(false)
      const 设脏2 = (v) => {
        脏ref.current = !!v
        设脏(!!v)
      }

      const 拉 = React.useCallback(async () => {
        const d = await get('/state')
        if (!d || !d.ok) return
        // 手上有没保存的改动时，只更新状态（桥接/日志/会话清单），**别拿服务器那份配置盖掉**。
        // 以前就是这里每 4 秒盖一次：刚加的绑定行、刚打的聊天名、刚敲进屏蔽框的字，全被冲掉，
        // 于是「单独绑定根本用不了」「不回谁加不进去」。
        设态((旧) => (旧 && 脏ref.current ? { ...d, 配置: 旧.配置 } : d))
      }, [])

      React.useEffect(() => {
        拉()
        const t = setInterval(拉, 4000)
        return () => clearInterval(t)
      }, [拉])

      // 必须在 !态 的提前 return 之前调用所有 hook；这里只拉一次搜索组历史
      const 组已拉 = React.useRef(false)
      React.useEffect(() => {
        if (组已拉.current) return
        组已拉.current = true
        let 活 = true
        ;(async () => {
          const d = await get('/web-search/groups')
          if (活 && d && Array.isArray(d.groups)) 设网搜组(d.groups)
        })()
        return () => {
          活 = false
        }
      }, [])

      // 本地记忆（RAG / 笔记 / 联网摘要）：统计 + 清除
      const [记统, 设记统] = React.useState(null)
      const [记选, 设记选] = React.useState('')
      const [记忙, 设记忙] = React.useState(false)
      const [记说, 设记说] = React.useState('')
      const 记已拉 = React.useRef(false)
      React.useEffect(() => {
        if (记已拉.current) return
        记已拉.current = true
        let 活 = true
        ;(async () => {
          const d = await get('/memory')
          if (活 && d) 设记统(d)
        })()
        return () => {
          活 = false
        }
      }, [])

      const 改配置 = (补) => {
        设态((旧) => (旧 ? { ...旧, 配置: { ...旧.配置, ...补 } } : 旧))
        设脏2(true)
      }

      const 拉记忆 = async () => {
        const d = await get('/memory')
        if (d) 设记统(d)
      }

      const 确认 = (文) => {
        try {
          return typeof window !== 'undefined' && typeof window.confirm === 'function'
            ? window.confirm(文)
            : true
        } catch (e) {
          return true
        }
      }

      const 清本地记忆 = async (范围) => {
        const 聊天 = 范围 === 'chat' ? 记选 : ''
        if (范围 === 'chat' && !聊天) {
          设记说('先选一个聊天')
          return
        }
        if (
          !确认(
            范围 === 'all'
              ? '确定清空全部本地记忆？微信历史 / 笔记 / 联网摘要都会删掉，不能撤销。'
              : `确定清除「${聊天}」的本地记忆？`,
          )
        ) {
          return
        }
        设记忙(true)
        设记说('')
        const r = await post('/memory/clear', { 范围, 聊天 })
        设记说((r && (r.说 || (r.ok ? '清完了' : '清除失败'))) || '清除失败')
        设记忙(false)
        拉记忆()
      }

      // 图片管理：工作区 wechat-images/ + 图片记忆 JSON
      const [图库, 设图库] = React.useState([])
      const [图忙, 设图忙] = React.useState(false)
      const [图说, 设图说] = React.useState('')
      const 图已拉 = React.useRef(false)
      React.useEffect(() => {
        if (图已拉.current) return
        图已拉.current = true
        let 活 = true
        ;(async () => {
          const d = await get('/images')
          if (活 && d && d.ok) 设图库(Array.isArray(d.图片) ? d.图片 : [])
        })()
        return () => {
          活 = false
        }
      }, [])

      const 拉图库 = async () => {
        const d = await get('/images')
        if (d && d.ok) 设图库(Array.isArray(d.图片) ? d.图片 : [])
      }

      const 删图 = async (id, 全部) => {
        if (
          !确认(
            全部
              ? '确定删除全部图片？文件和图片记忆 JSON 会一起删，不能撤销。'
              : '确定删除这张图片？文件和图片记忆 JSON 会一起删。',
          )
        ) {
          return
        }
        设图忙(true)
        设图说('')
        const r = await post('/images/delete', 全部 ? { 全部: true } : { id })
        设图说((r && (r.说 || (r.ok ? '删好了' : '删除失败'))) || '删除失败')
        设图忙(false)
        拉图库()
      }

      const 存 = async () => {
        const 绑 = 态.配置.绑定 || []
        // 只填了半边（聊天名没填 / 会话没选）的行会被服务端丢掉 —— 先拦住，别无声消失
        const 缺 = 绑
          .map((b, i) => ({ i: i + 1, 空: !String(b.聊天 || '').trim() || !String(b.会话 || '').trim() }))
          .filter((x) => x.空)
        if (缺.length) {
          设说(`第 ${缺.map((x) => x.i).join('、')} 行还缺聊天名 / 会话 —— 补上再存，或者点「删」去掉这一行`)
          return
        }
        设忙(true)
        const r = await post('/save', 态.配置)
        if (r && r.ok) {
          设态(r)
          设脏2(false)
          设说(r.说 || '保存好了')
        } else {
          设说('保存失败：' + ((r && r.说) || '未知'))
        }
        设忙(false)
      }

      const 装依赖 = async () => {
        设忙(true)
        const r = await post('/bridge/install')
        设说((r && r.说) || '')
        设忙(false)
        拉()
      }

      const 起 = async () => {
        设忙(true)
        const r = await post('/bridge/start')
        设说((r && r.说) || '')
        设忙(false)
        拉()
      }

      const 停 = async () => {
        设忙(true)
        const r = await post('/bridge/stop')
        设说((r && r.说) || '')
        设忙(false)
        拉()
      }

      const 测发 = async () => {
        设忙(true)
        const r = await post('/test-send', {})
        设说((r && r.说) || '')
        设忙(false)
      }

      const 测收 = async () => {
        设忙(true)
        const r = await post('/test-inbound', {})
        设说((r && r.说) || '')
        设忙(false)
      }

      const 让她说 = async () => {
        设忙(true)
        const r = await post('/speak-now', {})
        设说((r && r.说) || '')
        设忙(false)
      }

      if (!态) return h('div', { style: S.wrap }, '读取中…')

      const 配置 = 态.配置 || {}
      const 桥 = 态.桥接 || {}
      const 温度值 = (() => {
        const n = Number(配置.温度)
        return Number.isFinite(n) ? Math.max(0, Math.min(1, Math.round(n * 10) / 10)) : 0.5
      })()
      const 温度说明 =
        温度值 <= 0
          ? '主动发起对话'
          : 温度值 < 0.5
            ? '偏主动'
            : 温度值 === 0.5
              ? '正常对话'
              : 温度值 < 1
                ? '偏被动'
                : '消极但不沉默'
      // 绑定下拉要能选到「持久化过但没打开」的会话，否则只能把多个聊天
      // 绑到当前开着的那一间上（回复会只发回其中一个）。
      const 会话们 = 态.可选会话 || 态.活着的会话 || []
      const 绑定 = 配置.绑定 || []
      const 会话重复 = 绑定
        .map((b) => String((b && b.会话) || '').trim())
        .filter((v, i, arr) => v && arr.indexOf(v) !== i)
      const 屏蔽 = 配置.屏蔽 || []
      const 只听 = 配置.只听 || []

      // 「不回谁」：一条一条加、点 × 放出来。以前是个整块 textarea，
      // 打字打到一半就被轮询冲掉，所以怎么都加不进去。
      const 加屏蔽 = () => {
        const 名 = 新屏蔽.trim()
        if (!名) return
        设新屏蔽('')
        if (屏蔽.includes(名)) return
        改配置({ 屏蔽: 屏蔽.concat([名]) })
      }
      const 删屏蔽 = (名) => 改配置({ 屏蔽: 屏蔽.filter((x) => x !== 名) })

      // 「只听这些会话」：名单空 = 全部；填了就只读名单里的（显示名 / wxid / 群 id 都认）
      const 加只听 = () => {
        const 名 = 新只听.trim()
        if (!名) return
        设新只听('')
        if (只听.includes(名)) return
        改配置({ 只听: 只听.concat([名]) })
      }
      const 删只听 = (名) => 改配置({ 只听: 只听.filter((x) => x !== 名) })

      const 联网搜索 = async () => {
        const q = 网搜词.trim()
        if (!q) return
        设网搜中(true)
        设网搜结果(null)
        设网搜说明('')
        const r = await post('/web-search', {
          query: q,
          limit: 网搜条数,
          save: 网搜保存,
          fetch: 网搜抓取,
        })
        if (r && r.ok) {
          if (r.group) {
            设网搜组((旧) => [r.group, ...(旧 || []).filter((g) => g.id !== r.group.id)].slice(0, 5))
          }
          设网搜说明(r.说 || '')
        } else {
          设网搜结果(r || { ok: false, 说: '设置页没有响应' })
        }
        设网搜中(false)
      }

      const 改关键词权重 = (组id, 关键词, 值) => {
        设网搜组((旧) =>
          (旧 || []).map((g) =>
            g.id === 组id
              ? {
                  ...g,
                  keywords: (g.keywords || []).map((k) =>
                    k.keyword === 关键词 ? { ...k, weight: 值 } : k,
                  ),
                }
              : g,
          ),
        )
      }

      const 存关键词权重 = async (g) => {
        const weights = {}
        for (const k of g.keywords || []) weights[k.keyword] = k.weight
        const r = await post('/web-search/weights', { group: g.id, weights })
        设网搜说明(r && r.ok ? r.说 || '关键词权重已保存' : '保存权重失败：' + ((r && r.说) || '未知'))
      }

      const 会话下拉 = (值, 改, 允许空) => {
        const 中 = 会话们.find((x) => 键(x.id) === 键(值))
        return h(
          'select',
          {
            style: { ...S.input, minWidth: 280 },
            value: 中 ? 中.id : 值 || '',
            onChange: (e) => 改(e.target.value),
          },
          允许空 ? h('option', { value: '' }, '（不选）') : null,
          会话们.map((s) =>
            h('option', { key: s.id, value: s.id },
              (s.标题 || '（没标题）') + '  ·  ' + String(s.id).slice(-8)
                + (s.活着 === false ? '（未打开，发送时会自动唤醒）' : '')),
          ),
          !中 && 值 ? h('option', { value: 值 }, '（已不活）' + String(值).slice(-8)) : null,
        )
      }

      const 页签样式 = (开) => ({
        ...S.btn(false),
        fontSize: 12.5,
        opacity: 开 ? 1 : 0.6,
        borderColor: 开 ? 'var(--dsw-alias-state-business-primary)' : 'var(--dsw-alias-border-l2)',
        fontWeight: 开 ? 600 : 400,
      })

      const 查更新 = async () => {
        设查中(true)
        const d = await get('/check-update')
        设更新(d || { ok: false, 说: '没拿到结果' })
        设查中(false)
      }

      const 关于内容 = () =>
        h(
          'div',
          { style: { ...S.card, marginTop: 12, lineHeight: 1.7 } },
          h('div', { style: { fontSize: 14, fontWeight: 700 } }, '通到微信 · v' + (态.版本 || '?')),
          h(
            'div',
            { style: { ...S.dim, marginTop: 6, marginBottom: 10 } },
            '把 DSH 里的 AI 伙伴和微信打通：读微信本地库收消息、UI 自动化发消息，支持收图看表情包、群聊上下文与日记、主人权限、群回复频率。不注入、不 hook、不改微信。',
          ),
          h(
            'div',
            { style: { ...S.row, marginTop: 4 } },
            h('button', { style: S.btn(true), disabled: 查中, onClick: 查更新 }, 查中 ? '查着…' : '检查更新'),
          ),
          h(
            'div',
            { style: { display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 12 } },
            h(
              'a',
              {
                href: 'https://github.com/K2I2Gary/ds-wechatbridge',
                target: '_blank',
                rel: 'noreferrer',
                style: { color: 'var(--dsw-alias-state-business-primary)', fontSize: 12.5 },
              },
              '⭐ 去 GitHub 点个 Star',
            ),
            h(
              'a',
              {
                href: 'https://space.bilibili.com/366416862',
                target: '_blank',
                rel: 'noreferrer',
                style: { color: 'var(--dsw-alias-state-business-primary)', fontSize: 12.5 },
              },
              '📺 B 站：关注「你若化成冰」',
            ),
          ),
          更新
            ? h(
                'div',
                { style: { ...S.dim, marginTop: 8 } },
                更新.ok
                  ? 更新.有更新
                    ? '有新版本：v' + 更新.最新 + '（你现在 v' + 更新.当前 + '）。更新方式：在 profile 目录跑一次 pnpm add github:K2I2Gary/ds-wechatbridge，再重启 DSH。'
                    : '已经是最新版本：v' + 更新.当前
                  : '没查成：' + (更新.说 || ''),
              )
            : null,
          h(
            'div',
            { style: { ...S.dim, marginTop: 14, fontSize: 11.5, lineHeight: 1.7 } },
            '致谢：Python 那半的思路来自 wechatauto-replica；界面与宿主这半是为 DSH 重写的。',
          ),
        )

      // ---------- 小部件 ----------
      const 行 = (标, ...控) =>
        h('div', { style: S.row }, h('span', { style: S.lab }, 标), ...控)
      const 提示 = (文) => h('div', { style: S.hint }, 文)
      const 小标题 = (文) => h('div', { style: S.sub }, 文)
      const 折叠 = (标, ...内) =>
        h(
          'details',
          { style: S.fold },
          h('summary', { style: S.sum }, 标),
          h('div', { style: { paddingTop: 6 } }, ...内),
        )
      const 状态点 = (开, 文) => h('span', { style: 开 ? S.chipOn : S.chip }, 文)

      return h(
        'div',
        { style: S.wrap },

        // ---------- 顶部 ----------
        h(
          'div',
          { style: S.head },
          h('div', { style: S.title }, '通到微信'),
          h('span', { style: S.dim }, 'v' + (态.版本 || '?')),
          状态点(桥.运行中, 桥.运行中 ? '桥接在跑' : '桥接没跑'),
          h('span', { style: S.dim }, 'DSH ' + (态.DSH地址 || '?')),
        ),
        h('div', { style: S.dim }, '读微信本地库收消息、UI 自动化发消息。不注入、不 hook、不改微信。'),

        // ---------- 页签 ----------
        h(
          'div',
          { style: S.tabs },
          h('button', { style: 页签样式(视图 === '设置'), onClick: () => 设视图('设置') }, '设置'),
          h('button', { style: 页签样式(视图 === '关于'), onClick: () => 设视图('关于') }, '关于'),
        ),

        视图 === '关于'
          ? 关于内容()
          : h(
              'div',
              { style: { display: 'contents' } },

              // ---------- 保存条 ----------
              h(
                'div',
                { style: S.toolbar },
                h('button', { style: S.btn(脏), disabled: 忙 || !脏, onClick: 存 }, 脏 ? '保存设置' : '已保存'),
                h('span', { style: S.dim }, 脏 ? '有未保存的改动' : '所有改动已保存'),
                说 ? h('span', { style: S.dim }, 说) : null,
              ),

              // ---------- 一、连接与启动 ----------
              h('div', { style: S.h }, '连接与启动'),
              h(
                'div',
                { style: S.card },
                h(
                  'div',
                  { style: S.chips },
                  状态点(桥.python, 桥.python ? '✓ 自动化库' : '— 自动化库'),
                  状态点(桥.venv就绪, 桥.venv就绪 ? '✓ 虚拟环境' : '— 虚拟环境'),
                  状态点(桥.运行中, 桥.运行中 ? '✓ 桥接运行中' : '— 桥接已停止'),
                ),
                h(
                  'div',
                  { style: S.row },
                  h(
                    'button',
                    { style: S.btn(true), disabled: 忙 || 桥.安装?.进行中, onClick: 装依赖 },
                    桥.安装?.进行中 ? '正在装…' : '装依赖',
                  ),
                  h('button', { style: S.btn(true), disabled: 忙 || 桥.运行中 || !桥.python, onClick: 起 }, '启动'),
                  h('button', { style: S.btn(false), disabled: 忙 || !桥.运行中, onClick: 停 }, '停止'),
                  h(
                    'span',
                    { style: S.dim },
                    桥.运行中 ? '日志在「测试与日志」里' : 桥.python ? '可以启动了' : '先装依赖，或填一个解释器',
                  ),
                ),
                行(
                  '微信语言',
                  h(
                    'select',
                    {
                      style: { ...S.input, minWidth: 180 },
                      value: 配置.微信语言 || '自动',
                      onChange: (e) => 改配置({ 微信语言: e.target.value }),
                    },
                    h('option', { value: '自动' }, '自动检测（推荐）'),
                    h('option', { value: '中文' }, '中文版微信'),
                    h('option', { value: '英文' }, '英文版微信（English）'),
                  ),
                  h('span', { style: S.dim }, '自动识别；搜不到会话 / 搜索框时手动指定'),
                ),
                折叠(
                  '高级：解释器 / 安装日志 / 进程日志',
                  行(
                    '解释器（可选）',
                    h('input', {
                      style: { ...S.input, width: 380 },
                      value: 配置.解释器 || '',
                      placeholder: '留空 = 自动找；或填一个已装好 wechatauto 的 python.exe',
                      onChange: (e) => 改配置({ 解释器: e.target.value }),
                    }),
                  ),
                  h('div', { style: S.hint }, '实际在用的：' + (桥.python || '（还没有）')),
                  桥.安装?.进行中 || 桥.安装?.日志?.length
                    ? h(
                        'div',
                        null,
                        h('div', { style: { ...S.dim, marginBottom: 4 } }, '进度：' + (桥.安装?.步骤 || '')),
                        h('div', { style: S.pre }, (桥.安装?.日志 || []).join('\n') || '（还没输出）'),
                      )
                    : null,
                  桥.安装?.失败 ? h('div', { style: { ...S.bad, marginTop: 6 } }, '失败：' + 桥.安装.失败) : null,
                  h('div', { style: { ...S.dim, marginTop: 8, marginBottom: 4 } }, '桥接进程日志'),
                  h('div', { style: S.pre }, (桥.进程日志 || []).join('\n') || '（还没输出）'),
                ),
              ),

              // ---------- 二、接收与绑定 ----------
              h('div', { style: S.h }, '接收与绑定'),
              h(
                'div',
                { style: S.card },
                行('总开关', 开关(配置.总开关, (v) => 改配置({ 总开关: v })), h('span', { style: S.dim }, '关着 = 一句都不发')),
                行('试运行', 开关(配置.试运行, (v) => 改配置({ 试运行: v })), h('span', { style: S.dim }, '开着 = 只在日志里记「该发什么」，不真发')),
                行('默认会话', 会话下拉(配置.默认会话, (v) => 改配置({ 默认会话: v }), true)),
                提示('微信里来的消息默认进这一间；没单独绑定的聊天都走它。'),

                小标题('只听这些会话'),
                提示(
                  '留空 = 微信里所有会话都听；填了（微信显示名 / wxid / xxx@chatroom）就只读这些 —— '
                    + '名单外的会话不进 DSH、不下载图片、不写群日记，也不回。',
                ),
                h(
                  'div',
                  { style: { ...S.row, marginTop: 6 } },
                  h('input', {
                    style: { ...S.input, width: 300 },
                    list: 'wx-chat-names',
                    value: 新只听,
                    placeholder: '会话名 / wxid / 群名（回车加上）',
                    onChange: (e) => 设新只听(e.target.value),
                    onKeyDown: (e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        加只听()
                      }
                    },
                  }),
                  h('button', { style: S.btn(false), onClick: 加只听 }, '加进名单'),
                  h('span', { style: S.dim }, 只听.length ? `现在只听这 ${只听.length} 个` : '现在：全部会话'),
                ),
                h(
                  'div',
                  { style: { display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 } },
                  只听.length
                    ? 只听.map((名, i) =>
                        h(
                          'span',
                          { key: 名 + i, style: S.tag },
                          名,
                          h('button', { style: S.tagX, title: '不再只听它', onClick: () => 删只听(名) }, '×'),
                        ),
                      )
                    : h('span', { style: S.dim }, '（空 —— 全部会话都听）'),
                ),
                (态.最近聊天 || []).length
                  ? h(
                      'div',
                      { style: { marginTop: 8 } },
                      h('div', { style: S.hint }, '最近来找过的（点一下加入 / 移出「只听」）：'),
                      h(
                        'div',
                        { style: { display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 } },
                        (态.最近聊天 || []).slice(0, 12).map((x) => {
                          const 在 = 只听.includes(x.名) || (x.id && 只听.includes(x.id))
                          return h(
                            'button',
                            {
                              key: x.名,
                              'data-wx-listen': x.名,
                              style: { ...S.btn(false), padding: '2px 8px', opacity: 在 ? 1 : 0.75 },
                              title: `${x.类型 || ''}${x.id ? ' · ' + x.id : ''}`,
                              onClick: () =>
                                改配置({
                                  只听: 在
                                    ? 只听.filter((y) => y !== x.名 && y !== x.id)
                                    : 只听.concat([x.名]),
                                }),
                            },
                            (在 ? '✓ ' : '＋ ') + x.名,
                          )
                        }),
                      ),
                    )
                  : null,

                h(
                  'datalist',
                  { id: 'wx-chat-names' },
                  (态.最近聊天 || []).map((x, i) => h('option', { key: i, value: x.名 }, x.类型 || '')),
                ),

                小标题('单独绑定（可选）'),
                提示('一行 = 一个微信聊天 → 一间会话。左边填微信里显示的名字；改过备注也认 wxid。'),
                绑定.map((b, i) => {
                  const 好 = (态.绑定情况 || []).find((x) => x.聊天 === b.聊天)
                  return h(
                    'div',
                    { key: i, style: { ...S.row, marginTop: 6, marginBottom: 0, alignItems: 'flex-start' } },
                    h(
                      'div',
                      { style: { display: 'flex', flexDirection: 'column', gap: 3 } },
                      h('input', {
                        style: { ...S.input, width: 200 },
                        list: 'wx-chat-names',
                        value: b.聊天,
                        placeholder: '微信聊天名',
                        onChange: (e) => {
                          const 新 = 绑定.map((x, j) => (j === i ? { ...x, 聊天: e.target.value } : x))
                          改配置({ 绑定: 新 })
                        },
                      }),
                      h(
                        'span',
                        { style: 好 ? S.ok : S.hint },
                        好
                          ? `已接上：${好.会话标题 || String(b.会话).slice(-8)}${好.活着 ? '' : '（那间现在没开）'}`
                          : b.聊天 && b.会话
                            ? '还没保存 —— 点「保存设置」'
                            : '还差聊天名 / 会话',
                      ),
                    ),
                    h('span', { style: S.dim }, '→'),
                    会话下拉(b.会话, (v) => {
                      const 新 = 绑定.map((x, j) => (j === i ? { ...x, 会话: v } : x))
                      改配置({ 绑定: 新 })
                    }, false),
                    h(
                      'button',
                      { style: S.btn(false), onClick: () => 改配置({ 绑定: 绑定.filter((_, j) => j !== i) }) },
                      '删',
                    ),
                  )
                }),
                会话重复.length
                  ? h(
                      'div',
                      { style: { ...S.bad, marginTop: 8, lineHeight: 1.6 } },
                      '⚠ 有两个聊天绑到了同一间会话 —— 回复只会发回其中一个。'
                        + '请给每个聊天选不同的会话（下拉里「未打开」的也可以选，桥接会自己唤醒）。',
                    )
                  : null,
                h(
                  'div',
                  { style: { marginTop: 8, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' } },
                  h(
                    'button',
                    {
                      style: S.btn(false),
                      onClick: () => 改配置({ 绑定: 绑定.concat([{ 聊天: '', 会话: 配置.默认会话 || '' }]) }),
                    },
                    '＋ 加一条绑定',
                  ),
                  h('span', { style: S.dim }, '加完要点「保存设置」才生效'),
                ),
                (态.最近聊天 || []).length
                  ? h(
                      'div',
                      { style: { marginTop: 10 } },
                      h('div', { style: S.hint }, '最近来找过的（点一下绑到默认会话，✓ 的再点一下解绑）：'),
                      h(
                        'div',
                        { style: { display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 } },
                        (态.最近聊天 || []).slice(0, 10).map((x) => {
                          const 已有 = 绑定.some((b) => b.聊天 === x.名)
                          return h(
                            'button',
                            {
                              key: x.名,
                              'data-wx-bind': x.名,
                              style: { ...S.btn(false), padding: '2px 8px', opacity: 已有 ? 0.55 : 1 },
                              title: `${x.类型 || ''}${x.id ? ' · ' + x.id : ''}`,
                              onClick: () =>
                                改配置({
                                  绑定: 绑定
                                    .filter((b) => b.聊天 !== x.名)
                                    .concat(已有 ? [] : [{ 聊天: x.名, 会话: 配置.默认会话 || '' }]),
                                }),
                            },
                            (已有 ? '✓ ' : '＋ ') + x.名,
                          )
                        }),
                      ),
                    )
                  : h('div', { style: S.hint }, '（等桥接跑起来、有人来找过我之后，这里会列出这些名字）'),

                小标题('不回谁（屏蔽）'),
                h(
                  'div',
                  { style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' } },
                  h('input', {
                    style: { ...S.input, width: 240 },
                    list: 'wx-chat-names',
                    value: 新屏蔽,
                    placeholder: '微信名 / 群名（回车也行）',
                    onChange: (e) => 设新屏蔽(e.target.value),
                    onKeyDown: (e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        加屏蔽()
                      }
                    },
                  }),
                  h('button', { style: S.btn(false), onClick: 加屏蔽 }, '加上'),
                  h('span', { style: S.dim }, `现在 ${屏蔽.length} 个`),
                ),
                h(
                  'div',
                  { style: { display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 } },
                  屏蔽.length
                    ? 屏蔽.map((名, i) =>
                        h(
                          'span',
                          { key: 名 + i, style: S.tag },
                          名,
                          h('button', { style: S.tagX, title: '放出来', onClick: () => 删屏蔽(名) }, '×'),
                        ),
                      )
                    : h('span', { style: S.dim }, '（空 —— 谁的都回）'),
                ),
                提示('这些人 / 群发消息不进对话、也不写群日记。改完点「保存设置」，桥接最多 30 秒认。'),

                折叠(
                  '高级：接口令牌',
                  行(
                    '接口令牌',
                    h('input', {
                      style: { ...S.input, width: 240 },
                      value: 配置.令牌 || '',
                      placeholder: '留空 = 不校验（只建议本机）',
                      onChange: (e) => 改配置({ 令牌: e.target.value }),
                    }),
                  ),
                ),
              ),

              // ---------- 三、人格与说话 ----------
              h('div', { style: S.h }, '人格与说话'),
              h(
                'div',
                { style: S.card },
                行(
                  '人格画像',
                  h('input', {
                    type: 'checkbox',
                    'data-wx-persona': '1',
                    checked: 配置.人格 !== false,
                    onChange: (e) => 改配置({ 人格: e.target.checked }),
                  }),
                  h('span', { style: S.dim }, '从本地文件读人设，注进微信消息里'),
                ),
                h(
                  'div',
                  {
                    style:
                      配置.人格 === false
                        ? S.dim
                        : 态.人格 && 态.人格.路径
                          ? S.ok
                          : S.bad,
                  },
                  配置.人格 === false
                    ? '人设关着'
                    : 态.人格 && 态.人格.路径
                      ? `已读：${态.人格.路径}（${(Number(态.人格.字节 || 0) / 1024).toFixed(1)} KB）`
                      : '没找到人格文件 —— 检查路径（留空会用插件目录的 humanity.txt / ~/.dsh/wechat-persona.txt）',
                ),
                行(
                  '对话温度',
                  h('input', {
                    type: 'range',
                    min: 0,
                    max: 1,
                    step: 0.1,
                    value: 温度值,
                    'data-wx-temp': '1',
                    style: { width: 240 },
                    onChange: (e) => 改配置({ 温度: Math.round(Number(e.target.value) * 10) / 10 }),
                  }),
                  h('span', { style: S.dim }, `${温度值.toFixed(1)} · ${温度说明}`),
                ),
                提示('0 = 主动发起话题；0.5 = 正常；1 = 被动但不沉默。同时作为采样 temperature 传给模型。'),
                行(
                  '主动搭话',
                  h('input', {
                    type: 'checkbox',
                    'data-wx-proactive': '1',
                    checked: 配置.主动搭话 !== false,
                    onChange: (e) => 改配置({ 主动搭话: e.target.checked }),
                  }),
                  h('span', { style: S.dim }, '温度 ≤ 0.1 时，没新消息就主动说一句'),
                  h('button', { style: S.btn(false), disabled: 忙 || !桥.运行中, onClick: 让她说 }, '现在就让她说一句'),
                ),
                行(
                  '空闲分钟 / 每小时上限',
                  h('input', {
                    style: { ...S.input, width: 80 },
                    type: 'number',
                    min: 1,
                    max: 1440,
                    'data-wx-proactivemin': '1',
                    value: 配置.主动搭话分钟 == null ? 30 : 配置.主动搭话分钟,
                    onChange: (e) => 改配置({ 主动搭话分钟: Number(e.target.value) || 30 }),
                  }),
                  h('span', { style: S.dim }, '分钟'),
                  h('input', {
                    style: { ...S.input, width: 80 },
                    type: 'number',
                    min: 0,
                    max: 20,
                    'data-wx-proactivehour': '1',
                    value: 配置.主动搭话每小时 == null ? 2 : 配置.主动搭话每小时,
                    onChange: (e) => 改配置({ 主动搭话每小时: Number(e.target.value) || 0 }),
                  }),
                  h('span', { style: S.dim }, '次/小时（0 = 不限）'),
                ),
                提示('只在温度 0 / 0.1 时生效；按绑定的聊天逐个开口（串行，不并发）。'),

                折叠(
                  '高级：人格文件 / 重提间隔 / 看图',
                  行(
                    '人格文件',
                    h('input', {
                      style: { ...S.input, width: 420 },
                      value: 配置.人格文件 || '',
                      placeholder: '留空 = 插件目录的 humanity.txt / ~/.dsh/wechat-persona.txt',
                      onChange: (e) => 改配置({ 人格文件: e.target.value }),
                    }),
                  ),
                  行(
                    '重提间隔',
                    h('input', {
                      style: { ...S.input, width: 80 },
                      type: 'number',
                      min: 1,
                      max: 100,
                      value: 配置.人格重提条数 == null ? 10 : 配置.人格重提条数,
                      onChange: (e) => 改配置({ 人格重提条数: Number(e.target.value) || 10 }),
                    }),
                    h('span', { style: S.dim }, '条微信消息重新注入一次'),
                  ),
                  行(
                    '识图',
                    开关(配置.看图 !== false, (v) => 改配置({ 看图: v })),
                    h('span', { style: S.dim }, '收到图片 / 表情包先让视觉模型看一遍'),
                  ),
                  行(
                    '视觉密钥',
                    h('input', {
                      style: { ...S.input, width: 300 },
                      type: 'password',
                      value: 配置.视觉密钥 || '',
                      placeholder: '留空 = 用环境变量 / 鲸鱼娘设置里的 DeepSeek key',
                      onChange: (e) => 改配置({ 视觉密钥: e.target.value }),
                    }),
                  ),
                  行(
                    '视觉模型',
                    h('input', {
                      style: { ...S.input, width: 200 },
                      value: 配置.视觉模型 || 'deepseek-flash',
                      onChange: (e) => 改配置({ 视觉模型: e.target.value }),
                    }),
                    h('span', { style: S.dim }, '默认 deepseek-flash，支持 GIF'),
                  ),
                  行(
                    '备用视觉密钥（智谱）',
                    h('input', {
                      style: { ...S.input, width: 300 },
                      type: 'password',
                      value: 配置.视觉备用密钥 || '',
                      placeholder: '可选：DeepSeek 看失败时退到 glm-4v-flash',
                      onChange: (e) => 改配置({ 视觉备用密钥: e.target.value }),
                    }),
                  ),
                  提示('同一张图按内容哈希缓存，只花一次钱；没配密钥也不会挡消息，只是标一句「没看清」。'),
                ),
              ),

              // ---------- 四、群聊与记忆 ----------
              h('div', { style: S.h }, '群聊与记忆'),
              h(
                'div',
                { style: S.card },
                行(
                  '群上下文条数',
                  h('input', {
                    style: { ...S.input, width: 90 },
                    type: 'number',
                    min: 0,
                    max: 50,
                    value: 配置.群上下文条数 == null ? 6 : 配置.群上下文条数,
                    onChange: (e) => 改配置({ 群上下文条数: Number(e.target.value) || 0 }),
                  }),
                  h('span', { style: S.dim }, '被叫到时，往前带几条群聊天给模型看（0 = 不带）'),
                ),
                行(
                  '历史记忆（RAG）',
                  h('input', {
                    type: 'checkbox',
                    'data-wx-rag': '1',
                    checked: 配置.RAG !== false,
                    onChange: (e) => 改配置({ RAG: e.target.checked }),
                  }),
                  h('span', { style: S.dim }, '收到消息时，在当前会话的历史里找相关的旧消息一起给模型看'),
                ),
                行(
                  '检索条数 / 天数',
                  h('input', {
                    style: { ...S.input, width: 80 },
                    type: 'number',
                    min: 0,
                    max: 20,
                    'data-wx-ragcount': '1',
                    value: 配置.RAG条数 == null ? 5 : 配置.RAG条数,
                    onChange: (e) => 改配置({ RAG条数: Number(e.target.value) || 0 }),
                  }),
                  h('span', { style: S.dim }, '条'),
                  h('input', {
                    style: { ...S.input, width: 80 },
                    type: 'number',
                    min: 1,
                    max: 365,
                    'data-wx-ragdays': '1',
                    value: 配置.RAG天数 == null ? 30 : 配置.RAG天数,
                    onChange: (e) => 改配置({ RAG天数: Number(e.target.value) || 30 }),
                  }),
                  h('span', { style: S.dim }, '天（0 条 = 关；只查当前会话）'),
                ),
                行(
                  '群回复频率',
                  h('input', {
                    style: { ...S.input, width: 80 },
                    type: 'number',
                    min: 0,
                    value: 配置.群回复间隔秒 == null ? 30 : 配置.群回复间隔秒,
                    onChange: (e) => 改配置({ 群回复间隔秒: Number(e.target.value) || 0 }),
                  }),
                  h('span', { style: S.dim }, '秒内不重复接'),
                  h('input', {
                    style: { ...S.input, width: 80 },
                    type: 'number',
                    min: 0,
                    value: 配置.群每小时上限 == null ? 6 : 配置.群每小时上限,
                    onChange: (e) => 改配置({ 群每小时上限: Number(e.target.value) || 0 }),
                  }),
                  h('span', { style: S.dim }, '条/小时（都填 0 = 不限）'),
                ),

                小标题('清除上下文记忆'),
                h(
                  'div',
                  { style: S.hint },
                  记统 && 记统.ok === false
                    ? `读不到本地记忆：${记统.说 || '未知'}`
                    : 记统
                      ? `本地记忆库：${记统.消息 || 0} 条微信消息 / ${记统.笔记 || 0} 条笔记 / ${记统.联网 || 0} 条联网摘要`
                      : '正在读本地记忆库…',
                ),
                h(
                  'div',
                  { style: { ...S.row, marginTop: 6 } },
                  h(
                    'select',
                    {
                      style: { ...S.input, minWidth: 240 },
                      'data-wx-memchat': '1',
                      value: 记选,
                      onChange: (e) => 设记选(e.target.value),
                    },
                    h('option', { value: '' }, '（选一个聊天）'),
                    ((记统 && Array.isArray(记统.聊天) ? 记统.聊天 : [])).map((x) =>
                      h('option', { key: x.chat, value: x.chat }, `${x.chat} · ${x.n} 条`),
                    ),
                  ),
                  h(
                    'button',
                    {
                      style: S.btn(false),
                      'data-wx-memclear': 'chat',
                      disabled: 记忙 || !记选,
                      onClick: () => 清本地记忆('chat'),
                    },
                    '清除这个聊天的记忆',
                  ),
                  h(
                    'button',
                    {
                      style: { ...S.btn(false), color: '#c0392b' },
                      'data-wx-memclear': 'all',
                      disabled: 记忙,
                      onClick: () => 清本地记忆('all'),
                    },
                    '清空全部本地记忆',
                  ),
                  h('button', { style: S.btn(false), disabled: 记忙, onClick: 拉记忆 }, 记忙 ? '处理中…' : '刷新'),
                ),
                记说 ? h('div', { style: S.dim }, 记说) : null,
                提示(
                  '只清本地库里的微信历史 / 笔记 / 联网摘要，不动微信自己的数据库；'
                    + '清完 RAG 和 local_search 会从空开始，下一条新消息会重新入库。',
                ),
                行(
                  '外人只能聊天',
                  开关(配置.外人只能聊天, (v) => 改配置({ 外人只能聊天: v })),
                  h('span', { style: S.dim }, '只有「主人」能动电脑；别人发的那一轮，工具会被硬拦'),
                ),
                行(
                  '群聊日记',
                  开关(配置.日记, (v) => 改配置({ 日记: v })),
                  h('span', { style: S.dim }, '把群里的对话按天写成 markdown（不点名的也记）'),
                ),
                行(
                  '日记目录',
                  h('input', {
                    style: { ...S.input, width: 380 },
                    value: 配置.日记目录 || '',
                    placeholder: '留空 = ~/.dsh/wechat-diary',
                    onChange: (e) => 改配置({ 日记目录: e.target.value }),
                  }),
                ),
                行(
                  '主人',
                  h('input', {
                    style: { ...S.input, width: 380 },
                    value: (配置.主人 || []).join(', '),
                    placeholder: 'wxid_xxx 或昵称，逗号分隔；主人说话不点名也进',
                    onChange: (e) =>
                      改配置({
                        主人: e.target.value
                          .split(/[,，]/)
                          .map((s) => s.trim())
                          .filter(Boolean),
                      }),
                  }),
                ),
                提示('@ 会解析成「谁 @ 了谁」：正文保留 @昵称，@你 / @所有人 会额外标注，模型能看出是在叫它。'),

                折叠(
                  '高级：本地知识库 / 联网搜索参数',
                  行(
                    '启用本地库',
                    h('input', {
                      type: 'checkbox',
                      'data-wx-localkb': '1',
                      checked: 配置.本地库 !== false,
                      onChange: (e) => 改配置({ 本地库: e.target.checked }),
                    }),
                    h('span', { style: S.dim }, '微信历史 + 笔记，模型用 local_search 工具查'),
                  ),
                  行(
                    '笔记目录',
                    h('input', {
                      style: { ...S.input, width: 420 },
                      value: 配置.笔记目录 || '',
                      placeholder: '留空 = ~/.dsh/wechat-bridge-notes',
                      onChange: (e) => 改配置({ 笔记目录: e.target.value }),
                    }),
                  ),
                  行(
                    '本地库文件',
                    h('input', {
                      style: { ...S.input, width: 420 },
                      value: 配置.本地库文件 || '',
                      placeholder: '留空 = ~/.dsh/wechat-bridge-memory.db',
                      onChange: (e) => 改配置({ 本地库文件: e.target.value }),
                    }),
                  ),
                  行(
                    '回填天数 / 每聊条数',
                    h('input', {
                      style: { ...S.input, width: 90 },
                      type: 'number',
                      min: 1,
                      max: 3650,
                      value: 配置.本地库天数 == null ? 180 : 配置.本地库天数,
                      onChange: (e) => 改配置({ 本地库天数: Number(e.target.value) || 180 }),
                    }),
                    h('span', { style: S.dim }, '天'),
                    h('input', {
                      style: { ...S.input, width: 90 },
                      type: 'number',
                      min: 10,
                      max: 5000,
                      value: 配置.本地库每聊条数 == null ? 500 : 配置.本地库每聊条数,
                      onChange: (e) => 改配置({ 本地库每聊条数: Number(e.target.value) || 500 }),
                    }),
                    h('span', { style: S.dim }, '条/聊天'),
                  ),
                  行(
                    '联网搜索',
                    h('input', {
                      type: 'checkbox',
                      'data-wx-websearch': '1',
                      checked: 配置.联网搜索 !== false,
                      onChange: (e) => 改配置({ 联网搜索: e.target.checked }),
                    }),
                    h('span', { style: S.dim }, '关键词搜索可联网抓取并写入本地库'),
                  ),
                  行(
                    '搜索地址 / 密钥',
                    h('input', {
                      style: { ...S.input, width: 360 },
                      value: 配置.搜索地址 || '',
                      placeholder: '默认 https://api.tavily.com/search',
                      onChange: (e) => 改配置({ 搜索地址: e.target.value }),
                    }),
                    h('input', {
                      style: { ...S.input, width: 240 },
                      type: 'password',
                      value: 配置.搜索密钥 || '',
                      placeholder: '留空 = DuckDuckGo 兜底',
                      onChange: (e) => 改配置({ 搜索密钥: e.target.value }),
                    }),
                  ),
                  行(
                    '搜索条数 / 关键词条数',
                    h('input', {
                      style: { ...S.input, width: 80 },
                      type: 'number',
                      min: 1,
                      max: 10,
                      value: 配置.搜索条数 == null ? 5 : 配置.搜索条数,
                      onChange: (e) => 改配置({ 搜索条数: Number(e.target.value) || 5 }),
                    }),
                    h('span', { style: S.dim }, '条'),
                    h('input', {
                      style: { ...S.input, width: 80 },
                      type: 'number',
                      min: 1,
                      max: 5,
                      value: 配置.关键词条数 == null ? 5 : 配置.关键词条数,
                      onChange: (e) => 改配置({ 关键词条数: Number(e.target.value) || 5 }),
                    }),
                    h('span', { style: S.dim }, '条（注意力 Top，最多 5）'),
                  ),
                  提示(
                    '桥接启动后在后台索引「只听」里的微信历史；笔记目录里的 .md/.txt 每 5 分钟扫一次。'
                      + '把资料丢进 '
                      + ((态.本地库 && 态.本地库.笔记目录) || '~/.dsh/wechat-bridge-notes')
                      + '，再跟伙伴说「搜一下本地笔记」或「联网搜一下…」。',
                  ),
                ),
              ),

              // ---------- 五、图片管理 ----------
              h('div', { style: S.h }, '图片管理'),
              h(
                'div',
                { style: S.card },
                h(
                  'div',
                  { style: S.row },
                  h('span', { style: S.dim }, 图库.length ? `共 ${图库.length} 张` : '还没有图片'),
                  h('button', { style: S.btn(false), disabled: 图忙, onClick: 拉图库 }, '刷新'),
                  h(
                    'button',
                    {
                      style: { ...S.btn(false), color: '#c0392b' },
                      'data-wx-imgclear': '1',
                      disabled: 图忙 || !图库.length,
                      onClick: () => 删图(null, true),
                    },
                    '清空全部',
                  ),
                ),
                图说 ? h('div', { style: S.dim }, 图说) : null,
                图库.length
                  ? h(
                      'div',
                      { style: S.gallery },
                      图库.slice(0, 120).map((x) =>
                        h(
                          'div',
                          { key: x.id, style: S.imageCard },
                          x.存在
                            ? h('img', {
                                src: B + '/image?path=' + encodeURIComponent(x.文件) + '&t=' + (x.修改 || 0),
                                style: S.thumb,
                                alt: x.描述 || '',
                              })
                            : h(
                                'div',
                                { style: { ...S.thumb, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, opacity: 0.6 } },
                                '文件不在',
                              ),
                          h('div', { style: S.imageDesc }, x.描述 || '（没描述）'),
                          h('div', { style: S.hint }, `${x.聊天 || '?'} · ${x.发送人 || '?'} · ${x.时间 || ''}`),
                          h(
                            'div',
                            { style: { ...S.row, marginTop: 4, marginBottom: 0 } },
                            h(
                              'button',
                              { style: S.btn(false), disabled: 图忙, 'data-wx-imgdel': x.id, onClick: () => 删图(x.id) },
                              '删除',
                            ),
                          ),
                        ),
                      ),
                    )
                  : h(
                      'div',
                      { style: S.hint },
                      '微信里收到图片 / 表情包后，会复制到会话工作区的 wechat-images/ 并出现在这里。',
                    ),
                h(
                  'div',
                  { style: S.hint },
                  '删除会同时删掉文件、~/.dsh/wechat-inbound 里的原文件，以及 wechat-image-memory.json 里的记录。'
                    + 'GIF 发到微信时受剪贴板位图限制只会发第一帧，原文件会保留在这里。',
                ),
              ),

              // ---------- 六、联网搜索（独立） ----------
              h('div', { style: S.h }, '联网搜索（独立）'),
              h(
                'div',
                { style: S.card },
                h(
                  'div',
                  { style: { ...S.row, marginBottom: 6 } },
                  h('input', {
                    style: { ...S.input, width: 360 },
                    value: 网搜词,
                    placeholder: '搜索内容，如：DeepSeek 最新发布',
                    'data-wx-webquery': '1',
                    onChange: (e) => 设网搜词(e.target.value),
                    onKeyDown: (e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        联网搜索()
                      }
                    },
                  }),
                  h('input', {
                    style: { ...S.input, width: 80 },
                    type: 'number',
                    min: 1,
                    max: 10,
                    value: 网搜条数,
                    onChange: (e) => 设网搜条数(Number(e.target.value) || 5),
                  }),
                  h('span', { style: S.dim }, '条'),
                  h(
                    'label',
                    { style: { display: 'flex', gap: 6, alignItems: 'center', fontSize: 12.5 } },
                    h('input', {
                      type: 'checkbox',
                      checked: 网搜保存,
                      onChange: (e) => 设网搜保存(e.target.checked),
                    }),
                    '保存到本地',
                  ),
                  h(
                    'label',
                    { style: { display: 'flex', gap: 6, alignItems: 'center', fontSize: 12.5 } },
                    h('input', {
                      type: 'checkbox',
                      'data-wx-webfetch': '1',
                      checked: 网搜抓取,
                      onChange: (e) => 设网搜抓取(e.target.checked),
                    }),
                    '抓网页关键词',
                  ),
                  h(
                    'button',
                    {
                      style: S.btn(true),
                      disabled: 网搜中,
                      'data-wx-websearchbtn': '1',
                      onClick: 联网搜索,
                    },
                    网搜中 ? '搜索中…' : '搜索',
                  ),
                ),
                h(
                  'div',
                  { style: S.hint },
                  '不需要启动桥接。勾选「抓网页关键词」会抓结果页正文，每次搜索存成一组；'
                    + '关键词权重可调，会参与 keyword_search 的注意力排序。'
                    + '结果会保存到「笔记目录/web/」并写入本地库（如果开着）；没填搜索密钥会退 DuckDuckGo。',
                ),
                网搜结果 && !网搜结果.ok ? h('div', { style: S.bad }, '搜索失败：' + (网搜结果.说 || '未知')) : null,
                网搜说明 ? h('div', { style: S.dim }, 网搜说明) : null,
                (网搜组 || []).map((g) => {
                  const 图词 = (g.keywords || [])
                    .slice()
                    .sort((a, b) => (Number(b.weight) || 0) - (Number(a.weight) || 0))
                    .slice(0, 10)
                  const 最大 = Math.max(1, ...图词.map((k) => Number(k.weight) || 0))
                  return h(
                    'div',
                    { key: g.id, style: { ...S.card, marginTop: 10 } },
                    h(
                      'div',
                      { style: S.row },
                      h('strong', null, g.query || '（无查询）'),
                      h('span', { style: S.dim }, g.ts ? new Date(g.ts * 1000).toLocaleString() : ''),
                      h('button', { style: S.btn(false), onClick: () => 存关键词权重(g) }, '保存关键词权重'),
                    ),
                    g.saved_json ? h('div', { style: S.hint }, '信息要点 JSON：' + g.saved_json) : null,
                    图词.length
                      ? h(
                          'div',
                          { style: { marginTop: 8 } },
                          h(
                            'div',
                            { style: { ...S.hint, marginBottom: 4 } },
                            '关键词权重（条形越长权重越高，Top 10）',
                          ),
                          h(
                            'div',
                            { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
                            图词.map((k) => {
                              const w = Number(k.weight) || 0
                              const pct = w > 0 ? Math.max(1.5, (w / 最大) * 100) : 0
                              return h(
                                'div',
                                {
                                  key: k.keyword,
                                  title: `${k.keyword}：权重 ${w.toFixed(1)}，出现 ${k.count || 1} 次`,
                                  style: { display: 'flex', alignItems: 'center', gap: 8, minHeight: 18 },
                                },
                                h(
                                  'span',
                                  {
                                    style: {
                                      width: 110,
                                      fontSize: 11.5,
                                      overflow: 'hidden',
                                      textOverflow: 'ellipsis',
                                      whiteSpace: 'nowrap',
                                      opacity: 0.85,
                                    },
                                  },
                                  k.keyword,
                                ),
                                h(
                                  'div',
                                  {
                                    style: {
                                      flex: 1,
                                      height: 10,
                                      background: 'rgba(127,127,127,.18)',
                                      borderRadius: 4,
                                      overflow: 'hidden',
                                    },
                                  },
                                  h('div', {
                                    style: {
                                      width: pct + '%',
                                      height: '100%',
                                      background: 'var(--dsw-alias-state-business-primary, #2a78d6)',
                                      borderRadius: '0 4px 4px 0',
                                    },
                                  }),
                                ),
                                h(
                                  'span',
                                  {
                                    style: {
                                      width: 42,
                                      textAlign: 'right',
                                      fontSize: 11,
                                      fontVariantNumeric: 'tabular-nums',
                                      opacity: 0.8,
                                    },
                                  },
                                  w.toFixed(1),
                                ),
                                h(
                                  'span',
                                  { style: { width: 34, textAlign: 'right', fontSize: 10.5, opacity: 0.5 } },
                                  `×${k.count || 1}`,
                                ),
                              )
                            }),
                          ),
                        )
                      : null,
                    h(
                      'div',
                      { style: { display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 } },
                      (g.keywords || []).length
                        ? (g.keywords || []).map((k) =>
                            h(
                              'span',
                              { key: k.keyword, style: S.tag },
                              k.keyword,
                              h('input', {
                                type: 'number',
                                min: 0,
                                max: 10,
                                step: 0.1,
                                value: k.weight == null ? 1 : k.weight,
                                style: { width: 56, fontSize: 12 },
                                onChange: (e) =>
                                  改关键词权重(g.id, k.keyword, Number(e.target.value) || 0),
                              }),
                              h('span', { style: { ...S.dim, fontSize: 10.5 } }, `×${k.count || 1}`),
                            ),
                          )
                        : h('span', { style: S.dim }, '（没有提取到关键词）'),
                    ),
                    h(
                      'div',
                      { style: S.pre },
                      (g.results || [])
                        .map(
                          (x, i) =>
                            `${i + 1}. ${x.title || ''}\n${x.url || ''}\n${String(x.content || '').slice(0, 240)}`,
                        )
                        .join('\n\n') || '（没有结果）',
                    ),
                  )
                }),
              ),

              // ---------- 六、测试与日志 ----------
              h('div', { style: S.h }, '测试与日志'),
              h(
                'div',
                { style: S.card },
                h(
                  'div',
                  { style: S.row },
                  h('button', { style: S.btn(false), disabled: 忙, onClick: 测发 }, '测：发到微信'),
                  h('button', { style: S.btn(false), disabled: 忙, onClick: 测收 }, '测：灌一条进会话'),
                  h('span', { style: S.dim }, '「发到微信」会真的发一条固定测试句。'),
                ),
                h('div', { style: S.hint }, '正式用法：在微信里跟「文件传输助手」说话，就等于跟我说话。'),
                折叠('日志', h('div', { style: S.pre }, (态.日志 || []).join('\n') || '（还空着）')),
              ),
            ),
      )
    }

    function apply(ctx) {
      const slots = ctx.get('slots')
      if (slots === undefined) return
      slots.inject('settings.section', () =>
        slots.register(
          { name: 'settings.section', id: 'wechat-bridge', order: 55, label: () => '通到微信' },
          Section,
        ),
      )
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
