// 临时自测：假 ctx 把 host.js 跑起来，验 保存/绑定/屏蔽/工具/最近聊天
import { apply } from './lib/host.js'
import * as hostMod from './lib/host.js'
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const 家 = process.env.DSH_HOME
const 配置路径 = join(家, 'wechat-bridge-config.json')
const 聊天路径 = join(家, 'wechat-bridge-chats.json')

writeFileSync(
  配置路径,
  JSON.stringify(
    { 总开关: true, 试运行: false, 人格: false, 默认会话: 'session-aaa', 绑定: [], 屏蔽: ['微信运动'] },
    null,
    2,
  ),
  'utf8',
)
// 上一轮留下的「最近聊天」要清掉，不然「一开始是空的」这条永远过不去
try {
  rmSync(聊天路径, { force: true })
} catch (error) {}

// 图片记忆也清掉自测专用的几条；否则上一轮的表情指纹会把这一轮的收图去重掉
try {
  const 图片记忆路径 = join(家, 'wechat-image-memory.json')
  if (existsSync(图片记忆路径)) {
    const d = JSON.parse(readFileSync(图片记忆路径, 'utf8').replace(/^﻿/, ''))
    const 自测id = new Set(['inbound', '贴纸A', '贴纸B'])
    const 留 = (d.图片 || []).filter((x) => !自测id.has(String(x.id)))
    writeFileSync(图片记忆路径, JSON.stringify({ ...d, 图片: 留 }, null, 2), 'utf8')
  }
} catch (error) {}
const 期望版本 = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version

const 会话 = [
  { id: 'session-aaa', 标题: '主要聊天记忆' },
  { id: 'session-bbb', 标题: '第二个会话说说' },
]
const 标题表 = new Map(会话.map((s) => [s.id, { title: s.标题 }]))
const 工具 = []
const 路线 = new Map()
const 收到的 = []
const agent表 = new Map()
const agent事件 = []

const 造agent = (id) => ({
  session: { id },
  followup: async (m) => 收到的.push({ id, m }),
  ctx: {
    tools: { guard: () => {} },
    on: (名, fn) => {
      agent事件.push({ id, 名, fn })
      return () => {}
    },
  },
})

const ctx = {
  get: (n) =>
    n === 'sessions'
      ? { list: () => 会话, flush: async () => {} }
      : n === 'sessionTitle'
        ? { get: (s) => 标题表.get(s.id) }
        : undefined,
  agents: {
    get: (id) => agent表.get(id),
    resume: async ({ resumeSessionId }) => {
      const a = 造agent(resumeSessionId)
      agent表.set(resumeSessionId, a)
      return a
    },
  },
  webServer: { register: (r) => 路线.set(r.path, r.handler), getOrigin: () => 'http://127.0.0.1:43134' },
  effect: (fn) => {
    fn()
    return () => {}
  },
  on: () => () => {},
  tools: { register: (t) => 工具.push(t) },
}

const 屏 = apply(ctx)

const 假req = (体, headers = {}) => ({
  headers,
  [Symbol.asyncIterator]: async function* () {
    yield Buffer.from(JSON.stringify(体))
  },
})
const 调 = async (路径, 体, headers = {}) => {
  const 处理器 = 路线.get(路径)
  if (!处理器) throw new Error('没这条路由：' + 路径)
  let 出 = null
  const res = { setHeader: () => {}, end: (s) => (出 = JSON.parse(s)) }
  await 处理器(假req(体, headers), res)
  return 出
}
const 读配置 = () => JSON.parse(readFileSync(配置路径, 'utf8'))
const 断言 = (名, 条件, 细节) => {
  console.log((条件 ? '✓ ' : '✗ ') + 名 + (条件 ? '' : '  ← ' + JSON.stringify(细节)))
  if (!条件) process.exitCode = 1
}

