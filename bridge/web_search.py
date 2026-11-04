#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""独立联网搜索：不依赖桥接进程，搜索后保存成本地文件（并写 web_info 表）。

单独跑：
  python bridge/web_search.py "DeepSeek 最近发布" --limit 5
  python bridge/web_search.py "..." --key <Tavily key> --no-save
"""

import argparse
import json
import os
import re
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import local_search as ls  # noqa: E402


def _slug(q):
    s = re.sub(r"[^\w一-鿿.-]+", "_", str(q or "")).strip("._")
    return (s[:40] or "search")


def _保存(query, results, save_dir):
    try:
        os.makedirs(save_dir, exist_ok=True)
        name = time.strftime("%Y%m%d-%H%M%S") + "-" + _slug(query) + ".md"
        path = os.path.join(save_dir, name)
        lines = [
            "# 联网搜索：%s" % query,
            "",
            "- 时间：%s" % time.strftime("%Y-%m-%d %H:%M:%S"),
            "- 条数：%d" % len(results),
            "",
        ]
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


def main():
    p = argparse.ArgumentParser(description="独立联网搜索（不需要启动桥接）")
    p.add_argument("query", nargs="?", default="", help="要搜索的内容")
    p.add_argument("--query", dest="query2", default="", help="同 query")
    p.add_argument("--limit", type=int, default=5)
    p.add_argument("--search-url", default="https://api.tavily.com/search")
    p.add_argument("--key", default="")
    p.add_argument("--save-dir", default="")
    p.add_argument("--no-save", action="store_true")
    p.add_argument("--db", default="", help="写入 web_info 的本地库；留空不写")
    a = p.parse_args()
    query = (a.query or a.query2 or "").strip()
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
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

    saved = ""
    if not a.no_save:
        d = a.save_dir or os.path.join(
            os.environ.get("DSH_HOME") or os.path.join(os.path.expanduser("~"), ".dsh"),
            "wechat-bridge-notes",
            "web",
        )
        saved = _保存(query, results, d)

    db_n = 0
    db_err = ""
    if a.db:
        try:
            os.makedirs(os.path.dirname(a.db) or ".", exist_ok=True)
            db_n = ls.web_store(a.db, query, results)
        except Exception as e:
            db_err = str(e)

    print(json.dumps({
        "ok": True,
        "query": query,
        "count": len(results),
        "results": results,
        "saved": saved,
        "db_written": db_n,
        "db": a.db,
        "说": ("已保存到 %s" % saved if saved else "未保存文件")
        + ("；已写入本地库 %d 条" % db_n if db_n else "")
        + ("；本地库写入失败：%s" % db_err if db_err else ""),
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
