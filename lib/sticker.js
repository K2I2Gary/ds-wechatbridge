// 表情库的纯函数：情绪标签、内容指纹、检索打分、冷却判断。
//
// 宿主插件（lib/host.js）和回填脚本（_backfill_image_memory.mjs）共用。
// 这里不写任何文件，指纹函数只读文件内容。

import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'

/** 同一张表情在同一个聊天里 2 分钟内不重复推荐 / 发送。 */
export const 表情冷却毫秒 = 2 * 60 * 1000

// 情绪词典：描述里命中任意词就归到这个情绪。一个表情可以带多个情绪。
const 情绪词表 = {
  开心: ['开心', '高兴', '狂笑', '大笑', '笑死', '愉快', '欢喜', '乐呵'],
  无语: ['无语', '无奈', '嫌弃', '懒得理', '翻白眼', '呆滞', '沉默', '尴尬', '没眼看'],
  得意: ['得意', '自信', '炫耀', '稳了', '看我的', '得瑟', '嘚瑟', '昂首'],
  卖萌: ['卖萌', '可爱', '乖巧', '撒娇', '软萌', '脸红', '萌'],
  生气: ['生气', '愤怒', '气急败坏', '抓狂', '发火', '凶', '威胁', '揍', '怒'],
  震惊: ['震惊', '傻眼', '错愕', '惊呼', '惊讶', '天啊'],
  摆烂: ['摆烂', '瘫', '躺平', '放弃', '投降', '认输', '无力', '疲惫', '爽歪歪', '舒服'],
  拒绝: ['拒绝', '达咩', '退退退', '不要', '防御', '推开', '挡住'],
  疑惑: ['疑惑', '思考', '让我想想', '问号', '若有所思', '没看懂', '啊？'],
  调皮: ['调皮', '恶作剧', '吐舌', '略略略', '捣蛋', '耍赖', '搞怪', '贱萌', '戏弄'],
  委屈: ['委屈', '含泪', '哭', '泪', '可怜', '倔强', '嘟嘴'],
  加油: ['加油', '握拳', '打气', '冲鸭', '冲呀'],
  嘲讽: ['嘲讽', '调侃', '反讽', '戏谑', '阴阳', '鄙视'],
  安抚: ['安抚', '摸摸', '抱抱', '安慰', '贴贴', '揉'],
}

// 画面标签：只在描述里出现时补上，方便以后按画面找。
const 画面词表 = [
  'Q版', '像素', '女仆', '猫', '狗', '猪', '兔', '小黄人', '超人',
  '雪', '面包车', '电脑', '屏幕', '猫娘', '小人', '表情',
]

/** 从一句中文描述里抽情绪，最多 3 个，命中越多越靠前。 */
export function 抽情绪(描述) {
  const 文 = String(描述 || '')
  if (!文) return []
  const 命中 = []
  for (const [情绪, 词们] of Object.entries(情绪词表)) {
    let 次数 = 0
    let 首位 = Infinity
    for (const 词 of 词们) {
      let 从 = 0
      let 位 = 文.indexOf(词, 从)
      if (位 < 0) continue
      次数 += 1
      首位 = Math.min(首位, 位)
    }
    if (次数) 命中.push({ 情绪, 次数, 首位 })
  }
  命中.sort((a, b) => b.次数 - a.次数 || a.首位 - b.首位)
  return 命中.slice(0, 3).map((x) => x.情绪)
}

/** 从描述里抽短标签：引号里的配文 + 画面词 + 动图/静图。 */
export function 抽标签(描述, 文件) {
  const 文 = String(描述 || '')
  const 标签 = []
  const 加 = (s) => {
    const t = String(s || '').trim()
    if (t && !标签.includes(t)) 标签.push(t)
  }
  for (const m of 文.matchAll(/[“「『]([^”」』]{1,12})[”」』]/g)) 加(m[1])
  for (const 词 of 画面词表) {
    if (文.includes(词)) 加(词)
  }
  if (/\.gif$/i.test(String(文件 || ''))) 加('动图')
  return 标签.slice(0, 6)
}

/** 文件内容指纹：同一张图换个文件名也能认出来。读不到就返回空串。 */
export function 文件指纹(路径) {
  try {
    if (!路径 || !existsSync(路径)) return ''
    return createHash('sha256').update(readFileSync(路径)).digest('hex')
  } catch (error) {
    return ''
  }
}

/** 补齐表情记录的新字段；旧 JSON 没有这些字段也能直接用。 */
export function 整理表情记录(x) {
  const 记录 = x && typeof x === 'object' ? x : {}
  const 描述 = String(记录.描述 || '')
  return {
    ...记录,
    情绪: Array.isArray(记录.情绪) ? 记录.情绪.filter(Boolean) : 抽情绪(描述),
    标签: Array.isArray(记录.标签) ? 记录.标签.filter(Boolean) : 抽标签(描述, 记录.文件),
    启用: 记录.启用 !== false,
    用了几次: Math.max(0, Number(记录.用了几次) || 0),
  }
}

/** 关键词相关度：描述命中 > 情绪命中 > 标签命中；空格分开的多个词分别计分。 */
export function 表情得分(x, 词) {
  const q = String(词 || '').trim().toLowerCase()
  if (!q) return 0
  const 描述 = String(x && x.描述 ? x.描述 : '').toLowerCase()
  const 情绪 = (Array.isArray(x && x.情绪) ? x.情绪 : []).join(' ').toLowerCase()
  const 标签 = (Array.isArray(x && x.标签) ? x.标签 : []).join(' ').toLowerCase()
  let 分 = 0
  for (const t of q.split(/[\s,，、]+/).filter(Boolean)) {
    if (描述.includes(t)) 分 += 6
    if (情绪.includes(t)) 分 += 5
    if (标签.includes(t)) 分 += 4
  }
  return 分
}

/** 这张表情最近有没有发到过这个聊天（默认 2 分钟冷却）。 */
export function 冷却中(x, 聊天, 现在 = Date.now(), 毫秒 = 表情冷却毫秒) {
  if (!聊天 || !x || !x.最近发送) return false
  const ts = Number(x.最近发送[聊天] || 0)
  return !!ts && 现在 - ts < 毫秒
}