// 1 路由与工具都挂上了
断言('插件注入声明包含 tools', (hostMod.inject || []).includes('tools'), hostMod.inject)
断言('注册了 9 个工具', 工具.length === 9, 工具.map((t) => t.name))
断言('wechat_send_image 工具挂上了', 工具.some((t) => t.name === 'wechat_send_image'), 工具.map((t) => t.name))
断言('wechat_image_memory 工具挂上了', 工具.some((t) => t.name === 'wechat_image_memory'), 工具.map((t) => t.name))
断言('wechat_read_image 工具挂上了', 工具.some((t) => t.name === 'wechat_read_image'), 工具.map((t) => t.name))
断言('local_search 工具挂上了', 工具.some((t) => t.name === 'local_search'), 工具.map((t) => t.name))
断言('keyword_search 工具挂上了', 工具.some((t) => t.name === 'keyword_search'), 工具.map((t) => t.name))
断言('web_search 工具挂上了', 工具.some((t) => t.name === 'web_search'), 工具.map((t) => t.name))
断言(
  '注册了路由（含独立联网搜索）',
  路线.has('/dsh-wechat-bridge/save') &&
    路线.has('/dsh-wechat-bridge/state') &&
    路线.has('/dsh-wechat-bridge/web-search') &&
    路线.has('/dsh-wechat-bridge/web-search/groups') &&
    路线.has('/dsh-wechat-bridge/web-search/weights') &&
    路线.has('/dsh-wechat-bridge/speak-now'),
  [...路线.keys()],
)

// 2 概况
const 概 = await 屏.概况()
断言(`版本 ${期望版本}`, 概.版本 === 期望版本, 概.版本)
断言('最近聊天是数组', Array.isArray(概.最近聊天) && 概.最近聊天.length === 0, 概.最近聊天)
断言('「只听」默认是空名单（全部会话）', Array.isArray(概.配置.只听) && 概.配置.只听.length === 0, 概.配置.只听)
断言(
  'RAG 默认开、5 条、30 天',
  概.配置.RAG === true && 概.配置.RAG条数 === 5 && 概.配置.RAG天数 === 30,
  { RAG: 概.配置.RAG, 条数: 概.配置.RAG条数, 天数: 概.配置.RAG天数 },
)
断言('温度默认 0.5', 概.配置.温度 === 0.5, 概.配置.温度)
断言(
  '主动搭话默认开、30 分钟、2 次/小时',
  概.配置.主动搭话 === true && 概.配置.主动搭话分钟 === 30 && 概.配置.主动搭话每小时 === 2,
  { 开: 概.配置.主动搭话, 分钟: 概.配置.主动搭话分钟, 每小时: 概.配置.主动搭话每小时 },
)
断言(
  '本地库默认开、180 天、500 条/聊天',
  概.配置.本地库 === true && 概.配置.本地库天数 === 180 && 概.配置.本地库每聊条数 === 500,
  { 开: 概.配置.本地库, 天数: 概.配置.本地库天数, 条数: 概.配置.本地库每聊条数 },
)
断言('概况里有本地库路径', !!概.本地库 && /wechat-bridge-memory\.db$/.test(概.本地库.文件 || ''), 概.本地库)
断言(
  '联网搜索默认开、Tavily、5 条 / 5 关键词',
  概.配置.联网搜索 === true &&
    /tavily/.test(概.配置.搜索地址) &&
    概.配置.搜索条数 === 5 &&
    概.配置.关键词条数 === 5,
  {
    开: 概.配置.联网搜索,
    地址: 概.配置.搜索地址,
    搜索: 概.配置.搜索条数,
    关键词: 概.配置.关键词条数,
  },
)
const 概Host = await 调('/dsh-wechat-bridge/state', {}, { host: '127.0.0.1:9999' })
断言('state 用请求 Host 兜底 DSH 地址', 概Host.DSH地址 === 'http://127.0.0.1:9999', 概Host.DSH地址)

// 3 半截绑定行不收
const 存1 = await 调('/dsh-wechat-bridge/save', { 绑定: [{ 聊天: '', 会话: 'session-aaa' }] })
断言('半截行被拒（说里带「没填全」）', /没填全/.test(存1.说 || ''), 存1.说)
断言('半截行没落盘', 读配置().绑定.length === 0, 读配置().绑定)

// 4 正常保存：绑定 + 屏蔽
const 存2 = await 调('/dsh-wechat-bridge/save', {
  绑定: [{ 聊天: '测试群', 会话: 'session-aaa' }],
  屏蔽: ['微信运动', '测试群'],
})
断言('保存成功（绑定 1 条、不回 2 个）', /绑定 1 条、不回 2 个/.test(存2.说 || ''), 存2.说)
const 配2 = 读配置()
断言('绑定落盘了', 配2.绑定.length === 1 && 配2.绑定[0].聊天 === '测试群', 配2.绑定)
断言('屏蔽落盘了', 配2.屏蔽.join('|') === '微信运动|测试群', 配2.屏蔽)
断言('绑定情况带标题', (存2.绑定情况 || [])[0]?.会话标题 === '主要聊天记忆', 存2.绑定情况)

