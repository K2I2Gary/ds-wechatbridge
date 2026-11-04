#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""独立联网搜索：抓网页关键词、每次搜索存一组（含关键词权重）。

单独跑：
  python bridge/web_search.py "DeepSeek 最近发布" --limit 5
  python bridge/web_search.py --list-groups --db ~/.dsh/wechat-bridge-memory.db
  python bridge/web_search.py --set-weights 12 '{"关键词": 3.5}' --db ...

不需要桥接进程。输出 JSON（stdout）。
"""

import argparse
import html
import json
import math
import os
import re
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import local_search as ls  # noqa: E402


def _slug(q):
    s = re.sub(r"[^\w一-鿿.-]+", "_", str(q or "")).strip("._")
    return s[:40] or "search"


def _抓网页(url):
    """抓一个结果页，抽成纯文本（限 1.5MB / 6 秒）。失败返回空。"""
    try:
        if not re.match(r"^https?://", str(url or ""), re.I):
            return ""
        req = urllib.request.Request(str(url), headers={"User-Agent": ls._UA})
        with urllib.request.urlopen(req, timeout=6) as r:
            ctype = str(r.headers.get("content-type") or "")
            raw = r.read(1500000)
        if "html" not in ctype and "text" not in ctype:
            return ""
        text = raw.decode("utf-8", "ignore")
        text = re.sub(r"(?is)<(script|style|noscript).*?</\1>", " ", text)
        text = re.sub(r"<[^>]+>", " ", text)
        text = html.unescape(text)
        text = re.sub(r"\s+", " ", text).strip()
        return text
    except Exception:
        return ""


def _网页关键词(results, fetch=True):
    """抓每条结果的网页正文，提取关键词并聚合。"""
    pages = [""] * len(results)
    if fetch and results:
        def 取(r):
            return _抓网页(r.get("url") or "")

        try:
            with ThreadPoolExecutor(max_workers=4) as ex:
                pages = list(ex.map(取, results))
        except Exception:
            pages = [""] * len(results)

    counts = {}
    for i, r in enumerate(results):
        page = pages[i] or ""
        base = (
            str(r.get("title") or "")
            + " "
            + str(r.get("content") or "")
            + " "
            + page[:8000]
        )
        kws = ls._提取关键词(base, 12)
        r["page_keywords"] = kws
        if page:
            r["content"] = (str(r.get("content") or "") + "\n" + page[:1200]).strip()[:3000]
        for k in kws:
            counts[k] = counts.get(k, 0) + 1

    top = sorted(counts.items(), key=lambda kv: (kv[1], len(kv[0])), reverse=True)[:12]
    mx = top[0][1] if top else 1
    return [
        {
            "keyword": k,
            "count": c,
            "weight": round(max(0.5, c / mx * 5.0), 1),
        }
        for k, c in top
    ]


def _保存(query, results, save_dir, keywords=None):
    try:
        os.makedirs(save_dir, exist_ok=True)
        name = time.strftime("%Y%m%d-%H%M%S") + "-" + _slug(query) + ".md"
        path = os.path.join(save_dir, name)
        lines = [
            "# 联网搜索：%s" % query,
            "",
            "- 时间：%s" % time.strftime("%Y-%m-%d %H:%M:%S"),
            "- 条数：%d" % len(results),
        ]
        if keywords:
            lines.append("- 关键词：" + "、".join(
                "%s(%s)" % (k.get("keyword"), k.get("weight")) for k in keywords
            ))
        lines.append("")
        for i, r in enumerate(results, 1):
            title = str(r.get("title") or "").strip() or "（无标题）"
            url = str(r.get("url") or "").strip()
            content = str(r.get("content") or "").strip()
            lines.append("## %d. %s" % (i, title))
            if url:
                lines.append("")
                lines.append("<%s>" % url)
            if content:
                lines.append("")
                lines.append(content)
            lines.append("")
        with open(path, "w", encoding="utf-8") as f:
            f.write("\n".join(lines).strip() + "\n")
        return path
    except Exception as e:
        return "保存失败：%s" % e


def _保存json(query, results, keywords, save_dir):
    """把信息要点存成 JSON，方便本地记忆/其它程序直接调取。"""
    try:
        os.makedirs(save_dir, exist_ok=True)
        name = time.strftime("%Y%m%d-%H%M%S") + "-" + _slug(query) + ".json"
        path = os.path.join(save_dir, name)
        data = {
            "query": query,
            "ts": time.time(),
            "keywords": keywords or [],
            "points": [
                {
                    "keyword": k.get("keyword"),
                    "weight": k.get("weight"),
                    "count": k.get("count"),
                }
                for k in (keywords or [])
            ],
            "results": [
                {
                    "title": r.get("title") or "",
                    "url": r.get("url") or "",
                    "content": str(r.get("content") or "")[:1200],
                    "page_keywords": r.get("page_keywords") or [],
                }
                for r in (results or [])
            ],
        }
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        return path
    except Exception as e:
        return "保存失败：%s" % e


def _存组(db_path, query, results, keywords):
    con = ls._连接(db_path)
    ls._建web表(con)
    try:
        cur = con.execute(
            "INSERT INTO search_groups(query, ts, results, keywords) VALUES(?,?,?,?)",
            (
                query,
                time.time(),
                json.dumps(results, ensure_ascii=False),
                json.dumps(keywords, ensure_ascii=False),
            ),
        )
        gid = int(cur.lastrowid)
        for k in keywords:
            con.execute(
                "INSERT OR REPLACE INTO search_keywords(group_id, keyword, weight, count)"
                " VALUES(?,?,?,?)",
                (gid, k.get("keyword"), float(k.get("weight") or 1), int(k.get("count") or 1)),
            )
        con.commit()
        return gid
    finally:
        con.close()


def _列组(db_path, limit=5):
    if not db_path or not os.path.isfile(db_path):
        return {"ok": True, "groups": []}
    con = ls._连接(db_path)
    ls._建web表(con)
    try:
        rows = con.execute(
            "SELECT id, query, ts, results, keywords FROM search_groups"
            " ORDER BY id DESC LIMIT ?",
            (max(1, min(20, int(limit or 5))),),
        ).fetchall()
        groups = []
        for r in rows:
            try:
                results = json.loads(r["results"] or "[]")
            except Exception:
                results = []
            try:
                kws = json.loads(r["keywords"] or "[]")
            except Exception:
                kws = []
            wmap = {
                x["keyword"]: float(x["weight"] or 1)
                for x in con.execute(
                    "SELECT keyword, weight FROM search_keywords WHERE group_id=?",
                    (r["id"],),
                )
            }
            for k in kws:
                if k.get("keyword") in wmap:
                    k["weight"] = round(wmap[k["keyword"]], 1)
            groups.append({
                "id": r["id"],
                "query": r["query"],
                "ts": r["ts"],
                "results": results,
                "keywords": kws,
            })
        return {"ok": True, "groups": groups}
    finally:
        con.close()


def _设权重(db_path, group, weights):
    if not db_path or not os.path.isfile(db_path):
        return {"ok": False, "说": "本地库不存在"}
    con = ls._连接(db_path)
    ls._建web表(con)
    try:
        n = 0
        for kw, w in (weights or {}).items():
            try:
                w = max(0.0, min(10.0, float(w)))
            except Exception:
                continue
            cur = con.execute(
                "UPDATE search_keywords SET weight=? WHERE group_id=? AND keyword=?",
                (w, int(group), str(kw)),
            )
            n += cur.rowcount
        con.commit()
        return {"ok": True, "说": "更新 %d 个关键词权重" % n}
    finally:
        con.close()


def main():
    p = argparse.ArgumentParser(description="独立联网搜索（不需要启动桥接）")
    p.add_argument("query", nargs="?", default="", help="要搜索的内容")
    p.add_argument("--query", dest="query2", default="", help="同 query")
    p.add_argument("--limit", type=int, default=5)
    p.add_argument("--search-url", default="https://api.tavily.com/search")
    p.add_argument("--key", default="")
    p.add_argument("--save-dir", default="")
    p.add_argument("--no-save", action="store_true")
    p.add_argument("--no-fetch", action="store_true", help="不抓网页正文，只用搜索摘要")
    p.add_argument("--db", default="", help="写入本地库；留空不写")
    p.add_argument("--list-groups", action="store_true")
    p.add_argument("--group-limit", type=int, default=5)
    p.add_argument("--set-weights", nargs=2, metavar=("GROUP", "JSON"), default=None)
    a = p.parse_args()
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

    if a.list_groups:
        print(json.dumps(_列组(a.db, a.group_limit), ensure_ascii=False))
        return 0

    if a.set_weights:
        try:
            weights = json.loads(a.set_weights[1])
        except Exception:
            weights = {}
        print(json.dumps(_设权重(a.db, a.set_weights[0], weights), ensure_ascii=False))
        return 0

    query = (a.query or a.query2 or "").strip()
    if not query:
        print(json.dumps({"ok": False, "说": "缺 query"}, ensure_ascii=False))
        return 1

    key = a.key or os.environ.get("WECHAT_SEARCH_KEY") or ""
    results = ls._联网搜索(query, a.search_url, key, max(1, min(10, a.limit)))
    if not results:
        print(json.dumps({
            "ok": False,
            "query": query,
            "说": "联网搜索没有结果（检查网络 / 搜索密钥）",
            "results": [],
        }, ensure_ascii=False))
        return 0

    keywords = _网页关键词(results, not a.no_fetch)

    saved = ""
    saved_json = ""
    if not a.no_save:
        d = a.save_dir or os.path.join(
            os.environ.get("DSH_HOME") or os.path.join(os.path.expanduser("~"), ".dsh"),
            "wechat-bridge-notes",
            "web",
        )
        saved = _保存(query, results, d, keywords)
        saved_json = _保存json(query, results, keywords, d)

    db_n = 0
    db_err = ""
    gid = None
    if a.db:
        try:
            os.makedirs(os.path.dirname(a.db) or ".", exist_ok=True)
            db_n = ls.web_store(a.db, query, results)
            gid = _存组(a.db, query, results, keywords)
        except Exception as e:
            db_err = str(e)

    group = None
    if gid is not None:
        group = {
            "id": gid,
            "query": query,
            "ts": time.time(),
            "results": results,
            "keywords": keywords,
            "saved_json": saved_json,
        }

    print(json.dumps({
        "ok": True,
        "query": query,
        "count": len(results),
        "results": results,
        "keywords": keywords,
        "group": group,
        "saved": saved,
        "saved_json": saved_json,
        "db_written": db_n,
        "db": a.db,
        "说": ("已保存到 %s" % saved if saved else "未保存文件")
        + ("；要点 JSON：%s" % saved_json if saved_json else "")
        + ("；已写入本地库 %d 条" % db_n if db_n else "")
        + ("；本地库写入失败：%s" % db_err if db_err else ""),
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
