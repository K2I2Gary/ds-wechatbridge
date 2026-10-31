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
    }

    const 开关 = (值, 改) =>
      h('input', { type: 'checkbox', checked: !!值, onChange: (e) => 改(e.target.checked) })

    function Section() {
      const [态, 设态] = React.useState(null)
      const [脏, 设脏] = React.useState(false)
      const [说, 设说] = React.useState('')
      const [忙, 设忙] = React.useState(false)

      const 拉 = React.useCallback(async () => {
        const d = await get('/state')
        if (d && d.ok) 设态(d)
      }, [])

      React.useEffect(() => {
        拉()
        const t = setInterval(拉, 4000)
        return () => clearInterval(t)
      }, [拉])

      const 改配置 = (补) => {
        设态((旧) => (旧 ? { ...旧, 配置: { ...旧.配置, ...补 } } : 旧))
        设脏(true)
      }

      const 存 = async () => {
        设忙(true)
        const r = await post('/save', 态.配置)
        if (r && r.ok) {
          设态(r)
          设脏(false)
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

      if (!态) return h('div', { style: S.wrap }, '读取中…')

      const 配置 = 态.配置 || {}
      const 桥 = 态.桥接 || {}
      const 会话们 = 态.活着的会话 || []
      const 绑定 = 配置.绑定 || []

      const 会话下拉 = (值, 改, 允许空) =>
        h(
          'select',
          { style: { ...S.input, minWidth: 280 }, value: 值 || '', onChange: (e) => 改(e.target.value) },
          允许空 ? h('option', { value: '' }, '（不选）') : null,
          会话们.map((s) =>
            h('option', { key: s.id, value: s.id }, (s.标题 || '（没标题）') + '  ·  ' + String(s.id).slice(-8)),
          ),
          值 && !会话们.some((x) => x.id === 值) ? h('option', { value: 值 }, '（已不活）' + String(值).slice(-8)) : null,
        )

      return h(
        'div',
        { style: S.wrap },
        // ---------- 顶部 ----------
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' } },
          h('div', { style: { fontSize: 15, fontWeight: 700 } }, '通到微信'),
          h('span', { style: S.dim }, 'v' + (态.版本 || '?')),
          h('span', { style: S.dim }, 'DSH ' + (态.DSH地址 || '?')),
          h('span', { style: 桥.运行中 ? S.ok : S.dim }, 桥.运行中 ? '● 桥接在跑（' + (桥.运行秒 || 0) + ' 秒）' : '○ 桥接没跑'),
        ),
        h(
          'div',
          { style: { ...S.dim, marginTop: 4 } },
          '读微信本地库收消息、UI 自动化发消息。不注入、不 hook、不改微信。',
        ),

        // ---------- 一、依赖 ----------
        h('div', { style: S.h }, '一、装依赖'),
        h(
          'div',
          { style: S.card },
          h(
            'div',
            { style: S.row },
            h('span', { style: S.lab }, '虚拟环境'),
            h('span', { style: 桥.venv就绪 ? S.ok : S.dim }, 桥.venv就绪 ? '✓ 已建好' : '还没建（用现成解释器就不需要）'),
            h('span', { style: { ...S.dim, marginLeft: 8 } }, 桥.虚拟环境 || ''),
          ),
          h(
            'div',
            { style: S.row },
            h('span', { style: S.lab }, '微信自动化库'),
            h(
              'span',
              { style: 桥.python ? S.ok : S.dim },
              桥.依赖就绪 ? '✓ 已验证' : 桥.python ? '（会用现成的解释器）' : '（还没就绪）',
            ),
          ),
          h(
            'div',
            { style: S.row },
            h('button', { style: S.btn(true), disabled: 忙 || 桥.安装?.进行中, onClick: 装依赖 },
              桥.安装?.进行中 ? '正在装…' : '装依赖（第一次几分钟）'),
            h('span', { style: S.dim }, '会用系统里的 Python 建一个独立环境，不动你别的环境。'),
          ),
          h(
            'div',
            { style: S.row },
            h('span', { style: S.lab }, '解释器（可选）'),
            h('input', {
              style: { ...S.input, width: 380 },
              value: 配置.解释器 || '',
              placeholder: '留空 = 自动找；或填一个已装好 wechatauto 的 python.exe',
              onChange: (e) => 改配置({ 解释器: e.target.value }),
            }),
          ),
          h('div', { style: S.hint }, '实际在用的：' + (桥.python || '（还没有）')),
          桥.安装?.进行中 || 桥.安装?.日志?.length
            ? h('div', null,
                h('div', { style: { ...S.dim, marginBottom: 4 } }, '进度：' + (桥.安装?.步骤 || '')),
                h('div', { style: S.pre }, (桥.安装?.日志 || []).join('\n') || '（还没输出）'))
            : null,
          桥.安装?.失败 ? h('div', { style: { ...S.bad, marginTop: 6 } }, '失败：' + 桥.安装.失败) : null,
        ),

        // ---------- 二、启动 ----------
        h('div', { style: S.h }, '二、启动桥接'),
        h(
          'div',
          { style: S.card },
          h(
            'div',
            { style: S.row },
            h('button', { style: S.btn(true), disabled: 忙 || 桥.运行中 || !桥.python, onClick: 起 }, '启动'),
            h('button', { style: S.btn(false), disabled: 忙 || !桥.运行中, onClick: 停 }, '停止'),
            h('span', { style: S.dim }, 桥.运行中 ? '日志会实时滚在下面' : 桥.python ? '可以启动了' : '先点「装依赖」，或者填一个能用的解释器'),
          ),
          h('div', { style: S.pre }, (桥.进程日志 || []).join('\n') || '（还没输出）'),
        ),

        // ---------- 三、怎么接 ----------
        h('div', { style: S.h }, '三、接到哪间会话'),
        h(
          'div',
          { style: S.card },
          h(
            'div',
            { style: S.row },
            h('span', { style: S.lab }, '总开关'),
            开关(配置.总开关, (v) => 改配置({ 总开关: v })),
            h('span', { style: S.dim }, '关着 = 一句都不发'),
          ),
          h(
            'div',
            { style: S.row },
            h('span', { style: S.lab }, '试运行'),
            开关(配置.试运行, (v) => 改配置({ 试运行: v })),
            h('span', { style: S.dim }, '开着 = 只在日志里记「该发什么」，不真发'),
          ),
          h(
            'div',
            { style: S.row },
            h('span', { style: S.lab }, '默认会话'),
            会话下拉(配置.默认会话, (v) => 改配置({ 默认会话: v }), true),
          ),
          h('div', { style: S.hint }, '微信里来的消息默认进这一间；没单独绑定的聊天都走它。'),

          h('div', { style: { ...S.h, marginTop: 12 } }, '单独绑定（可选）'),
          h('div', { style: S.hint },
            '一行 = 一个微信聊天 → 一间会话。填微信里显示的那个名字（好友昵称 / 群名 / 文件传输助手）。'),
          绑定.map((b, i) =>
            h(
              'div',
              { key: i, style: { ...S.row, marginTop: 6 } },
              h('input', {
                style: { ...S.input, width: 200 },
                value: b.聊天,
                placeholder: '微信聊天名',
                onChange: (e) => {
                  const 新 = 绑定.map((x, j) => (j === i ? { ...x, 聊天: e.target.value } : x))
                  改配置({ 绑定: 新 })
                },
              }),
              h('span', { style: S.dim }, '→'),
              会话下拉(b.会话, (v) => {
                const 新 = 绑定.map((x, j) => (j === i ? { ...x, 会话: v } : x))
                改配置({ 绑定: 新 })
              }, false),
              h('button', {
                style: S.btn(false),
                onClick: () => 改配置({ 绑定: 绑定.filter((_, j) => j !== i) }),
              }, '删'),
            ),
          ),
          h(
            'div',
            { style: { marginTop: 8 } },
            h('button', {
              style: S.btn(false),
              onClick: () => 改配置({ 绑定: 绑定.concat([{ 聊天: '', 会话: 配置.默认会话 || '' }]) }),
            }, '＋ 加一条绑定'),
          ),

          h(
            'div',
            { style: { ...S.row, marginTop: 14 } },
            h('span', { style: S.lab }, '接口令牌'),
            h('input', {
              style: { ...S.input, width: 240 },
              value: 配置.令牌 || '',
              placeholder: '留空 = 不校验（只建议本机）',
              onChange: (e) => 改配置({ 令牌: e.target.value }),
            }),
          ),

          h('div', { style: { ...S.h, marginTop: 18 } }, '看图（微信里的图片和表情包）'),
          h(
            'div',
            { style: S.card },
            h(
              'div',
              { style: S.row },
              h('span', { style: S.lab }, '识图'),
              开关(配置.看图 !== false, (v) => 改配置({ 看图: v })),
              h('span', { style: S.dim }, '收到图片 / 表情包先让视觉模型看一遍，再把描述带进对话'),
            ),
            h(
              'div',
              { style: S.row },
              h('span', { style: S.lab }, '视觉密钥'),
              h('input', {
                style: { ...S.input, width: 300 },
                type: 'password',
                value: 配置.视觉密钥 || '',
                placeholder: '留空 = 用环境变量 / 鲸鱼娘设置里的 DeepSeek key',
                onChange: (e) => 改配置({ 视觉密钥: e.target.value }),
              }),
            ),
            h(
              'div',
              { style: S.row },
              h('span', { style: S.lab }, '视觉模型'),
              h('input', {
                style: { ...S.input, width: 200 },
                value: 配置.视觉模型 || 'deepseek-flash',
                onChange: (e) => 改配置({ 视觉模型: e.target.value }),
              }),
              h('span', { style: S.dim }, '默认 deepseek-flash，支持 GIF'),
            ),
            h(
              'div',
              { style: S.row },
              h('span', { style: S.lab }, '备用视觉密钥（智谱）'),
              h('input', {
                style: { ...S.input, width: 300 },
                type: 'password',
                value: 配置.视觉备用密钥 || '',
                placeholder: '可选：DeepSeek 看失败时退到 glm-4v-flash',
                onChange: (e) => 改配置({ 视觉备用密钥: e.target.value }),
              }),
            ),
            h(
              'div',
              { style: S.hint },
              '同一张图按内容哈希缓存，只花一次钱；没配密钥也不会挡消息，只是标一句「没看清」。',
            ),
          ),

          h('div', { style: { ...S.h, marginTop: 18 } }, '群聊与记忆'),
          h(
            'div',
            { style: S.row },
            h('span', { style: S.lab }, '群上下文条数'),
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
          h(
            'div',
            { style: S.row },
            h('span', { style: S.lab }, '群回复频率'),
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
          h(
            'div',
            { style: S.row },
            h('span', { style: S.lab }, '外人只能聊天'),
            开关(配置.外人只能聊天, (v) => 改配置({ 外人只能聊天: v })),
            h('span', { style: S.dim }, '只有「主人」能动电脑；别人发的那一轮，工具会被硬拦'),
          ),
          h(
            'div',
            { style: S.row },
            h('span', { style: S.lab }, '群聊日记'),
            开关(配置.日记, (v) => 改配置({ 日记: v })),
            h('span', { style: S.dim }, '把群里的对话按天写成 markdown（不点名的也记）'),
          ),
          h(
            'div',
            { style: S.row },
            h('span', { style: S.lab }, '日记目录'),
            h('input', {
              style: { ...S.input, width: 380 },
              value: 配置.日记目录 || '',
              placeholder: '留空 = ~/.dsh/wechat-diary',
              onChange: (e) => 改配置({ 日记目录: e.target.value }),
            }),
          ),
          h(
            'div',
            { style: S.row },
            h('span', { style: S.lab }, '主人'),
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
          h(
            'div',
            { style: { ...S.row, alignItems: 'flex-start' } },
            h('span', { style: S.lab }, '屏蔽'),
            h('textarea', {
              style: { ...S.input, width: 380, minHeight: 64, fontFamily: 'inherit' },
              value: (配置.屏蔽 || []).join('\n'),
              placeholder: '一行一个：这些会话 / 人 不回复、也不记日记',
              onChange: (e) =>
                改配置({
                  屏蔽: e.target.value
                    .split(/\n/)
                    .map((s) => s.trim())
                    .filter(Boolean),
                }),
            }),
          ),
          h(
            'div',
            { style: S.hint },
            '默认屏蔽：微信运动、微信团队、微信支付、服务通知、订阅号消息。日记一天一个文件，当天追加。',
          ),

          h(
            'div',
            { style: { ...S.row, marginTop: 10 } },
            h('button', { style: S.btn(脏), disabled: 忙 || !脏, onClick: 存 }, 脏 ? '保存设置' : '已保存'),
            说 ? h('span', { style: S.dim }, 说) : null,
          ),
        ),

        // ---------- 四、试一试 ----------
        h('div', { style: S.h }, '四、试一试'),
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
          h('div', { style: S.hint },
            '正式用法：在微信里跟「文件传输助手」说话，就等于跟我说话；别人发给你的私聊、群里的话也会转进来。'),
        ),

        // ---------- 日志 ----------
        h('div', { style: S.h }, '日志'),
        h('div', { style: S.pre }, (态.日志 || []).join('\n') || '（还空着）'),
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