// 5 按底层 id 也能命中绑定（示例：群备注改了）
const 收1 = await 调('/dsh-wechat-bridge/receive', {
  text: '在吗',
  chat: '改了备注的群',
  chatId: '123@chatroom',
  chatType: 'group',
  sender: '张三',
  senderId: 'wxid_zhangsan',
})
断言('没绑定就回不行 —— 但默认会话兜着，应该能进', 收1.ok === true, 收1)
断言('消息喂进了默认会话', 收到的.length >= 1, 收到的.length)

// 6 给这个群单独绑一间，再按「显示名」进来
await 调('/dsh-wechat-bridge/save', {
  绑定: [{ 聊天: '测试群', 会话: 'session-aaa' }, { 聊天: '另一个群', 会话: 'session-bbb' }],
  屏蔽: ['微信运动'],
})
收到的.length = 0
const 收2 = await 调('/dsh-wechat-bridge/receive', {
  text: '单独的群',
  chat: '另一个群',
  chatId: '456@chatroom',
  chatType: 'group',
  sender: '李四',
  senderId: 'wxid_lisi',
})
断言('单独绑定的群进了自己那间', 收2.ok === true && 收到的[0]?.id === 'session-bbb', { 收2, 收到: 收到的.map((x) => x.id) })

// 7 最近聊过谁被记下来了
const 概2 = await 屏.概况()
const 名 = 概2.最近聊天.map((x) => x.名)
断言('最近聊天记到了两个群', 名.includes('改了备注的群') && 名.includes('另一个群'), 概2.最近聊天)
const 存盘 = JSON.parse(readFileSync(聊天路径, 'utf8'))
断言('聊天文件落了盘', (存盘.聊天 || 存盘 || []).length >= 2, 存盘)

// 8 工具：wechat_block
const 块 = 工具.find((t) => t.name === 'wechat_block')
const 块加 = await 块.execute({ action: 'add', who: '张三' })
断言('工具加了屏蔽', 读配置().屏蔽.includes('张三'), 读配置().屏蔽)
const 块列 = await 块.execute({ action: 'list' })
断言('工具能列出屏蔽', /张三/.test(块列.说 || ''), 块列.说)
await 块.execute({ action: 'remove', who: '张三' })
断言('工具能删屏蔽', !读配置().屏蔽.includes('张三'), 读配置().屏蔽)

// 9 工具：wechat_bind（按标题猜会话）
const 绑 = 工具.find((t) => t.name === 'wechat_bind')
const 绑列 = await 绑.execute({ action: 'list' })
断言('工具能列绑定', /另一个群/.test(绑列.说 || ''), 绑列.说)
const 绑加 = await 绑.execute({ action: 'add', chat: '第三个群', session: '第二个会话说说' })
断言('工具按标题猜到了会话', /第二个就位|第二个会话说说/.test(绑加.说 || ''), 绑加.说)
断言('工具写进了绑定', 读配置().绑定.some((b) => b.聊天 === '第三个群' && b.会话 === 'session-bbb'), 读配置().绑定)
await 绑.execute({ action: 'remove', chat: '第三个群' })
断言('工具能解绑', !读配置().绑定.some((b) => b.聊天 === '第三个群'), 读配置().绑定)

// 10 只听：名单外的会话不收（宿主这层也要拦）
await 调('/dsh-wechat-bridge/save', { 只听: ['测试群'] })
断言('「只听」落盘了', 读配置().只听.join('|') === '测试群', 读配置().只听)
收到的.length = 0
const 收3 = await 调('/dsh-wechat-bridge/receive', {
  text: '不该进来',
  chat: '另一个群',
  chatId: '456@chatroom',
  chatType: 'group',
  sender: '李四',
  senderId: 'wxid_lisi',
})
断言('名单外的会话被拦下', 收3.ok === false && /只听/.test(收3.说 || ''), 收3)
断言('名单外没喂进会话', 收到的.length === 0, 收到的.length)
const 收4 = await 调('/dsh-wechat-bridge/receive', {
  text: '该进来',
  chat: '测试群',
  chatId: '999@chatroom',
  chatType: 'group',
  sender: '张三',
  senderId: 'wxid_zhangsan',
})
断言('名单内的照常进', 收4.ok === true && 收到的.length === 1, { 收4, 收到: 收到的.map((x) => x.id) })

