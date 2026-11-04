// 临时自测：假装是 React + 浏览器，把设置页真正渲染一遍，验「单独绑定」「不回谁」
const 家 = process.env.DSH_HOME
if (!家) throw new Error('请设 DSH_HOME')

// ---------- 迷你 React ----------
const 状态 = []
const 引用 = []
const 每个effect = []
let 位 = 0
let 要重画 = false
const React = {
  createElement: (type, props, ...kids) => ({ type, props: props || {}, kids }),
  useState: (初) => {
    const i = 位++
    if (!(i in 状态)) 状态[i] = typeof 初 === 'function' ? 初() : 初
    const 设 = (v) => {
      状态[i] = typeof v === 'function' ? v(状态[i]) : v
      要重画 = true
    }
    return [状态[i], 设]
  },
  useRef: (初) => {
    const i = 位++
    if (!(i in 引用)) 引用[i] = { current: 初 }
    return 引用[i]
  },
  useCallback: (fn) => {
    位++
    return fn
  },
  useEffect: (fn, 依赖) => {
    const i = 位++
    const 旧 = 每个effect[i]
    const 变了 = !旧 || !依赖 || String(旧.依赖) !== String(依赖)
    if (变了) 每个effect[i] = { fn, 依赖, 跑过: 旧 ? 旧.跑过 : false }
    return undefined
  },
}
const 跑effect = () => {
  for (const e of 每个effect) {
    if (e && !e.跑过) {
      // 有依赖数组的只在依赖变了时跑一次；无依赖的每次渲染都跑
      e.跑过 = true
      e.fn()
    } else if (e && e.依赖 === undefined) {
      e.fn()
    }
  }
}
const 重画 = () => {
  for (let k = 0; k < 6; k++) {
    要重画 = false
    位 = 0
    每个effect.forEach((e) => e && (e.跑过 = false))
    const 树 = Section({})
    跑effect()
    if (!要重画) return 树
  }
  throw new Error('渲染死循环了')
}

// ---------- 假 fetch ----------
let 服务器 = {
  ok: true,
  版本: '1.3.0',
  配置: { 默认会话: 'session-aaa', 绑定: [], 屏蔽: [], 令牌: '' },
  活着的会话: [{ id: 'session-aaa', 标题: '主要聊天记忆' }],
  绑定情况: [],
  最近聊天: [{ 名: '群A', id: '1@chatroom', 类型: '群' }],
  桥接: { 运行中: false },
  人格: { 开关: true, 路径: 'C:\\Users\\K2\\.dsh\\wechat-persona.txt', 字节: 2048 },
  日志: [],
  用量: null,
}
let 发出去 = null
let 拉了几次 = 0
globalThis.fetch = async (url, opt) => {
  if (String(url).includes('/web-search/groups')) {
    return {
      json: async () => ({
        ok: true,
        groups: [
          {
            id: 1,
            query: '测试组',
            ts: 1700000000,
            keywords: [
              { keyword: '海风', weight: 3.5, count: 2 },
              { keyword: '灯塔', weight: 1.0, count: 1 },
            ],
            results: [{ title: '测试结果', url: 'https://example.com', content: '内容' }],
            saved_json: 'C:\\tmp\\test.json',
          },
        ],
      }),
    }
  }
  if (String(url).endsWith('/images')) {
    return {
      json: async () => ({
        ok: true,
        图片: [
          {
            id: 'p1',
            描述: '雪地里的小女孩',
            聊天: 'k2',
            发送人: 'k2',
            时间: '21:00',
            文件: 'C:\\tmp\\a.gif',
            原文件: '',
            存在: true,
            大小: 1234,
            修改: 1,
          },
        ],
      }),
    }
  }
  if (String(url).endsWith('/memory')) {
    return {
      json: async () => ({
        ok: true,
        消息: 12,
        笔记: 2,
        联网: 3,
        聊天: [{ chat: '群A', n: 5 }],
      }),
    }
  }
  if (String(url).endsWith('/state')) {
    拉了几次 += 1
    return { json: async () => 服务器 }
  }
  发出去 = { url, 体: JSON.parse((opt && opt.body) || '{}') }
  // 真 /save 会把存下来的配置原样回一份，这里照着演
  服务器 = { ...服务器, 配置: { ...服务器.配置, ...发出去.体 } }
  return { json: async () => ({ ...服务器, ok: true, 说: '保存好了' }) }
}
globalThis.window = {
  __ModuleLoader__: { load: (spec) => {
    globalThis.__插件 = spec.factory((n) => {
      if (n === 'react') return React
      throw new Error('不认识的包：' + n)
    })
  } },
}

