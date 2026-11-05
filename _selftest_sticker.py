# 自测：桥接读取本地表情库（图片记忆 JSON）——纯函数，不碰微信、不碰 DSH
import json
import os
import subprocess
import sys
import tempfile

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'bridge'))
import wechat_bridge as b  # noqa: E402

失败 = []


def 断言(名, 条件, 细节=''):
    print(('✓ ' if 条件 else '✗ ') + 名 + ('' if 条件 else '  ← ' + repr(细节)))
    if not 条件:
        失败.append(名)


with tempfile.TemporaryDirectory() as 临时:
    好图 = os.path.join(临时, 'a.png')
    with open(好图, 'wb') as f:
        f.write(b'\x89PNG\r\n\x1a\n' + b'x' * 32)
    坏图 = os.path.join(临时, 'missing.png')
    数据 = {
        "更新": "2026-11-05T00:00:00.000Z",
        "图片": [
            {
                "id": "a",
                "类型": "表情包",
                "描述": "无语的猫",
                "情绪": ["无语", "嘲讽"],
                "标签": ["猫"],
                "文件": 好图,
                "启用": True,
            },
            {"id": "b", "类型": "图片", "描述": "普通照片", "文件": 好图},
            {"id": "c", "类型": "表情包", "描述": "停用了", "文件": 好图, "启用": False},
            {"id": "d", "类型": "表情包", "描述": "文件丢了", "文件": 坏图, "原文件": 坏图},
            {"id": "e", "类型": "表情包", "描述": "只剩原文件", "文件": 坏图, "原文件": 好图},
            "不是对象",
        ],
    }
    路径 = os.path.join(临时, 'wechat-image-memory.json')
    with open(路径, 'w', encoding='utf-8') as f:
        json.dump(数据, f, ensure_ascii=False)

    条 = b.读本地表情库(路径)
    断言('只收启用且有文件的表情包', [x['id'] for x in 条] == ['a', 'e'], 条)
    断言('描述当成 caption', 条 and 条[0]['描述'] == '无语的猫', 条)
    断言('情绪 + 标签拼成关键词', 条 and 条[0]['关键词'] == '无语 嘲讽 猫', 条)
    断言('工作区副本没了回落原文件', 条 and 条[1]['path'] == 好图, 条)
    断言('坏记录和文件丢失的跳过', all(x['id'] not in ('c', 'd') for x in 条), 条)
    断言('JSON 不存在时返回空列表', b.读本地表情库(os.path.join(临时, 'none.json')) == [], '')
    坏JSON = os.path.join(临时, 'bad.json')
    with open(坏JSON, 'w', encoding='utf-8') as f:
        f.write('{ 这不是 JSON')
    断言('JSON 坏了也不炸', b.读本地表情库(坏JSON) == [], '')

    # 端到端：走 --meme-test，验 [表情: 关键词] 能匹配到本地表情文件
    脚本 = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'bridge', 'wechat_bridge.py')
    环境 = dict(os.environ, DSH_WECHAT_IMAGE_MEMORY=路径)
    出 = subprocess.run(
        [sys.executable, '-I', 脚本, '--meme-test', '无语'],
        capture_output=True, text=True, encoding='utf-8', env=环境, timeout=60,
    )
    行 = next((x for x in reversed(出.stdout.splitlines()) if x.strip().startswith('{')), '')
    结果 = json.loads(行) if 行 else {}
    断言(
        '[表情: 情绪词] 能匹配到本地表情',
        结果.get('ok') is True and 结果.get('路径') == 好图 and 结果.get('本地表情') == 2,
        (出.stdout[-400:], 出.stderr[-400:]),
    )

# 真机数据（有的话）：只验证能读、不要求固定条数
真 = os.path.join(os.path.expanduser('~'), '.dsh', 'wechat-image-memory.json')
if os.path.exists(真):
    条 = b.读本地表情库(真)
    断言('真实图片记忆能读出表情包列表', isinstance(条, list), type(条))
    print('  真实表情包：%d 张' % len(条))

if 失败:
    print('\n%d 条没过：%s' % (len(失败), '、'.join(失败)))
    sys.exit(1)
print('\n全部通过')