// 11 只听也认底层 id：改备注、同名都不怕
await 调('/dsh-wechat-bridge/save', { 只听: ['123@chatroom'] })
收到的.length = 0
const 收5 = await 调('/dsh-wechat-bridge/receive', {
  text: '按 id 进来',
  chat: '改了备注的群',
  chatId: '123@chatroom',
  chatType: 'group',
  sender: '王五',
  senderId: 'wxid_wangwu',
})
断言('按群 id 命中', 收5.ok === true && 收到的.length === 1, { 收5, 收到: 收到的.map((x) => x.id) })

// 12 逗号字符串也能存；清空 = 恢复全听
await 调('/dsh-wechat-bridge/save', { 只听: '群A,群B，群C' })
断言('「只听」支持逗号 / 中文逗号', 读配置().只听.join('|') === '群A|群B|群C', 读配置().只听)
await 调('/dsh-wechat-bridge/save', { 只听: [] })
收到的.length = 0
const 收6 = await 调('/dsh-wechat-bridge/receive', {
  text: '清空后随便谁都能进',
  chat: '随便一个私聊',
  chatId: 'wxid_x',
  chatType: 'private',
  sender: '路人',
  senderId: 'wxid_x',
})
断言('清空后恢复全听', 收6.ok === true && 收到的.length === 1, { 收6, 收到: 收到的.map((x) => x.id) })

// 13 名单外的会话只报「名字 / id / 类型」，也能进设置页的候选
const 报 = await 调('/dsh-wechat-bridge/seen', { chat: 'kiki', chatId: 'wxid_kiki', chatType: 'private' })
断言('/seen 收下了', 报.ok === true, 报)
const 概3 = await 屏.概况()
断言(
  '候选里出现了名单外的会话',
  概3.最近聊天.some((x) => x.名 === 'kiki' && x.id === 'wxid_kiki' && x.类型 === '私聊'),
  概3.最近聊天,
)

// 13.9 本地记忆：统计 / 清除路由（没建 venv 时也要优雅返回）
const 记统 = await 调('/dsh-wechat-bridge/memory', {})
断言('记忆统计路由存在', 记统 && (记统.ok === true || typeof 记统.说 === 'string'), 记统)
const 记清 = await 调('/dsh-wechat-bridge/memory/clear', { 范围: 'all' })
断言('记忆清除路由存在', 记清 && (记清.ok === true || typeof 记清.说 === 'string'), 记清)

// 14 RAG 配置能存能读、越界会被夹住
await 调('/dsh-wechat-bridge/save', { RAG: false, RAG条数: 0, RAG天数: 7 })
const 配R = 读配置()
断言('RAG 配置落盘', 配R.RAG === false && 配R.RAG条数 === 0 && 配R.RAG天数 === 7, 配R)
await 调('/dsh-wechat-bridge/save', { RAG条数: 99, RAG天数: 0 })
断言('RAG 条数封顶 20、天数非法回 30', 读配置().RAG条数 === 20 && 读配置().RAG天数 === 30, 读配置())
await 调('/dsh-wechat-bridge/save', { RAG: true, RAG条数: 5, RAG天数: 30 })

// 14.1 微信语言：只认 自动 / 中文 / 英文，其他值回落到自动
await 调('/dsh-wechat-bridge/save', { 微信语言: '英文' })
断言('微信语言落盘', 读配置().微信语言 === '英文', 读配置().微信语言)
await 调('/dsh-wechat-bridge/save', { 微信语言: 'Klingon' })
断言('微信语言非法回自动', 读配置().微信语言 === '自动', 读配置().微信语言)