let Section = null
await import('./lib/client.js')
const 插件 = globalThis.__插件
插件.apply({
  get: (n) =>
    n === 'slots'
      ? {
          inject: (evt, fn) => fn(),
          register: (meta, comp) => {
            Section = comp
            return { 名: meta.id }
          },
        }
      : undefined,
})

const 等 = () => new Promise((r) => setTimeout(r, 0))
const 都 = (树) => {
  const 出 = []
  const 走 = (x) => {
    if (x == null || x === false || x === true) return
    if (Array.isArray(x)) return x.forEach(走)
    if (typeof x !== 'object') return
    出.push(x)
    ;(x.kids || []).forEach(走)
  }
  走(树)
  return 出
}
const 绳 = (节点) => (节点.kids || []).flatMap((k) => (Array.isArray(k) ? k : [k])).filter((k) => typeof k === 'string').join('')
const 找按钮 = (树, 字) => 都(树).find((n) => n.type === 'button' && 绳(n).includes(字))
const 找输入 = (树, 占位) => 都(树).find((n) => n.type === 'input' && n.props.placeholder && n.props.placeholder.includes(占位))
const 断言 = (名, 条件, 细节) => {
  console.log((条件 ? '✓ ' : '✗ ') + 名 + (条件 ? '' : '  ← ' + JSON.stringify(细节)))
  if (!条件) process.exitCode = 1
}

// 1 第一帧（还没拉到数据）不炸
let 树 = 重画()
断言('第一帧渲染出来了', !!树, 树 && 树.type)

// 2 拉到数据后
await 等()
await 等()
树 = 重画()
const 文字 = 都(树).map((n) => 绳(n)).join(' | ')
断言('拉到了 /state', 拉了几次 >= 1, 拉了几次)
断言('有「不回谁（屏蔽）」这一栏', 文字.includes('不回谁（屏蔽）'), 文字.slice(0, 200))
断言('有「单独绑定」', 文字.includes('单独绑定'), 文字.slice(0, 400))
断言('有「历史记忆（RAG）」', 文字.includes('历史记忆（RAG）'), 文字.slice(0, 600))
断言('有「人格画像」并显示已读路径', 文字.includes('人格画像') && 文字.includes('已读：'), 文字.slice(0, 900))
断言('有「对话温度」且 0.5 显示正常', 文字.includes('对话温度') && 文字.includes('正常对话'), 文字.slice(0, 1200))
断言(
  '有「主动搭话」和「本地知识库」',
  文字.includes('主动搭话') && 文字.includes('本地知识库'),
  文字.slice(0, 1600),
)
断言('有「现在就让她说一句」按钮', 文字.includes('现在就让她说一句'), 文字.slice(0, 1800))
断言('有「联网搜索」配置', 文字.includes('联网搜索'), 文字.slice(0, 2000))
断言('有独立的「联网搜索」区块', 文字.includes('联网搜索（独立）'), 文字.slice(0, 2500))
断言(
  '独立搜索块提到关键词权重/每次一组',
  文字.includes('关键词权重') && 文字.includes('每次搜索存成一组'),
  文字.slice(0, 3000),
)
断言(
  '搜索组渲染了关键词条形图',
  文字.includes('关键词权重（条形越长权重越高'),
  文字.slice(-1600),
)
断言('搜索组显示要点 JSON 路径', 文字.includes('test.json'), 文字.slice(-1600))
断言('默认会话下拉选中了 session-aaa', !!都(树).find((n) => n.type === 'select' && n.props.value === 'session-aaa'), 都(树).filter((n) => n.type === 'select').map((n) => n.props.value))

