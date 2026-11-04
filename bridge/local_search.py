#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""本地知识库搜索 + 关键词注意力 + 联网入库。

宿主工具调用：
  python local_search.py --db ~/.dsh/wechat-bridge-memory.db --query "上周的配置" --mode search
  python local_search.py --db ... --query "部署" --mode keywords --web --search-url ... --limit 5

联网搜索默认 Tavily（需要密钥）；没有密钥时退到 DuckDuckGo HTML。
输出 JSON（stdout），不打印其他东西。
"""

import argparse
import html
import json
import math
import os
import re
import sqlite3
import sys
import time
import urllib.parse
import urllib.request

_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
)
_停用词 = {
    "的", "了", "是", "在", "我", "你", "他", "她", "它", "们", "这", "那", "个",
    "我们", "你们", "他们", "这个", "那个", "一个", "没有", "就是", "还是",
    "什么", "怎么", "为什么", "可以", "但是", "因为", "所以", "然后", "现在",
    "今天", "昨天", "明天", "一下", "不是", "自己", "知道", "觉得", "时候",
    "the", "and", "for", "you", "are", "was", "with", "this", "that", "have",
}

_WEB_SCHEMA = """
CREATE TABLE IF NOT EXISTS web_info(
  id INTEGER PRIMARY KEY, key TEXT UNIQUE, query TEXT, title TEXT, url TEXT,
  text TEXT, tokens TEXT, keywords TEXT, ts REAL, source TEXT
);
CREATE VIRTUAL TABLE IF NOT EXISTS web_info_fts USING fts5(
  tokens, title, url, text, content='web_info', content_rowid='id'
);
CREATE TRIGGER IF NOT EXISTS web_info_ai AFTER INSERT ON web_info BEGIN
  INSERT INTO web_info_fts(rowid, tokens, title, url, text)
  VALUES(new.id, new.tokens, new.title, new.url, new.text);
END;
CREATE TRIGGER IF NOT EXISTS web_info_ad AFTER DELETE ON web_info BEGIN
  INSERT INTO web_info_fts(web_info_fts, rowid, tokens, title, url, text)
  VALUES('delete', old.id, old.tokens, old.title, old.url, old.text);
END;
CREATE TRIGGER IF NOT EXISTS web_info_au AFTER UPDATE ON web_info BEGIN
  INSERT INTO web_info_fts(web_info_fts, rowid, tokens, title, url, text)
  VALUES('delete', old.id, old.tokens, old.title, old.url, old.text);
  INSERT INTO web_info_fts(rowid, tokens, title, url, text)
  VALUES(new.id, new.tokens, new.title, new.url, new.text);