// 15 人格画像：第 1 条注入、第 2 条不重复、第 3 条按间隔重提
const 人格路径 = join(家, 'test-persona.txt')
writeFileSync(人格路径, '你是测试人格。回答要短。', 'utf8')
await 调('/dsh-wechat-bridge/save', { 人格: true, 人格文件: 人格路径, 人格重提条数: 3 })
收到的.length = 0
const 发人格消息 = async (文本) => {
  const r = await 调('/dsh-wechat-bridge/receive', {
    text: 文本,
    chat: '人格测试',
    chatId: 'wxid_persona',
    chatType: 'private',
    sender: '测试者',
    senderId: 'wxid_persona',
  })
  return { r, 文: 收到的.length ? 收到的[收到的.length - 1].m.content[0].text : '' }
}
const 人1 = await 发人格消息('第一句')
断言('第 1 条带完整人格', 人1.r.ok === true && /<persona>/.test(人1.文) && /测试人格/.test(人1.文), 人1)
const 人2 = await 发人格消息('第二句')
断言('第 2 条不重复塞人格', 人2.r.ok === true && !/<persona>/.test(人2.文), 人2)
const 人3 = await 发人格消息('第三句')
断言('第 3 条按间隔重提人格', 人3.r.ok === true && /<persona>/.test(人3.文), 人3)
const 概P = await 屏.概况()
断言(
  '概况里有人格路径和大小',
  概P.人格 && 概P.人格.路径 === 人格路径 && 概P.人格.字节 > 0,
  概P.人格,
)

// 16 温度：0 主动 / 0.5 正常 / 1 被动但不沉默；同时注进请求配置
const 发温度消息 = async (文本) => {
  const r = await 调('/dsh-wechat-bridge/receive', {
    text: 文本,
    chat: '温度测试',
    chatId: 'wxid_temp',
    chatType: 'private',
    sender: '测试者',
    senderId: 'wxid_temp',
  })
  return { r, 文: 收到的.length ? 收到的[收到的.length - 1].m.content[0].text : '' }
}
await 调('/dsh-wechat-bridge/save', { 温度: 0 })
收到的.length = 0
const t0 = await 发温度消息('在吗')
断言('温度 0 注入主动模式提示', t0.r.ok === true && /主动模式/.test(t0.文), t0)
const 温处理器 = agent事件.find((x) => x.名 === 'agent/request' && x.id === 'session-aaa')
断言('agent/request 温度钩子挂上了', !!温处理器, agent事件.map((x) => [x.id, x.名]))
if (温处理器) {
  const 请求配置 = await 温处理器.fn({}, async () => ({ provider: 'p', model: 'm' }))
  断言('温度注进了请求配置', 请求配置.temperature === 0, 请求配置)
}

await 调('/dsh-wechat-bridge/save', { 温度: 1 })
if (温处理器) {
  const 请求配置1 = await 温处理器.fn({}, async () => ({ provider: 'p', model: 'm' }))
  断言('温度改了请求配置跟着变', 请求配置1.temperature === 1, 请求配置1)
}
收到的.length = 0
const t1 = await 发温度消息('随便说点什么')
断言(
  '温度 1 注入消极但不沉默',
  t1.r.ok === true && /消极模式/.test(t1.文) && /不能沉默/.test(t1.文),
  t1,
)
// 模拟模型一句都没说：turn/end 兜一句，保证微信里有回音
屏.收到事件({ id: 'session-aaa' }, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })
const 兜底 = await 调('/dsh-wechat-bridge/outbox', {})
断言(
  '温度 1 真沉默时兜底发一句',
  兜底.消息 && 兜底.消息.some((x) => x.text === '嗯，我在。' && x.chat === '温度测试'),
  兜底,
)

await 调('/dsh-wechat-bridge/save', { 温度: 0.5 })
收到的.length = 0
const t5 = await 发温度消息('正常聊')
断言('温度 0.5 不加行为提示', t5.r.ok === true && !/对话温度/.test(t5.文), t5)

await 调('/dsh-wechat-bridge/save', { 温度: 1.4 })
断言('温度封顶 1', 读配置().温度 === 1, 读配置().温度)
await 调('/dsh-wechat-bridge/save', { 温度: -0.3 })
断言('温度底 0', 读配置().温度 === 0, 读配置().温度)
await 调('/dsh-wechat-bridge/save', { 温度: 0.37 })
断言('温度按 0.1 取整', 读配置().温度 === 0.4, 读配置().温度)
await 调('/dsh-wechat-bridge/save', { 温度: 'abc' })
断言('温度非法回 0.5', 读配置().温度 === 0.5, 读配置().温度)

