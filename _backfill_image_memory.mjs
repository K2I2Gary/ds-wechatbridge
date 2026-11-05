// 一次性维护脚本：把 ~/.dsh/wechat-inbound 里还没进「图片记忆」的图补上。
//
// 收图时如果桥接没跑 / 旧版本没写记忆，文件会留在 inbound，但图片记忆里没有，
// 模型就查不到、也没法按 id 发出去。这个脚本扫描 inbound，用视觉模型补描述
// （已有缓存的不重复花钱），并跳过内容完全相同的重复文件。
//
// 用法：
//   node _backfill_image_memory.mjs            # 真写
//   node _backfill_image_memory.mjs --dry-run  # 只看会补哪些，不写文件
//
// 不动微信、不发消息；只读写 wechat-image-memory.json 和视觉缓存。

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { 看图 } from './lib/vision.js'
import { 整理表情记录, 文件指纹 } from './lib/sticker.js'

const 本目录 = dirname(fileURLToPath(import.meta.url))
const 家 = process.env.DSH_HOME || join(homedir(), '.dsh')
const 记忆路径 = join(家, 'wechat-image-memory.json')
const 只预览 = process.argv.includes('--dry-run')
const 图片后缀 = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp'])

const 读JSON = (路径, 默认) => {
  try {
    return JSON.parse(readFileSync(路径, 'utf8').replace(/^﻿/, ''))
  } catch (error) {
    return 默认
  }
}

const 配置 = 读JSON(join(家, 'wechat-bridge-config.json'), {})
const 记忆 = 读JSON(记忆路径, {})
const 现有 = Array.isArray(记忆.图片) ? 记忆.图片 : []

const 哈希 = (路径) => createHash('sha256').update(readFileSync(路径)).digest('hex')
const 图片id = (路径) => basename(路径).replace(/\.[^.]+$/, '')
const 展开 = (p) => String(p || '').replace(/^~(?=$|[\\/])/, homedir())

/** inbound 里已有的文件内容哈希：用来去重，避免同一张图存两条。 */
const 已有哈希 = new Set()
const 已有id = new Set()
for (const x of 现有) {
  已有id.add(String(x.id || ''))
  for (const p of [x.原文件, x.文件]) {
    const 真 = 展开(p)
    if (真 && existsSync(真)) {
      已有哈希.add(哈希(真))
      break
    }
  }
}

/** 找 wxgf 转换用的 Python：设置里的解释器 > 桥接 venv > 打包运行环境 > PATH。 */
const 找Python = () => {
  const 候选 = [
    String(配置.解释器 || '').trim(),
    join(家, 'wechat-bridge-venv', 'Scripts', 'python.exe'),
    join(家, 'wechat-bridge-runtime', 'python', 'python.exe'),
  ].filter(Boolean)
  return 候选.find((p) => existsSync(展开(p))) || 'python'
}

/** .wxgf → 同名 PNG（桥接自带转换；已经转过的会直接复用）。 */
const 转wxgf = (路径) => {
  try {
    const 输出 = execFileSync(
      找Python(),
      [join(本目录, 'bridge', 'wechat_bridge.py'), '--wxgf-convert', 路径],
      { encoding: 'utf8', timeout: 120000, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } },
    )
    const 行 = 输出.split(/\r?\n/).reverse().find((s) => s.trim().startsWith('{'))
    if (!行) return ''
    const 结果 = JSON.parse(行)
    return 结果 && 结果.ok && 结果.路径 ? String(结果.路径) : ''
  } catch (error) {
    console.log(`  ! wxgf 转换失败：${basename(路径)}：${String((error && error.message) || error).slice(0, 120)}`)
    return ''
  }
}

const 目录表 = [
  { 目录: join(家, 'wechat-inbound', 'stickers'), 类型: '表情包' },
  { 目录: join(家, 'wechat-inbound', 'images'), 类型: '图片' },
]

const 新增 = []
let 扫描 = 0
let 跳过已有 = 0
let 跳过重复 = 0
let 跳过格式 = 0
let 转换失败 = 0

for (const { 目录, 类型 } of 目录表) {
  if (!existsSync(目录)) continue
  for (const 文件 of readdirSync(目录).sort()) {
    扫描 += 1
    const 原 = join(目录, 文件)
    let 图 = 原
    const 后缀 = extname(文件).toLowerCase()

    if (后缀 === '.wxgf') {
      const 同名 = 原.replace(/\.wxgf$/i, '.png')
      if (existsSync(同名)) {
        图 = 同名
      } else {
        图 = 转wxgf(原)
        if (!图 || !existsSync(图)) {
          转换失败 += 1
          continue
        }
      }
    } else if (!图片后缀.has(后缀)) {
      跳过格式 += 1
      continue
    }

    const id = 图片id(图)
    if (已有id.has(id)) {
      跳过已有 += 1
      continue
    }
    let 内容哈希 = ''
    try {
      内容哈希 = 哈希(图)
    } catch (error) {
      跳过格式 += 1
      continue
    }
    if (已有哈希.has(内容哈希)) {
      跳过重复 += 1
      continue
    }

    let 描述 = ''
    try {
      描述 = await 看图(图, 类型, 配置)
    } catch (error) {
      console.log(`  ! 看图失败：${basename(图)}：${String((error && error.message) || error).slice(0, 120)}`)
    }

    const 条目 = {
      id,
      文件: 图,
      原文件: 图,
      聊天: '',
      发送人: '',
      类型,
      描述: 描述 || '',
      原始文字: '（本地回填）',
      时间: new Date(statSync(图).mtimeMs).toLocaleString('zh-CN', { hour12: false }),
    }
    新增.push(条目)
    已有id.add(id)
    已有哈希.add(内容哈希)
    console.log(`  + [${类型}] ${basename(图)}：${描述 || '（没看清）'}`)
  }
}

// 旧记录补情绪 / 标签 / 指纹；内容相同的合并成一条，文件名记进「别名」。
// 这样换了个文件名重新收到的同一张图，按任一 id 都能发出去。
const 合并 = []
let 合并重复 = 0
for (const x of [...现有, ...新增]) {
  const 记 = 整理表情记录(x)
  const 指纹 = String(记.指纹 || '') || 文件指纹(记.文件) || 文件指纹(记.原文件)
  const 同 = 合并.find(
    (y) => (指纹 && y.指纹 === 指纹) || String(y.id) === String(记.id),
  )
  if (同) {
    同.别名 = [...new Set([...(同.别名 || []), ...(记.别名 || []), 记.id].filter(Boolean))]
    合并重复 += 1
    continue
  }
  合并.push({ ...记, 指纹 })
}

console.log(
  `\n扫描 ${扫描} 个文件；已有 ${跳过已有}，内容重复 ${跳过重复}，非图片 ${跳过格式}，`
  + `转换失败 ${转换失败}；新增 ${新增.length} 条，合并重复 ${合并重复} 条。`,
)

if (只预览) {
  console.log('--dry-run：没有写文件。')
} else if (合并.length) {
  writeFileSync(
    记忆路径,
    JSON.stringify({ 更新: new Date().toISOString(), 图片: 合并.slice(-500) }, null, 2),
    'utf8',
  )
  console.log(`已写入 ${记忆路径}（共 ${Math.min(合并.length, 500)} 条，已补情绪 / 标签 / 指纹）。`)
} else {
  console.log('没有要补的，图片记忆未改动。')
}
