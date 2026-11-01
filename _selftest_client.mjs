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
  日志: [],
  用量: null,
}
let 发出去 = null
let 拉了几次 = 0
globalThis.fetch = async (url, opt) => {
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
const 群A = 都(树).find((n) => n.type === 'button' && 绳(n).includes('群A'))
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

// 9 半截行：删掉聊天名，保存要被拦
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

console.log('\n渲染出来的按钮：', 都(树).filter((n) => n.type === 'button').map(绳).join(' / '))
// 设置页里有 4 秒一次的轮询，不手动退 node 会一直挂着
process.exit(process.exitCode || 0)
