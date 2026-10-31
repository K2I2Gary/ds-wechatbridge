// DSH「通到微信」· 看图
//
// 微信里发来的图片 / 表情包，先让视觉模型看一遍，再把一句话描述带进会话。
// 只做「看」，不碰微信、不发消息。
//
// 主模型默认 deepseek-flash（OpenAI 兼容，支持 GIF），
// 失败时退到智谱 glm-4v-flash。密钥留空会自动去环境变量 /
// 鲸鱼娘的设置里找，找不到就安静地退回「没看清」。

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { createHash } from 'node:crypto'

const 家 = process.env.DSH_HOME || join(homedir(), '.dsh')
const 缓存文件 = join(家, 'wechat-vision-cache.json')
const 鲸鱼设置 = process.env.DSH_BRIDGE_VISION_SETTINGS || join(家, 'wechat-vision-settings.json')
const 缓存上限 = 500
const 单图上限 = 20 * 1024 * 1024

const 掐短 = (s, n = 80) => {
  const t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim()
  return t.length > n ? t.slice(0, n) + '…' : t
}

const 读缓存 = () => {
  try {
    const o = JSON.parse(readFileSync(缓存文件, 'utf8').replace(/^\uFEFF/, ''))
    return o && typeof o === 'object' && !Array.isArray(o) ? o : {}
  } catch (error) {
    return {}
  }
}

const 写缓存 = (表) => {
  try {
    const 条目 = Object.entries(表)
      .sort((a, b) => Number(b[1] && b[1].时间 || 0) - Number(a[1] && a[1].时间 || 0))
      .slice(0, 缓存上限)
    mkdirSync(家, { recursive: true })
    writeFileSync(缓存文件, JSON.stringify(Object.fromEntries(条目), null, 0), 'utf8')
  } catch (error) {}
}

/** 从鲸鱼娘的设置里借钥匙 —— 本机老用户不用再填一遍。 */
let 鲸鱼钥匙 = null
const 读鲸鱼钥匙 = () => {
  if (鲸鱼钥匙) return 鲸鱼钥匙
  鲸鱼钥匙 = { 主: '', 备: '' }
  try {
    if (existsSync(鲸鱼设置)) {
      const o = JSON.parse(readFileSync(鲸鱼设置, 'utf8').replace(/^\uFEFF/, ''))
      鲸鱼钥匙.主 = String(o.apiKey || '').trim()
      鲸鱼钥匙.备 = String(o.visionApiKey || '').trim()
    }
  } catch (error) {}
  return 鲸鱼钥匙
}

const 钥匙 = (配置) => {
  const 鲸 = 读鲸鱼钥匙()
  return {
    主:
      String(配置 && 配置.视觉密钥 || '').trim() ||
      String(process.env.DEEPSEEK_API_KEY || process.env.VISION_API_KEY || '').trim() ||
      鲸.主,
    备:
      String(配置 && 配置.视觉备用密钥 || '').trim() ||
      String(process.env.ZHIPU_API_KEY || process.env.ZHIPUAI_API_KEY || '').trim() ||
      鲸.备,
  }
}

/** 认文件头，不信扩展名 —— 微信存的图经常没后缀。 */
const 图片类型 = (buf) => {
  if (buf.length >= 6) {
    const 头6 = buf.subarray(0, 6).toString('ascii')
    if (头6 === 'GIF87a' || 头6 === 'GIF89a') return 'image/gif'
  }
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return 'image/png'
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg'
  if (
    buf.length >= 12 &&
    buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buf.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp'
  }
  return ''
}

