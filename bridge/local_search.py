#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""本地知识库搜索：微信历史 + 笔记。

由宿主 local_search 工具调用：
  python local_search.py --db ~/.dsh/wechat-bridge-memory.db --query "上周说的配置" --limit 8

输出 JSON（stdout），不打印其他东西。
"""

import argparse
import json
import os
import re
import sqlite3
import sys
import time

_停用词 = {
    "的", "了", "是", "在", "我", "你", "他", "她", "它", "们", "这", "那", "个",
    "我们", "你们", "他们", "这个", "那个", "一个", "没有", "就是", "还是",
    "什么", "怎么", "为什么", "可以", "但是", "因为", "所以", "然后", "现在",
    "今天", "昨天", "明天", "一下", "不是", "自己", "知道", "觉得", "时候",
    "the", "and", "for", "you", "are", "was", "with", "this", "that", "have",
}


def 分词(s):
    s = str(s or "").lower()
    out = []
    for run in re.findall(r"[一-鿿]+|[a-z0-9_]+", s):
        if re.match(r"[a-z0-9_]", run):
            if len(run) >= 2 and run not in _停用词:
                out.append(run)
            continue
        if len(run) == 1:
            if run not in _停用词:
                out.append(run)
            continue
        for i in range(len(run) - 1):
            bg = run[i:i + 2]
            if bg not in _停用词:
                out.append(bg)
    return out


def 搜索(db_path, query, chat="", limit=8):
    if not db_path or not os.path.isfile(db_path):
        return {"ok": False, "说": "本地库还没建好（桥接启动后会自动建）"}
    toks = 分词(query)
    if not toks:
        return {"ok": True, "messages": [], "notes": []}
    match = " OR ".join('"%s"' % t.replace('"', '""') for t in toks)
    limit = max(1, min(30, int(limit or 8)))
    try:
        con = sqlite3.connect(db_path, timeout=5)
        con.row_factory = sqlite3.Row
        con.execute("PRAGMA busy_timeout=5000")
    except Exception as e:
        return {"ok": False, "说": "打开本地库失败：%s" % e}

    out = {"ok": True, "messages": [], "notes": []}
    try:
        sql = (
            "SELECT m.chat, m.chat_id, m.sender, m.ts, m.text, bm25(messages_fts) AS score "
            "FROM messages_fts JOIN messages m ON m.id=messages_fts.rowid "
            "WHERE messages_fts MATCH ?"
        )
        params = [match]
        if chat:
            sql += " AND (m.chat=? OR m.chat_id=?)"
            params += [chat, chat]
        sql += " ORDER BY score ASC LIMIT ?"
        params.append(limit)
        for r in con.execute(sql, params):
            out["messages"].append({
                "chat": r["chat"] or "",
                "chat_id": r["chat_id"] or "",
                "sender": r["sender"] or "",
                "ts": time.strftime("%Y-%m-%d %H:%M", time.localtime(float(r["ts"] or 0))),
                "text": (r["text"] or "")[:600],
            })
    except sqlite3.OperationalError as e:
        # 没有 FTS / 表还没建：返回可读原因，但笔记仍可尝试
        out["说"] = "微信历史检索失败：%s" % e

    try:
        sql2 = (
            "SELECT n.path, n.title, n.text, bm25(notes_fts) AS score "
            "FROM notes_fts JOIN notes n ON n.id=notes_fts.rowid "
            "WHERE notes_fts MATCH ? ORDER BY score ASC LIMIT ?"
        )
        for r in con.execute(sql2, [match, limit]):
            out["notes"].append({
                "path": r["path"] or "",
                "title": r["title"] or "",
                "text": (r["text"] or "")[:800],
            })
    except sqlite3.OperationalError as e:
        out.setdefault("说", "")
        out["说"] = (out["说"] + "；" if out["说"] else "") + "笔记检索失败：%s" % e

    con.close()
    return out


def main():
    p = argparse.ArgumentParser(description="DSH WeChat bridge local search")
    p.add_argument("--db", required=True)
    p.add_argument("--query", required=True)
    p.add_argument("--chat", default="")
    p.add_argument("--limit", type=int, default=8)
    a = p.parse_args()
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    print(json.dumps(搜索(a.db, a.query, a.chat, a.limit), ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