END;
CREATE TABLE IF NOT EXISTS search_groups(
  id INTEGER PRIMARY KEY, query TEXT, ts REAL, results TEXT, keywords TEXT
);
CREATE TABLE IF NOT EXISTS search_keywords(
  group_id INTEGER, keyword TEXT, weight REAL DEFAULT 1.0, count INTEGER DEFAULT 1,
  PRIMARY KEY(group_id, keyword)
);
"""


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


def _提取关键词(text, n=8):
    counts = {}
    for t in 分词(text):
        if len(t) < 2:
            continue
        counts[t] = counts.get(t, 0) + 1
    items = sorted(counts.items(), key=lambda kv: (kv[1], len(kv[0])), reverse=True)
    return [k for k, _ in items[:n]]


def _建web表(con):
    con.executescript(_WEB_SCHEMA)


def _连接(db_path):
    con = sqlite3.connect(db_path, timeout=5)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA busy_timeout=5000")
    return con


def _匹配词(query):
    toks = 分词(query)
    if not toks:
        return ""
    # 去重，避免 MATCH 里重复词拖慢
    seen = []
    for t in toks:
        if t not in seen:
            seen.append(t)
    return " OR ".join('"%s"' % t.replace('"', '""') for t in seen[:24])


def 搜索(db_path, query, chat="", limit=8):
    if not db_path or not os.path.isfile(db_path):
        return {"ok": False, "说": "本地库还没建好（桥接启动后会自动建）"}
    match = _匹配词(query)
    if not match:
        return {"ok": True, "messages": [], "notes": [], "web": []}
    limit = max(1, min(30, int(limit or 8)))
    try:
        con = _连接(db_path)
    except Exception as e:
        return {"ok": False, "说": "打开本地库失败：%s" % e}

    out = {"ok": True, "messages": [], "notes": [], "web": []}
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
        out["说"] = (out.get("说") + "；" if out.get("说") else "") + "笔记检索失败：%s" % e

    try:
        sql3 = (
            "SELECT w.title, w.url, w.text, w.ts, bm25(web_info_fts) AS score "
            "FROM web_info_fts JOIN web_info w ON w.id=web_info_fts.rowid "
            "WHERE web_info_fts MATCH ? ORDER BY score ASC LIMIT ?"
        )
        for r in con.execute(sql3, [match, limit]):
            out["web"].append({
                "title": r["title"] or "",
                "url": r["url"] or "",
                "ts": time.strftime("%Y-%m-%d %H:%M", time.localtime(float(r["ts"] or 0))),
                "text": (r["text"] or "")[:800],
            })
    except sqlite3.OperationalError as e:
        out["说"] = (out.get("说") + "；" if out.get("说") else "") + "联网检索失败：%s" % e

    con.close()
    return out


# ---------- 联网搜索 ----------

def _联网搜索(query, search_url, key, limit):
    url = str(search_url or "https://api.tavily.com/search").strip()
    limit = max(1, min(10, int(limit or 5)))
    if key and url:
        try:
            体 = {"query": query, "max_results": limit}
            if "tavily" in url:
                体.update({"api_key": key, "search_depth": "basic", "include_answer": True})
            else:
                体.update({"api_key": key})
            req = urllib.request.Request(
                url,
                data=json.dumps(体, ensure_ascii=False).encode("utf-8"),
                headers={"Content-Type": "application/json", "User-Agent": _UA},
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=15) as r:
                data = json.loads(r.read().decode("utf-8", "ignore"))
            out = []
            ans = str(data.get("answer") or "").strip()
            if ans:
                out.append({"title": "联网摘要", "url": "", "content": ans})
            for x in data.get("results") or data.get("organic") or []:
                out.append({
                    "title": str(x.get("title") or ""),
                    "url": str(x.get("url") or x.get("link") or ""),
                    "content": str(x.get("content") or x.get("snippet") or ""),
                })
            if out:
                return out[:limit]
        except Exception:
            pass

    # 没有密钥 / 接口失败：DuckDuckGo HTML 兜底
    try:
        q = urllib.parse.quote_plus(query)
        req = urllib.request.Request(
            "https://html.duckduckgo.com/html/?q=" + q,
            headers={"User-Agent": _UA},
        )
        with urllib.request.urlopen(req, timeout=15) as r:
            page = r.read().decode("utf-8", "ignore")
        results = []
        for m in re.finditer(
            r'<a[^>]+class="result__a"[^>]*href="([^"]+)"[^>]*>(.*?)</a>', page, re.S
        ):
            href = html.unescape(m.group(1))
            title = re.sub(r"<[^>]+>", "", html.unescape(m.group(2))).strip()
            u = urllib.parse.urlparse(href)
            qs = urllib.parse.parse_qs(u.query)
            if "uddg" in qs:
                href = qs["uddg"][0]
            results.append({"title": title, "url": href, "content": ""})
        snippets = re.findall(
            r'class="result__snippet"[^>]*>(.*?)</(?:a|div|td)>', page, re.S
        )
        for i, s in enumerate(snippets[: len(results)]):
            results[i]["content"] = re.sub(r"<[^>]+>", "", html.unescape(s)).strip()
        return [x for x in results if x["title"] or x["content"]][:limit]
    except Exception:
        return []


def web_store(db_path, query, results):
    """把联网结果写进 web_info（会按需建表），返回写入条数。"""
    if not results:
        return 0
    con = _连接(db_path)
    _建web表(con)
    n = 0
    now = time.time()
    try:
        for i, r in enumerate(results):
            title = str(r.get("title") or "").strip()
            link = str(r.get("url") or "").strip()
            content = str(r.get("content") or "").strip()
            text = (title + "\n" + content).strip()
            if not text:
                continue
            keyv = link or ("%s|%d" % (query, i))
            con.execute(
                "INSERT OR REPLACE INTO web_info(key, query, title, url, text, tokens, keywords, ts, source)"
                " VALUES(?,?,?,?,?,?,?,?,?)",
                (
                    keyv,
                    query,
                    title,
                    link,
                    text[:5000],
                    " ".join(分词(text)),
                    " ".join(_提取关键词(text, 8)),
                    now,
                    "web",
                ),
            )
            n += 1
        con.commit()
    finally:
        con.close()
    return n


def web_ingest(db_path, query, search_url, key, limit=5):
    results = _联网搜索(query, search_url, key, limit)
    if not results:
        return {"ok": False, "说": "联网搜索没有结果（检查网络 / 搜索密钥）", "结果": []}
    try:
        n = web_store(db_path, query, results)
    except Exception as e:
        return {"ok": False, "说": "写联网结果失败：%s" % e, "结果": []}
    return {"ok": True, "说": "联网搜索写入 %d 条" % n, "结果": results}


# ---------- 关键词注意力 ----------

def _关键词权重(con):
    """读取独立搜索区块里设置的关键词权重（同词取最大值）。"""
    out = {}
    try:
        for r in con.execute(
            "SELECT keyword, weight FROM search_keywords ORDER BY group_id DESC LIMIT 500"
        ):
            k = str(r["keyword"] or "").strip()
            if not k:
                continue
            try:
                w = float(r["weight"] if r["weight"] is not None else 1.0)
            except Exception:
                w = 1.0
            out[k] = max(out.get(k, 0.0), w)
    except Exception:
        pass
    return out


def _注意力排序(候选, query, top=5, 权重=None):
    """关键词/注意力排序：重叠越多、权重越高、来源越可信、越新，占比越高。"""
    q = set(分词(query))
    权 = 权重 or {}
    now = time.time()
    打分 = []
    for c in 候选:
        text = (str(c.get("title") or "") + " " + str(c.get("text") or "")).strip()
        toks = set(分词(text))
        overlap = q & toks
        if q and not overlap:
            continue
        来源 = {"web": 1.2, "note": 1.0, "message": 0.9}.get(c.get("kind"), 0.9)
        age = max(0.0, now - float(c.get("ts") or now))
        新近 = math.exp(-age / (30 * 86400))
        密度 = (len(overlap) / (len(toks) ** 0.5)) if toks else 0.0
        重叠分 = sum(权.get(t, 1.0) for t in overlap)
        score = 重叠分 * 2.0 + 密度 + 来源 + 0.3 * 新近
        kw = ""
        if overlap:
            kw = max(overlap, key=lambda t: (text.count(t), len(t), t))
        if not kw:
            ks = _提取关键词(text, 1)
            kw = ks[0] if ks else ""
        打分.append((score, kw, c))

    if not 打分:
        return []
    打分.sort(key=lambda x: x[0], reverse=True)
    取 = 打分[: max(1, int(top or 5))]
    最大 = max(s for s, _, _ in 取)
    exps = [math.exp(s - 最大) for s, _, _ in 取]
    合计 = sum(exps) or 1.0
    out = []
    for (score, kw, c), e in zip(取, exps):
        out.append({
            "keyword": kw,
            "score": round(score, 3),
            "weight": round(e / 合计, 4),
            "percent": round(100.0 * e / 合计, 1),
            "kind": c.get("kind") or "",
            "ref": c.get("ref") or "",
            "title": c.get("title") or "",
            "text": str(c.get("text") or "")[:600],
            "ts": c.get("ts") or 0,
        })
    return out


def 关键词检索(db_path, query, chat="", top=5, web=False, search_url="", key="", web_limit=5):
    if not db_path or not os.path.isfile(db_path):
        return {"ok": False, "说": "本地库还没建好（桥接启动后会自动建）"}
    match = _匹配词(query)
    if not match:
        return {"ok": True, "items": [], "说": "查询为空"}
    top = max(1, min(5, int(top or 5)))
    web_msg = ""
    if web:
        r = web_ingest(db_path, query, search_url, key, web_limit)
        web_msg = str(r.get("说") or "")
    try:
        con = _连接(db_path)
    except Exception as e:
        return {"ok": False, "说": "打开本地库失败：%s" % e}

    候选 = []
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
        sql += " ORDER BY score ASC LIMIT 20"
        for r in con.execute(sql, params):
            候选.append({
                "kind": "message",
                "ref": r["chat"] or r["chat_id"] or "",
                "title": "%s · %s" % (r["chat"] or "", r["sender"] or "某人"),
                "text": r["text"] or "",
                "ts": float(r["ts"] or 0),
            })
    except sqlite3.OperationalError:
        pass

    try:
        for r in con.execute(
            "SELECT n.path, n.title, n.text, n.mtime FROM notes_fts "
            "JOIN notes n ON n.id=notes_fts.rowid WHERE notes_fts MATCH ? "
            "ORDER BY bm25(notes_fts) ASC LIMIT 20",
            [match],
        ):
            候选.append({
                "kind": "note",
                "ref": r["path"] or "",
                "title": r["title"] or "",
                "text": r["text"] or "",
                "ts": float(r["mtime"] or 0),
            })
    except sqlite3.OperationalError:
        pass

    try:
        for r in con.execute(
            "SELECT w.title, w.url, w.text, w.ts FROM web_info_fts "
            "JOIN web_info w ON w.id=web_info_fts.rowid WHERE web_info_fts MATCH ? "
            "ORDER BY bm25(web_info_fts) ASC LIMIT 20",
            [match],
        ):
            候选.append({
                "kind": "web",
                "ref": r["url"] or "",
                "title": r["title"] or "",
                "text": r["text"] or "",
                "ts": float(r["ts"] or 0),
            })
    except sqlite3.OperationalError:
        pass

    词权 = _关键词权重(con)
    con.close()
    items = _注意力排序(候选, query, top, 词权)
    out = {"ok": True, "items": items}
    if web_msg:
        out["说"] = web_msg
    return out


def main():
    p = argparse.ArgumentParser(description="DSH WeChat bridge local search")
    p.add_argument("--db", required=True)
    p.add_argument("--query", required=True)
    p.add_argument("--chat", default="")
    p.add_argument("--limit", type=int, default=8)
    p.add_argument("--mode", choices=("search", "keywords"), default="search")
    p.add_argument("--web", action="store_true")
    p.add_argument("--search-url", default="https://api.tavily.com/search")
    p.add_argument("--web-limit", type=int, default=5)
    a = p.parse_args()
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    key = os.environ.get("WECHAT_SEARCH_KEY") or ""
    if a.mode == "keywords":
        r = 关键词检索(
            a.db, a.query, a.chat, a.limit, a.web, a.search_url, key, a.web_limit
        )
        print(json.dumps(r, ensure_ascii=False))
    else:
        print(json.dumps(搜索(a.db, a.query, a.chat, a.limit), ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