// 温度之后：图片倾向 / 语言微调注入
await 调('/dsh-wechat-bridge/save', { 图片倾向: 1, 语言微调: '回答更短' })
收到的.length = 0
await 调('/dsh-wechat-bridge/receive', {
  text: '在吗',
  chat: '偏好测试',
  chatType: 'private',
  sender: 'k2',
  senderId: 'wxid_k2',
})
const 偏文 = 收到的.length ? JSON.stringify(收到的[收到的.length - 1].m) : ''
断言('图片倾向提示注入了', /图片倾向 1\.0/.test(偏文), 偏文.slice(0, 300))
断言('语言微调提示注入了', /语言微调/.test(偏文) && /回答更短/.test(偏文), 偏文.slice(0, 300))
await 调('/dsh-wechat-bridge/save', { 图片倾向: 0.3, 语言微调: '' })

// 17 主动搭话 / 本地库配置能存能读
await 调('/dsh-wechat-bridge/save', {
  主动搭话: false,
  主动搭话分钟: 5,
  主动搭话每小时: 0,
  本地库: false,
  本地库天数: 7,
  本地库每聊条数: 100,
  联网搜索: false,
  搜索条数: 3,
  关键词条数: 4,
})
const 配K = 读配置()
断言(
  '主动搭话配置落盘',
  配K.主动搭话 === false && 配K.主动搭话分钟 === 5 && 配K.主动搭话每小时 === 0,
  配K,
)
断言(
  '本地库配置落盘',
  配K.本地库 === false && 配K.本地库天数 === 7 && 配K.本地库每聊条数 === 100,
  配K,
)
断言(
  '联网搜索配置落盘',
  配K.联网搜索 === false && 配K.搜索条数 === 3 && 配K.关键词条数 === 4,
  配K,
)

// 17.5 收图：描述/路径入 JSON，之后能按 id 发回去
await 调('/dsh-wechat-bridge/save', { 总开关: true, 只听: [], 看图: false })
const 收图路径 = join(家, 'inbound.png')
writeFileSync(收图路径, Buffer.from('89504e470d0a1a0a', 'hex'))
const 收图 = await 调('/dsh-wechat-bridge/receive', {
  text: '（发来一张图片）',
  chat: '图片测试',
  chatType: 'private',
  sender: 'k2',
  senderId: 'wxid_k2',
  图片: [收图路径],
  图片类型: '图片',
})
断言('图片消息转进了会话', 收图 && 收图.ok, 收图)
const 图片记忆 = JSON.parse(readFileSync(join(家, 'wechat-image-memory.json'), 'utf8'))
const 记忆条 = (图片记忆.图片 || []).find((x) => x.原文件 === 收图路径)
断言('图片描述写进了 JSON', !!记忆条 && 记忆条.聊天 === '图片测试', 记忆条)
断言(
  '图片复制进了工作区 wechat-images',
  !!记忆条 && 记忆条.文件 === join(家, 'wechat-images', 'inbound.png') && existsSync(记忆条.文件),
  记忆条,
)
const 记忆工具 = 工具.find((t) => t.name === 'wechat_image_memory')
const 记忆果 = await 记忆工具.execute({ query: '图片测试' })
断言(
  '图片记忆可以按聊天/描述查',
  记忆果 && 记忆果.ok && 记忆果.说.includes((记忆条 && 记忆条.文件) || ''),
  记忆果,
)
const 发图工具 = 工具.find((t) => t.name === 'wechat_send_image')
const 按id发 = await 发图工具.execute({ id: 'inbound', chat: '群A' })
断言('可以按图片 id 发回微信', 按id发 && 按id发.ok, 按id发)
const 发件1 = await 调('/dsh-wechat-bridge/outbox', {})
断言(
  '按 id 发图进了发件队列',
  (发件1.消息 || []).some((x) => x.images.includes((记忆条 && 记忆条.文件) || '')),
  发件1,
)
// 工作区副本被清掉时，按 id 应该回落到 ~/.dsh/wechat-inbound 里的原文件
rmSync(记忆条.文件, { force: true })
断言('工作区副本删掉后原文件还在', !!记忆条.原文件 && existsSync(记忆条.原文件), 记忆条)
const 按id回落 = await 发图工具.execute({ id: 'inbound', chat: '群A' })
断言('副本不在时按 id 回落原文件', 按id回落 && 按id回落.ok, 按id回落)
const 发件2 = await 调('/dsh-wechat-bridge/outbox', {})
断言(
  '回落后的原文件进了发件队列',
  (发件2.消息 || []).some((x) => (x.images || []).includes(记忆条.原文件)),
  发件2,
)
const 图类果 = await 记忆工具.execute({ 类型: '图片' })
断言('图片记忆可以按类型过滤', 图类果 && 图类果.ok && 图类果.说.includes(记忆条.文件), 图类果)
const 表情果 = await 记忆工具.execute({ 类型: '表情包' })
断言(
  '只看表情包时不会混进普通图片',
  表情果 && 表情果.ok && !表情果.说.includes(记忆条.文件),
  表情果,
)
const 读图工具 = 工具.find((t) => t.name === 'wechat_read_image')
const 读图果 = await 读图工具.execute({ id: 'inbound' })
断言('看图关着时读图工具会提示', 读图果 && 读图果.ok === false && /看图关着/.test(读图果.说), 读图果)
const 图列 = await 调('/dsh-wechat-bridge/images', {})
断言('图片列表路由返回记录', 图列 && 图列.ok && (图列.图片 || []).some((x) => x.id === 'inbound'), 图列)
const 图删 = await 调('/dsh-wechat-bridge/images/delete', { id: 'inbound' })
断言(
  '删除图片会删文件和 JSON 记录',
  图删 && 图删.ok && !!记忆条 && !existsSync(记忆条.文件) && !existsSync(收图路径),
  图删,
)
const 图片记忆2 = JSON.parse(readFileSync(join(家, 'wechat-image-memory.json'), 'utf8'))
断言(
  '删除后 JSON 里也没有这条',
  !(图片记忆2.图片 || []).some((x) => x.id === 'inbound'),
  图片记忆2,
)

