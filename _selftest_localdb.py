# 自测：本地知识库（SQLite FTS5）—— 建临时库、写入、检索
import os
import sqlite3
import sys
import tempfile
import time

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'bridge'))
import local_search as ls  # noqa: E402

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

if 失败:
    print('\n%d 条没过：%s' % (len(失败), '、'.join(失败)))
    sys.exit(1)
print('\n全部通过')
