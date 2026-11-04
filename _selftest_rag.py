# 自测：微信语义（@/引用）+ 本地检索（RAG）—— 纯函数，不碰微信、不碰 DSH
import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'bridge'))
import wechat_bridge as b  # noqa: E402

失败 = []


def 断言(名, 条件, 细节=''):
    print(('✓ ' if 条件 else '✗ ') + 名 + ('' if 条件 else '  ← ' + repr(细节)))
    if not 条件:
        失败.append(名)


# ---------- @ / 提及 ----------

成员 = [
    {"name": "kiki", "username": "wxid_kiki"},
    {"name": "张三", "username": "wxid_zhangsan"},
    {"name": "张三丰", "username": "wxid_zsf"},
    {"name": "阿鲸", "username": "wxid_me"},
]

文本, 提及, at = b.解析提及(
    "wxid_zhangsan:\n@kiki 你看下 @大肥鱼", 成员, "wxid_me", ("大肥鱼", "鲸鱼娘")
)
断言('英文昵称按 U+2005 截断', 文本 == "@kiki 你看下 @大肥鱼", 文本)
断言('解析出两个被 @ 的人', [x["name"] for x in 提及] == ["kiki", "大肥鱼"], 提及)
断言('@大肥鱼 算在叫我', at is True, at)

文本, 提及, at = b.解析提及("@张三丰 你好", 成员, "wxid_me", ())
断言('中文昵称最长匹配（张三丰不吃成张三）', 提及 and 提及[0]["name"] == "张三丰", 提及)
断言('正文保留 @ 名字', 文本 == "@张三丰 你好", 文本)

文本, 提及, at = b.解析提及("@张三你好", 成员, "wxid_me", ())
断言('张三能匹配到', 提及 and 提及[0]["name"] == "张三", 提及)
断言('中文名后面的正文保留', 文本 == "@张三你好", 文本)

文本, 提及, at = b.解析提及("@阿鲸 在吗", 成员, "wxid_me", ())
断言('按群成员 id 认出 @ 的是我', at is True and 提及[0]["is_me"] is True, 提及)

文本, 提及, at = b.解析提及("@所有人 开会", 成员, "wxid_me", ())
断言('@所有人 算点名', at is True and 提及[0]["name"] == "所有人", 提及)
断言('@所有人 正文保留', 文本 == "@所有人 开会", 文本)

文本, 提及, at = b.解析提及("@路人甲 你好", [], "wxid_me", ())
断言('不认识的昵称也能保留', 文本 == "@路人甲 你好" and 提及[0]["name"] == "路人甲", (文本, 提及))
断言('不认识的人不算点名', at is False, at)

文本, 提及, at = b.解析提及("大肥鱼在吗", [], "wxid_me", ("大肥鱼",))
断言('正文里直接叫别名也算点名', at is True and 文本 == "大肥鱼在吗", (文本, at))

断言(
    'clean_text 不再抹掉 @',
    b.clean_text("wxid_abc:\n@张三 你好") == "@张三 你好",
    b.clean_text("wxid_abc:\n@张三 你好"),
)

# ---------- 检索 ----------

现在 = time.time()
候选 = [
    {"text": "今晚去吃火锅吗", "who": "张三", "ts": 现在 - 86400},
    {"text": "明天开会讨论预算", "who": "李四", "ts": 现在 - 2 * 86400},
    {"text": "那家火锅店排队好久", "who": "王五", "ts": 现在 - 10 * 86400},
]

命中 = b.检索消息("火锅 哪家", 候选, 条数=3)
断言('火锅相关的能捞到', len(命中) >= 2 and all("火锅" in x["text"] for x in 命中), 命中)
断言('更近的排前面', 命中 and 命中[0]["text"] == "今晚去吃火锅吗", 命中)
断言('不相关的不会混进来', all("开会" not in x["text"] for x in 命中), 命中)

命中 = b.检索消息("预算", 候选, 条数=3)
断言('单关键词也能捞', len(命中) == 1 and "预算" in 命中[0]["text"], 命中)

命中 = b.检索消息("完全无关的内容", 候选, 条数=3)
断言('完全不相关就返回空', 命中 == [], 命中)

命中 = b.检索消息("火锅", 候选, 条数=3, 排除最近=1)
断言('排除最近一条后不重复', all(x["text"] != "今晚去吃火锅吗" for x in 命中), 命中)

断言('空查询返回空', b.检索消息("", 候选) == [], b.检索消息("", 候选))

同样 = [
    {"text": "同一句话", "who": "旧", "ts": 现在 - 30 * 86400},
    {"text": "同一句话", "who": "新", "ts": 现在 - 3600},
]
命中 = b.检索消息("同一句话", 同样, 条数=2)
断言('原句命中且新的排前面', 命中 and 命中[0]["who"] == "新", 命中)
断言('返回里带 score', 命中 and "score" in 命中[0], 命中)

# ---------- zstd 占位符兜底 ----------

if b._ZSTD is not None:
    原始 = "长文本测试：这是一条很长的话。".encode("utf-8")
    try:
        压缩 = b._ZSTD.ZstdCompressor().compress(原始)
        解出 = b._zstd解压(压缩)
        断言('zstd 能解压长文本', 解出 == 原始, 解出)
    except Exception as e:
        断言('zstd 能解压长文本', False, repr(e))
else:
    print('（本机没装 zstandard，跳过 zstd 解压测试）')

if 失败:
    print('\n%d 条没过：%s' % (len(失败), '、'.join(失败)))
    sys.exit(1)
print('\n全部通过')