// 17.5 表情库：内容去重、情绪检索、别名发图、2 分钟冷却、停用
const 贴纸A = join(家, '贴纸A.png')
const 贴纸B = join(家, '贴纸B.png')
const 贴纸字节 = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')
writeFileSync(贴纸A, 贴纸字节)
writeFileSync(贴纸B, 贴纸字节)
const 收贴纸 = (路径) =>
  调('/dsh-wechat-bridge/receive', {
    text: '（发来一个表情包）',
    chat: '群A',
    chatType: 'group',
    sender: 'k2',
    senderId: 'wxid_k2',
    图片: [路径],
    图片类型: '表情包',
  })
await 收贴纸(贴纸A)
await 收贴纸(贴纸B)
const 读贴纸库 = () =>
  JSON.parse(readFileSync(join(家, 'wechat-image-memory.json'), 'utf8')).图片 || []
const 贴纸库 = 读贴纸库()
const 贴纸条 = 贴纸库.find((x) => x.id === '贴纸A')
断言(
  '同一张表情换个文件名不会存两条',
  贴纸库.filter((x) => String(x.类型) === '表情包' && String(x.id).startsWith('贴纸')).length === 1,
  贴纸库,
)
断言(
  '重复的文件名记进别名',
  !!贴纸条 && (贴纸条.别名 || []).includes('贴纸B') && !!贴纸条.指纹,
  贴纸条,
)
// 补一句描述，验情绪标签是从描述里自动抽出来的
const 全记忆 = JSON.parse(readFileSync(join(家, 'wechat-image-memory.json'), 'utf8'))
const 要改 = (全记忆.图片 || []).find((x) => x.id === '贴纸A')
if (要改) {
  要改.描述 = '蓝发Q版女孩摊成一团，表达无语和摆烂。'
  delete 要改.情绪
}
writeFileSync(join(家, 'wechat-image-memory.json'), JSON.stringify(全记忆, null, 2), 'utf8')

