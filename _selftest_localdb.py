# 自测：本地知识库（SQLite FTS5）—— 建临时库、写入、检索
import json
import os
import sqlite3
import sys
import tempfile
import time

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'bridge'))
import local_search as ls  # noqa: E402
import web_search as ws  # noqa: E402

失败 = []


def 断言(名, 条件, 细节=''):
    print(('✓ ' if 条件 else '✗ ') + 名 + ('' if 条件 else '  ← ' + repr(细节)))
    if not 条件:
        失败.append(名)


SCHEMA = """
CREATE TABLE messages(id INTEGER PRIMARY KEY, key TEXT UNIQUE, chat TEXT, chat_id TEXT,
  sender TEXT, ts REAL, text TEXT, tokens TEXT);
CREATE VIRTUAL TABLE messages_fts USING fts5(tokens, chat, sender,
  content='messages', content_rowid='id');
CREATE TRIGGER messages_ai AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts(rowid,tokens,chat,sender) VALUES(new.id,new.tokens,new.chat,new.sender);
END;
CREATE TRIGGER messages_ad AFTER DELETE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts,rowid,tokens,chat,sender)
  VALUES('delete',old.id,old.tokens,old.chat,old.sender);
END;
CREATE TRIGGER messages_au AFTER UPDATE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts,rowid,tokens,chat,sender)
  VALUES('delete',old.id,old.tokens,old.chat,old.sender);
  INSERT INTO messages_fts(rowid,tokens,chat,sender) VALUES(new.id,new.tokens,new.chat,new.sender);
END;
CREATE TABLE notes(id INTEGER PRIMARY KEY, key TEXT UNIQUE, path TEXT, title TEXT,
  text TEXT, tokens TEXT, mtime REAL);
CREATE VIRTUAL TABLE notes_fts USING fts5(tokens, title, path,
  content='notes', content_rowid='id');
CREATE TRIGGER notes_ai AFTER INSERT ON notes BEGIN
  INSERT INTO notes_fts(rowid,tokens,title,path) VALUES(new.id,new.tokens,new.title,new.path);
END;
CREATE TRIGGER notes_ad AFTER DELETE ON notes BEGIN
  INSERT INTO notes_fts(notes_fts,rowid,tokens,title,path)
  VALUES('delete',old.id,old.tokens,old.title,old.path);
END;
CREATE TRIGGER notes_au AFTER UPDATE ON notes BEGIN
  INSERT INTO notes_fts(notes_fts,rowid,tokens,title,path)
  VALUES('delete',old.id,old.tokens,old.title,old.path);
  INSERT INTO notes_fts(rowid,tokens,title,path) VALUES(new.id,new.tokens,new.title,new.path);
END;
"""