async function 请求(基址, 密钥, 模型, dataUrl, 提示) {
  const 地址 = String(基址 || '').replace(/\/+$/, '') + '/chat/completions'
  const 体 = {
    model: 模型,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: 提示 },
          { type: 'image_url', image_url: { url: dataUrl, detail: 'low' } },
        ],
      },
    ],
    max_tokens: 700,
  }
  // DeepSeek 默认开着思考：看图只要一句描述，关掉既快又省 token。
  // 智谱不认这个字段，所以只对 DeepSeek 带。
  if (String(基址 || '').includes('deepseek')) 体.thinking = { type: 'disabled' }
  const r = await fetch(地址, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${密钥}` },
    body: JSON.stringify(体),
    signal: AbortSignal.timeout(60000),
  })
  const 文 = await r.text()
  let o = {}
  try {
    o = JSON.parse(文)
  } catch (error) {}
  if (!r.ok) {
    const 错 = o && o.error && (o.error.message || o.error.code)
    throw new Error(`视觉接口 ${r.status}：${错 || 文.slice(0, 160)}`)
  }
  const m = o && o.choices && o.choices[0] && o.choices[0].message
  const 说 = String((m && m.content) || '').trim()
  if (!说) throw new Error('视觉接口没返回文字')
  return 说.replace(/\s+/g, ' ').slice(0, 180)
}

/**
 * 看一张图，返回一句中文描述。
 * 同一张图（按文件内容哈希）只花一次钱，之后走本地缓存。
 */
export async function 看图(路径, 类型, 配置) {
  const p = String(路径 || '').trim()
  if (!p || !existsSync(p)) throw new Error('图片文件不在了')
  const buf = readFileSync(p)
  if (!buf.length) throw new Error('图片是空的')
  if (buf.length > 单图上限) throw new Error('图片太大（>20MB）')

  const 哈希 = createHash('sha256').update(buf).digest('hex')
  const 缓存 = 读缓存()
  if (缓存[哈希] && 缓存[哈希].描述) return String(缓存[哈希].描述)

  const mime = 图片类型(buf)
  if (!mime) throw new Error('不是能认的图片格式')

  const 提示 =
    `这是微信聊天里对方发来的${类型 || '图片'}。` +
    '用一两句中文说清画面内容，以及它表达的情绪、语气或梗；不要寒暄，不超过60字。'
  const dataUrl = `data:${mime};base64,${buf.toString('base64')}`
  const { 主, 备 } = 钥匙(配置)

  let 描述 = ''
  let 主错 = null
  if (主) {
    try {
      描述 = await 请求(
        (配置 && 配置.视觉地址) || 'https://api.deepseek.com',
        主,
        (配置 && 配置.视觉模型) || 'deepseek-flash',
        dataUrl,
        提示,
      )
    } catch (error) {
      主错 = error
    }
  }
  if (!描述 && 备) {
    try {
      描述 = await 请求(
        (配置 && 配置.视觉备用地址) || 'https://open.bigmodel.cn/api/paas/v4',
        备,
        (配置 && 配置.视觉备用模型) || 'glm-4v-flash',
        dataUrl,
        提示,
      )
    } catch (error) {
      if (!主错) 主错 = error
    }
  }
  if (!描述) throw new Error(主错 ? String(主错.message || 主错) : '没配视觉密钥')

  缓存[哈希] = { 描述, 时间: Date.now(), 类型: 类型 || '图片' }
  写缓存(缓存)
  return 描述
}

/** 一次看最多三张，拼成一句；单张失败就跳过，不耽误整条消息。 */
export async function 描述图片们(路径们, 类型, 配置, 记账) {
  const 清单 = [...new Set((Array.isArray(路径们) ? 路径们 : []).map(String).filter(Boolean))].slice(0, 3)
  const 得 = []
  for (const p of 清单) {
    try {
      const d = await 看图(p, 类型, 配置)
      if (d) 得.push(清单.length > 1 ? `第${得.length + 1}张：${d}` : d)
    } catch (error) {
      try {
        记账(`看图失败（${掐短(p, 60)}）：${掐短((error && error.message) || error, 80)}`)
      } catch (e) {}
    }
  }
  if (!得.length) return ''
  const 全 = 得.join('；')
  try {
    记账(`看图（${类型 || '图片'}）：${掐短(全, 70)}`)
  } catch (error) {}
  return 全
}