// 3 加一个「不回谁」
const 屏蔽框 = 找输入(树, '微信名 / 群名')
断言('屏蔽输入框在', !!屏蔽框, 都(树).filter((n) => n.type === 'input').map((n) => n.props.placeholder))
屏蔽框.props.onChange({ target: { value: '小李' } })
树 = 重画()
const 加 = 找按钮(树, '加上')
断言('「加上」按钮在', !!加, 都(树).filter((n) => n.type === 'button').map(绳))
加.props.onClick()
树 = 重画()
断言('小李变成了一个标签', 都(树).some((n) => n.type === 'span' && 绳(n) === '小李'), 都(树).filter((n) => n.type === 'span').map(绳))
断言('输入框清空了', 找输入(树, '微信名 / 群名').props.value === '', 找输入(树, '微信名 / 群名').props.value)

// 4 回车也能加
找输入(树, '微信名 / 群名').props.onChange({ target: { value: '老王' } })
树 = 重画()
找输入(树, '微信名 / 群名').props.onKeyDown({ key: 'Enter', preventDefault() {} })
树 = 重画()
断言('回车也加成标签了', 都(树).some((n) => n.type === 'span' && 绳(n) === '老王'), 都(树).filter((n) => n.type === 'span').map(绳))

// 5 ★ 关键：没保存的时候，后台刷新不能把刚打的字冲掉
服务器 = { ...服务器, 配置: { ...服务器.配置, 绑定: [], 屏蔽: [] } }
await 等()
await 等()
树 = 重画()
断言('刷新之后小李还在（没被冲掉）', 都(树).some((n) => n.type === 'span' && 绳(n) === '小李'), 都(树).filter((n) => n.type === 'span').map(绳))
断言('刷新之后老王还在（没被冲掉）', 都(树).some((n) => n.type === 'span' && 绳(n) === '老王'), 都(树).filter((n) => n.type === 'span').map(绳))

// 6 保存：屏蔽真的发出去了
const 保存 = 找按钮(树, '保存设置')
断言('「保存设置」可点（不是「已保存」）', !!保存, 都(树).filter((n) => n.type === 'button').map(绳))
保存.props.onClick()
await 等()
await 等()
树 = 重画()
断言('发出去的屏蔽名单对', !!发出去 && (发出去.体.屏蔽 || []).join('|') === '小李|老王', 发出去 && 发出去.体.屏蔽)
断言('发完变成「已保存」', 都(树).some((n) => n.type === 'button' && 绳(n) === '已保存'), 都(树).filter((n) => n.type === 'button').map(绳))

// 7 单独绑定：点「最近来找过的」一键绑上
服务器 = { ...服务器, 配置: { ...服务器.配置, 屏蔽: ['小李', '老王'] } }
await 等()
await 等()
树 = 重画()
const 群A = 都(树).find((n) => n.type === 'button' && n.props['data-wx-bind'] === '群A')
断言('「最近来找过的」里有群A', !!群A, 都(树).filter((n) => n.type === 'button').map(绳))
群A.props.onClick()
树 = 重画()
const 绑定输入 = 都(树).find((n) => n.type === 'input' && n.props.value === '群A')
断言('群A 出现在绑定行里', !!绑定输入, 都(树).filter((n) => n.type === 'input').map((n) => n.props.value))
// 再刷新一次，脏数据不能被冲掉
await 等()
await 等()
树 = 重画()
断言('刷新后绑定行还在', 都(树).some((n) => n.type === 'input' && n.props.value === '群A'), 都(树).filter((n) => n.type === 'input').map((n) => n.props.value))

// 8 保存绑定
const 保存2 = 找按钮(树, '保存设置')
保存2.props.onClick()
await 等()
await 等()
树 = 重画()
断言('绑定发出去一条：群A', !!发出去 && (发出去.体.绑定 || []).length === 1 && 发出去.体.绑定[0].聊天 === '群A', 发出去 && 发出去.体.绑定)
断言('绑定带的会话是默认会话', 发出去.体.绑定[0].会话 === 'session-aaa', 发出去.体.绑定[0])