with tempfile.TemporaryDirectory() as d:
    db = os.path.join(d, 'memory.db')
    con = sqlite3.connect(db)
    con.executescript(SCHEMA)
    con.executescript(ls._WEB_SCHEMA)
    now = time.time()
    rows = [
        ('m1', '玩瓦玩的', '1@chatroom', '张三', '今晚去吃火锅吗', now - 3600),
        ('m2', '玩瓦玩的', '1@chatroom', '李四', '明天开会讨论预算', now - 7200),
        ('m3', 'k2', 'wxid_k2', 'k2', '部署文档放在仓库根目录', now - 600),
    ]
    for key, chat, cid, who, text, ts in rows:
        con.execute(
            "INSERT INTO messages(key,chat,chat_id,sender,ts,text,tokens) VALUES(?,?,?,?,?,?,?)",
            (key, chat, cid, who, ts, text, ' '.join(ls.分词(text))),
        )
    note = '# 部署笔记\n火锅店在二楼，周末要排队。'
    con.execute(
        "INSERT INTO notes(key,path,title,text,tokens,mtime) VALUES(?,?,?,?,?,?)",
        ('n1', 'notes/部署.md', '部署笔记', note, ' '.join(ls.分词(note)), now),
    )
    web_text = "爬山攻略：周末去爬山，记得带水和防晒。"
    con.execute(
        "INSERT INTO web_info(key,query,title,url,text,tokens,keywords,ts,source)"
        " VALUES(?,?,?,?,?,?,?,?,?)",
        (
            'w1',
            '爬山',
            '爬山攻略',
            'https://example.com/hike',
            web_text,
            ' '.join(ls.分词(web_text)),
            ' '.join(ls._提取关键词(web_text, 5)),
            now,
            'web',
        ),
    )
    con.commit()
    con.close()

    结果 = ls.搜索(db, '火锅')
    断言('微信历史能搜到火锅', len(结果['messages']) == 1 and '火锅' in 结果['messages'][0]['text'], 结果)
    断言('笔记也能搜到火锅', len(结果['notes']) == 1 and '火锅' in 结果['notes'][0]['text'], 结果)

    结果 = ls.搜索(db, '预算', chat='玩瓦玩的')
    断言('限定聊天名能搜到', len(结果['messages']) == 1 and '预算' in 结果['messages'][0]['text'], 结果)
    结果 = ls.搜索(db, '预算', chat='wxid_k2')
    断言('限定 wxid 搜不到别的聊天', len(结果['messages']) == 0, 结果)

    结果 = ls.搜索(db, '部署文档', chat='wxid_k2')
    断言('按 wxid 限定能搜到', len(结果['messages']) == 1, 结果)

    结果 = ls.搜索(db, '')
    断言('空查询返回空', 结果['ok'] and not 结果['messages'] and not 结果['notes'], 结果)

    结果 = ls.搜索(os.path.join(d, '不存在.db'), '火锅')
    断言('库不存在时给出可读错误', 结果['ok'] is False and '本地库' in 结果['说'], 结果)

    结果 = ls.搜索(db, '爬山')
    断言('联网结果也能搜到', len(结果['web']) == 1 and '爬山' in 结果['web'][0]['text'], 结果)

    排序 = ls.关键词检索(db, '火锅', top=5)
    断言('关键词检索有结果', 排序['ok'] and len(排序['items']) >= 1, 排序)
    断言('关键词最多 5 条', len(排序['items']) <= 5, 排序)
    断言(
        '注意力占比降序',
        all(
            排序['items'][i]['percent'] >= 排序['items'][i + 1]['percent']
            for i in range(len(排序['items']) - 1)
        ),
        排序,
    )
    断言(
        '注意力占比约 100',
        abs(sum(x['percent'] for x in 排序['items']) - 100) < 1.5,
        排序,
    )
    断言('关键词不为空', all(x['keyword'] for x in 排序['items']), 排序)

    # 联网入库：替换网络函数，验证写库 + 后续可检索
    原搜索 = ls._联网搜索
    ls._联网搜索 = lambda q, u, k, l: [
        {"title": "测试资料", "url": "https://example.com/test", "content": "测试关键字：海风与灯塔。"}
    ]
    try:
        入库 = ls.web_ingest(db, '海风', 'x', '', 3)
    finally:
        ls._联网搜索 = 原搜索
    断言('联网入库成功', 入库['ok'] and '写入' in 入库['说'], 入库)
    结果 = ls.搜索(db, '灯塔')
    断言('联网入库后能检索', len(结果['web']) == 1 and '灯塔' in 结果['web'][0]['text'], 结果)

    排序 = ls.关键词检索(db, '海风', top=5, web=False)
    断言('联网信息参与注意力排序', any(x['kind'] == 'web' for x in 排序['items']), 排序)

    # 独立联网搜索的落盘：不依赖桥接进程
    save_dir = os.path.join(d, 'notes', 'web')
    saved = ws._保存('海风与灯塔', [
        {"title": "测试标题", "url": "https://example.com/a", "content": "海风与灯塔的说明"}
    ], save_dir)
    断言('独立搜索能保存成 markdown', os.path.isfile(saved), saved)
    if os.path.isfile(saved):
        body = open(saved, encoding='utf-8').read()
        断言('保存内容包含查询和结果', '海风与灯塔' in body and '测试标题' in body, body[:200])

    # 网页抓取关键词 + 每次搜索一组 + 权重
    原抓 = ws._抓网页
    ws._抓网页 = lambda url: "海风 灯塔 海风 灯塔 帆船 帆船"
    try:
        搜索组 = [{"title": "T", "url": "https://x", "content": "摘要"}]
        关键词 = ws._网页关键词(搜索组, True)
    finally:
        ws._抓网页 = 原抓
    断言('网页正文提取出关键词', any(k['keyword'] == '海风' for k in 关键词), 关键词)
    断言('网页关键词有默认权重', all(k['weight'] >= 0.5 for k in 关键词), 关键词)

    gid = ws._存组(db, '海风组', 搜索组, 关键词)
    断言('每次搜索存成一组', isinstance(gid, int) and gid > 0, gid)
    组 = ws._列组(db, 1)
    断言(
        '能列出搜索组',
        组['ok'] and 组['groups'] and 组['groups'][0]['id'] == gid,
        组,
    )
    更新 = ws._设权重(db, gid, {'海风': 3.5})
    断言('权重能更新', 更新['ok'], 更新)
    组 = ws._列组(db, 1)
    权 = {k['keyword']: k['weight'] for k in 组['groups'][0]['keywords']}
    断言('权重读回来是 3.5', 权.get('海风') == 3.5, 权)

    排序 = ls.关键词检索(db, '海风', top=5)
    断言('带权重的关键词检索可用', 排序['ok'] and 排序['items'], 排序)

    # 去重：同一内容 / 同一 URL 只留一条
    去, _ = ls._去重([
        {"text": "海风 灯塔"},
        {"text": "海风灯塔"},
        {"text": "别的内容", "url": "https://a"},
        {"text": "另一段", "url": "https://a"},
    ])
    断言('同一内容 / URL 会去重', len(去) == 2, 去)

    # 信息要点 JSON
    json_path = ws._保存json(
        '海风与灯塔',
        [{"title": "T", "url": "https://x", "content": "正文"}],
        [{"keyword": "海风", "weight": 3.5, "count": 2}],
        save_dir,
    )
    断言('信息要点存成 JSON', os.path.isfile(json_path), json_path)
    if os.path.isfile(json_path):
        要点 = json.load(open(json_path, encoding='utf-8'))
        断言('JSON 里有查询 / 关键词 / 结果', 要点.get('query') == '海风与灯塔' and 要点.get('keywords') and 要点.get('results'), 要点)

if 失败:
    print('\n%d 条没过：%s' % (len(失败), '、'.join(失败)))
    sys.exit(1)
print('\n全部通过')