const 表情工具 = 工具.find((t) => t.name === 'wechat_sticker_search')
断言('wechat_sticker_search 工具挂上了', !!表情工具, 工具.map((t) => t.name))
const 表情检索果 = await 表情工具.execute({ mood: '无语', chat: '群A' })
断言(
  '按情绪能找到表情并自动打标签',
  表情检索果 && 表情检索果.ok && 表情检索果.说.includes('贴纸A') && 表情检索果.说.includes('无语'),
  表情检索果,
)
const 按别名发 = await 发图工具.execute({ id: '贴纸B', chat: '群A' })
断言('按别名 id 也能发出去', 按别名发 && 按别名发.ok, 按别名发)
const 冷却搜索 = await 表情工具.execute({ mood: '无语', chat: '群A' })
断言(
  '2 分钟内发过的表情不再推荐',
  冷却搜索 && 冷却搜索.ok && !冷却搜索.说.includes('贴纸A'),
  冷却搜索,
)
const 重发 = await 发图工具.execute({ id: '贴纸A', chat: '群A' })
断言('2 分钟内不重复发同一张表情', 重发 && 重发.ok === false && /刚发过/.test(重发.说), 重发)
const 强发 = await 发图工具.execute({ id: '贴纸A', chat: '群A', 强制: true })
断言('强制可以忽略冷却', 强发 && 强发.ok, 强发)
const 贴纸条2 = 读贴纸库().find((x) => x.id === '贴纸A')
断言(
  '使用次数和最近发送写回记忆',
  !!贴纸条2 && 贴纸条2.用了几次 === 2 && !!贴纸条2.最近发送 && !!贴纸条2.最近发送['群A'],
  贴纸条2,
)
const 停用 = await 调('/dsh-wechat-bridge/images/toggle', { id: '贴纸A' })
断言('可以停用表情', 停用 && 停用.ok && 停用.启用 === false, 停用)
const 停用后 = await 表情工具.execute({ mood: '无语', chat: '群A' })
断言('停用后不再推荐', 停用后 && 停用后.ok && !停用后.说.includes('贴纸A'), 停用后)
const 图列2 = await 调('/dsh-wechat-bridge/images', {})
const 图条 = (图列2.图片 || []).find((x) => x.id === '贴纸A')
断言(
  '图片管理返回情绪和使用次数',
  !!图条 && Array.isArray(图条.情绪) && 图条.情绪.includes('无语') && 图条.用了几次 === 2,
  图条,
)
const 改标签 = await 调('/dsh-wechat-bridge/images/meta', {
  id: '贴纸A',
  情绪: '无语 嘲讽',
  标签: '雪 测试',
})
const 贴纸条3 = 读贴纸库().find((x) => x.id === '贴纸A')
断言(
  '可以手动改情绪和标签',
  改标签
    && 改标签.ok
    && !!贴纸条3
    && (贴纸条3.情绪 || []).join('/') === '无语/嘲讽'
    && (贴纸条3.标签 || []).join('/') === '雪/测试',
  贴纸条3,
)

// 17.6 大肥鱼表情包：sticker_send 返回的本机 Markdown 图 + 工具附言
await 发温度消息('来个大肥鱼表情')
屏.收到事件(
  { id: 'session-aaa' },
  {
    type: 'assistant/message',
    data: {
      turn: 99,
      message: {
        content: [
          {
            type: 'text',
            text: '![摸鱼](http://127.0.0.1:9999/x-nekowhale-stickers/s/abc123.gif)\n把上面这行原样放进回复即可显示。',
          },
        ],
      },
    },
  },
)
屏.收到事件(
  { id: 'session-aaa' },
  { type: 'turn/end', data: { turn: 99, reason: { kind: 'completed' } } },
)
const 肥鱼发件 = await 调('/dsh-wechat-bridge/outbox', {})
const 肥鱼条 = (肥鱼发件.消息 || []).find((x) =>
  (x.images || []).includes('http://127.0.0.1:9999/x-nekowhale-stickers/s/abc123.gif'),
)
断言('大肥鱼 sticker_send 的 Markdown 图进了发件队列', !!肥鱼条, 肥鱼发件)
断言(
  '工具附言不会跟着发到微信',
  !!肥鱼条 && !String(肥鱼条.text || '').includes('把上面这行原样放进回复即可显示'),
  肥鱼条,
)

// 18 发图工具：本地文件能进发件队列
const 图路径 = join(家, 'selftest.png')
writeFileSync(图路径, Buffer.from('89504e470d0a1a0a', 'hex'))
const 图果 = await 发图工具.execute({ path: 图路径, chat: '群A', text: '看图' })
断言('发图工具接受本地文件', 图果 && 图果.ok, 图果)
const 发件 = await 调('/dsh-wechat-bridge/outbox', {})
断言(
  '发图工具把图片压进了发件队列',
  (发件.消息 || []).some((x) => (x.images || []).includes(图路径) && x.chat === '群A'),
  发件,
)

console.log('\n日志尾巴：\n' + String(屏.日志 || '').split('\n').slice(-4).join('\n'))