// 8.5 RAG 控件：默认开、条数/天数能改并保存
const rag开关 = 都(树).find((n) => n.type === 'input' && n.props['data-wx-rag'])
断言('RAG 开关默认开', !!rag开关 && rag开关.props.checked === true, rag开关 && rag开关.props.checked)
const 条数框 = 都(树).find((n) => n.type === 'input' && n.props['data-wx-ragcount'])
const 天数框 = 都(树).find((n) => n.type === 'input' && n.props['data-wx-ragdays'])
断言('RAG 条数 / 天数输入框在', !!条数框 && !!天数框, 都(树).filter((n) => n.type === 'input' && n.props.type === 'number').map((n) => n.props.value))
条数框.props.onChange({ target: { value: '7' } })
树 = 重画()
const 天数框2 = 都(树).find((n) => n.type === 'input' && n.props['data-wx-ragdays'])
天数框2.props.onChange({ target: { value: '14' } })
树 = 重画()
const 保存R = 找按钮(树, '保存设置')
保存R.props.onClick()
await 等()
await 等()
树 = 重画()
断言('RAG 条数 / 天数发出去了', 发出去.体.RAG条数 === 7 && 发出去.体.RAG天数 === 14, 发出去 && 发出去.体)

// 9 只听：候选动态列表点一下就能加；手打也能加；保存发得出去
const 听群A = 都(树).find((n) => n.type === 'button' && n.props['data-wx-listen'] === '群A')
断言('「最近来找过的」里有「只听」的快捷按钮', !!听群A, 都(树).filter((n) => n.type === 'button').map((n) => [绳(n), n.props['data-wx-listen']]))
听群A.props.onClick()
树 = 重画()
断言('点一下就进了「只听」标签', 都(树).some((n) => n.type === 'span' && 绳(n) === '群A'), 都(树).filter((n) => n.type === 'span').map(绳))

const 听输入 = 找输入(树, '会话名 / wxid')
断言('「只听」输入框在', !!听输入, 都(树).filter((n) => n.type === 'input').map((n) => n.props.placeholder))
听输入.props.onChange({ target: { value: '测试群' } })
树 = 重画()
const 加听 = 找按钮(树, '加进名单')
断言('「加进名单」按钮在', !!加听, 都(树).filter((n) => n.type === 'button').map(绳))
加听.props.onClick()
树 = 重画()
断言('手打的也进了「只听」', 都(树).some((n) => n.type === 'span' && 绳(n) === '测试群'), 都(树).filter((n) => n.type === 'span').map(绳))
const 保存听 = 找按钮(树, '保存设置')
保存听.props.onClick()
await 等()
await 等()
树 = 重画()
断言('「只听」名单发出去了', !!发出去 && (发出去.体.只听 || []).join('|') === '群A|测试群', 发出去 && 发出去.体.只听)

// 9.5 人格：文件路径能改并保存
const 人格框 = 找输入(树, 'humanity.txt')
断言('人格文件输入框在', !!人格框, 都(树).filter((n) => n.type === 'input').map((n) => n.props.placeholder))
人格框.props.onChange({ target: { value: 'C:\\persona.txt' } })
树 = 重画()
找按钮(树, '保存设置').props.onClick()
await 等()
await 等()
树 = 重画()
断言('人格文件路径发出去了', 发出去.体.人格文件 === 'C:\\persona.txt', 发出去 && 发出去.体)

// 9.6 温度滑杆：默认 0.5，0 / 1 都能保存
const 滑杆 = 都(树).find((n) => n.type === 'input' && n.props.type === 'range')
断言('温度滑杆默认 0.5', !!滑杆 && Number(滑杆.props.value) === 0.5, 滑杆 && 滑杆.props.value)
滑杆.props.onChange({ target: { value: '0' } })
树 = 重画()
找按钮(树, '保存设置').props.onClick()
await 等()
await 等()
树 = 重画()
断言('温度 0 发出去了', 发出去.体.温度 === 0, 发出去 && 发出去.体)
const 滑杆2 = 都(树).find((n) => n.type === 'input' && n.props.type === 'range')
滑杆2.props.onChange({ target: { value: '1' } })
树 = 重画()
找按钮(树, '保存设置').props.onClick()
await 等()
await 等()
树 = 重画()
断言('温度 1 发出去了', 发出去.体.温度 === 1, 发出去 && 发出去.体)

