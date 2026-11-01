// 临时自测：假 ctx 把 host.js 跑起来，验 保存/绑定/屏蔽/工具/最近聊天
import { apply } from './lib/host.js'
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const 家 = process.env.DSH_HOME
const 配置路径 = join(家, 'wechat-bridge-config.json')
const 聊天路径 = join(家, 'wechat-bridge-chats.json')

writeFileSync(
  配置路径,
  JSON.stringify({ 总开关: true, 试运行: false, 默认会话: 'session-aaa', 绑定: [], 屏蔽: ['微信运动'] }, null, 2),
  'utf8',
)

const 会话 = [
  { id: 'session-aaa', 标题: '主要聊天记忆' },
  { id: 'session-bbb', 标题: '第二个会话说说' },
]
const 标题表 = new Map(会话.map((s) => [s.id, { title: s.标题 }]))
const 工具 = []
const 路线 = new Map()
const 收到的 = []
const agent表 = new Map()

const 造agent = (id) => ({
  session: { id },
  followup: async (m) => 收到的.push({ id, m }),
  ctx: { tools: { guard: () => {} } },
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

const 假req = (体) => ({
  headers: {},
  [Symbol.asyncIterator]: async function* () {
    yield Buffer.from(JSON.stringify(体))
  },
})
const 调 = async (路径, 体) => {
  const 处理器 = 路线.get(路径)
  if (!处理器) throw new Error('没这条路由：' + 路径)
  let 出 = null
  const res = { setHeader: () => {}, end: (s) => (出 = JSON.parse(s)) }
  await 处理器(假req(体), res)
  return 出
}
const 读配置 = () => JSON.parse(readFileSync(配置路径, 'utf8'))
const 断言 = (名, 条件, 细节) => {
  console.log((条件 ? '✓ ' : '✗ ') + 名 + (条件 ? '' : '  ← ' + JSON.stringify(细节)))
  if (!条件) process.exitCode = 1
}

// 1 路由与工具都挂上了
断言('注册了 2 个工具', 工具.length === 2, 工具.map((t) => t.name))
断言('注册了路由', 路线.has('/dsh-wechat-bridge/save') && 路线.has('/dsh-wechat-bridge/state'), [...路线.keys()])

// 2 概况
const 概 = await 屏.概况()
断言('版本 1.3.0', 概.版本 === '1.3.0', 概.版本)
断言('最近聊天是数组', Array.isArray(概.最近聊天) && 概.最近聊天.length === 0, 概.最近聊天)

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

console.log('\n日志尾巴：\n' + String(屏.日志 || '').split('\n').slice(-4).join('\n'))