// 9.7 主动搭话 / 本地库开关
const 主动勾 = 都(树).find((n) => n.type === 'input' && n.props['data-wx-proactive'])
const 本地勾 = 都(树).find((n) => n.type === 'input' && n.props['data-wx-localkb'])
断言('主动搭话 / 本地库开关在', !!主动勾 && !!本地勾, 都(树).filter((n) => n.type === 'input' && n.props.type === 'checkbox').length)
主动勾.props.onChange({ target: { checked: false } })
树 = 重画()
都(树).find((n) => n.type === 'input' && n.props['data-wx-localkb']).props.onChange({ target: { checked: false } })
树 = 重画()
都(树).find((n) => n.type === 'input' && n.props['data-wx-websearch']).props.onChange({ target: { checked: false } })
树 = 重画()
找按钮(树, '保存设置').props.onClick()
await 等()
await 等()
树 = 重画()
断言(
  '主动搭话 / 本地库 / 联网搜索关掉发出去了',
  发出去.体.主动搭话 === false &&
    发出去.体.本地库 === false &&
    发出去.体.联网搜索 === false,
  发出去 && 发出去.体,
)

// 10 半截行：删掉聊天名，保存要被拦
const 输入们 = 都(树).filter((n) => n.type === 'input' && n.props.value === '群A')
输入们[0].props.onChange({ target: { value: '' } })
树 = 重画()
const 保存3 = 找按钮(树, '保存设置')
保存3.props.onClick()
await 等()
await 等()
树 = 重画()
const 提示 = 都(树).map((n) => 绳(n)).join(' ')
断言('半截行被拦住了（提示要补聊天名）', /缺聊天名|补上再存/.test(提示), 提示.slice(-300))
断言('半截行没发出去', (发出去.体.绑定 || []).length === 1, 发出去.体.绑定)

// 11 本地记忆：统计显示 + 按聊天清除
const 文字2 = 都(树).map((n) => 绳(n)).join(' | ')
断言('显示本地记忆统计', /本地记忆库：12 条微信消息/.test(文字2), 文字2.slice(-500))
const 记下拉 = 都(树).find((n) => n.type === 'select' && n.props['data-wx-memchat'])
断言('记忆聊天下拉在', !!记下拉, 都(树).filter((n) => n.type === 'select').map((n) => n.props.value))
记下拉.props.onChange({ target: { value: '群A' } })
树 = 重画()
const 清聊 = 都(树).find((n) => n.type === 'button' && n.props['data-wx-memclear'] === 'chat')
断言('清除聊天记忆按钮在', !!清聊, 都(树).filter((n) => n.type === 'button').map(绳))
清聊.props.onClick()
await 等()
await 等()
树 = 重画()
断言(
  '清除聊天记忆请求发出了',
  !!发出去 &&
    String(发出去.url).endsWith('/memory/clear') &&
    发出去.体.范围 === 'chat' &&
    发出去.体.聊天 === '群A',
  发出去,
)

// 12 图片管理：列表 + 删除
const 图文字 = 都(树).map((n) => 绳(n)).join(' | ')
断言('有「图片管理」区块', 图文字.includes('图片管理'), 图文字.slice(-1200))
断言('显示图片描述', 图文字.includes('雪地里的小女孩'), 图文字.slice(-1200))
const 删图按钮 = 都(树).find((n) => n.type === 'button' && n.props['data-wx-imgdel'] === 'p1')
断言('图片有删除按钮', !!删图按钮, 都(树).filter((n) => n.type === 'button').map(绳))
删图按钮.props.onClick()
await 等()
await 等()
树 = 重画()
断言(
  '删除图片请求发出了',
  !!发出去 && String(发出去.url).endsWith('/images/delete') && 发出去.体.id === 'p1',
  发出去,
)

console.log('\n渲染出来的按钮：', 都(树).filter((n) => n.type === 'button').map(绳).join(' / '))
// 设置页里有 4 秒一次的轮询，不手动退 node 会一直挂着
process.exit(process.exitCode || 0)
