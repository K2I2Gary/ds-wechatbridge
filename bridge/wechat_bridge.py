#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
DSH · 微信桥接（不注入、不修改微信）

原理：
  - 收：读微信 4.x 本地 SQLite 数据库（只读，要求微信处于登录状态）
  - 发：Windows UI 自动化 + 剪贴板，驱动微信窗口真的去打字发送
  - 中间：把消息推给 DSH 插件（POST /dsh-wechat-bridge/receive），
          再把待发的取回来（GET /dsh-wechat-bridge/outbox）

一般不用手跑 —— DSH 设置页里点「启动桥接」，插件会用自己建的 venv 起它。

手跑：
  <venv>\\Scripts\\python.exe bridge\\wechat_bridge.py --dsh http://127.0.0.1:3080
"""

import argparse
import base64
import hashlib
import html
import json
import os
import random
import re
import sys
import tempfile
import shutil
import threading
import time
import traceback
import urllib.error
import urllib.request

# 有些嵌入式 Python 探测不到可写的临时目录（C 盘 TEMP 被安全软件拦住时会这样），
# 这里兜底指到桥目录下自己的 tmp/，否则 tempfile.gettempdir() 会直接抛 FileNotFoundError。
try:
    tempfile.gettempdir()
except Exception:
    _兜底临时 = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'tmp')
    try:
        os.makedirs(_兜底临时, exist_ok=True)
    except Exception:
        pass
    tempfile.tempdir = _兜底临时
    os.environ['TEMP'] = _兜底临时
    os.environ['TMP'] = _兜底临时

HERE = os.path.dirname(os.path.abspath(__file__))
LOG_PATH = os.path.join(HERE, "bridge.log")

# 可选的小补丁：同目录有 uia_compat.py 就加载（某些微信小版本需要）
UIA_COMPAT = True


def log(*a):
    line = "%s %s" % (time.strftime("%Y-%m-%d %H:%M:%S"), " ".join(str(x) for x in a))
    print(line, flush=True)
    try:
        with open(LOG_PATH, "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except Exception:
        pass


ARGS = None
DSH = ""
TOKEN = ""
ONLY_CHATS = []
SEND_ENABLED = True
SKIP_OLDER = 15.0
POLL_SEC = 2.0
# 群里只有被点名才转（正文里带这些词之一）。私聊不受这个限制。
ALIASES = []
DEFAULT_ALIASES = "大肥鱼,鲸鲸,鲸鱼娘,鲸鱼,肥鱼"

# 从 DSH 设置页拉的配置（每 30 秒刷一次）
CFG = {
    "群上下文条数": 6,
    "日记": True,
    "日记目录": "",
    "主人": [],
    "屏蔽": [],
}
CFG_TS = 0.0

# 微信里收到的图片 / 表情包落盘到这里，再把路径交给宿主去看图
INBOUND_DIR = os.path.join(
    os.environ.get("DSH_HOME") or os.path.join(os.path.expanduser("~"), ".dsh"),
    "wechat-inbound",
)
VISION_CACHE = os.path.join(os.path.dirname(INBOUND_DIR), "wechat-vision-cache.json")
# 宿主版本 ≥1.2.0 时它自己会看图；老宿主就由桥接先看好再发文字
HOST_VERSION = (1, 1, 0)


def _活跃群列表():
    """直接从磁盘配置读「活跃群」—— 宿主 /state 里暂时还没这个字段。"""
    home = os.environ.get("DSH_HOME") or os.path.join(os.path.expanduser("~"), ".dsh")
    path = os.path.join(home, "wechat-bridge-config.json")
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        return [str(x).strip() for x in (data.get("活跃群") or []) if str(x).strip()]
    except Exception:
        return []


def refresh_config():
    """问宿主要一次配置。设置页改完不用重启桥接。"""
    global CFG, CFG_TS
    r = http_json("/dsh-wechat-bridge/state")
    c = (r or {}).get("配置") if isinstance(r, dict) else None
    if not isinstance(c, dict):
        return False
    try:
        CFG = {
            "群上下文条数": max(0, min(50, int(c.get("群上下文条数") or 0))),
            "日记": bool(c.get("日记", True)),
            "日记目录": str(c.get("日记目录") or "").strip(),
            "主人": [str(x).strip() for x in (c.get("主人") or []) if str(x).strip()],
            "屏蔽": [str(x).strip() for x in (c.get("屏蔽") or []) if str(x).strip()],
            "群回复间隔秒": max(0.0, float(c.get("群回复间隔秒") or 0)),
            "群每小时上限": max(0.0, float(c.get("群每小时上限") or 0)),
        }
        CFG["活跃群"] = _活跃群列表()
        CFG_TS = time.time()
        return True
    except Exception as e:
        log("解析配置失败：", repr(e))
        return False


def parse_args():
    global DSH, TOKEN, ONLY_CHATS, SEND_ENABLED, SKIP_OLDER, POLL_SEC, ALIASES

    p = argparse.ArgumentParser(description="DSH WeChat bridge")
    p.add_argument("--dsh", default=os.environ.get("DSH_ORIGIN", "http://127.0.0.1:3080"))
    p.add_argument("--token", default=os.environ.get("DSH_BRIDGE_TOKEN", ""))
    p.add_argument("--only", default="", help="只转这些聊天，逗号分隔（留空 = 全部）")
    p.add_argument("--aliases", default=DEFAULT_ALIASES, help="群里叫这些名字才算在跟我说话")
    p.add_argument("--no-send", action="store_true", help="只收不发")
    p.add_argument("--skip-older", type=float, default=15.0)
    p.add_argument("--poll", type=float, default=2.0)
    p.add_argument("--test-image", default="", help="只看一张本地图片然后退出（调视图用）")
    a = p.parse_args()

    DSH = str(a.dsh).rstrip("/")
    TOKEN = str(a.token or "")
    ONLY_CHATS = [x.strip() for x in str(a.only or "").split(",") if x.strip()]
    ALIASES = [x.strip() for x in str(a.aliases or "").split(",") if x.strip()]
    SEND_ENABLED = not a.no_send
    SKIP_OLDER = float(a.skip_older or 15.0)
    POLL_SEC = float(a.poll or 2.0)
    return a


# @ 某人时微信会把机器 id 塞进正文，看着像乱码 —— 洗掉
_MENTION_ID = re.compile(r"wxid_[0-9a-zA-Z_-]+[:：]?")
_AT_TAG = re.compile(r"@[^\s@]{1,24}\s?")


def clean_text(text):
    t = _MENTION_ID.sub("", text or "")
    t = _AT_TAG.sub("", t)
    return " ".join(t.split()).strip()


# ---------- HTTP ----------

def http_json(path, payload=None, method=None):
    url = DSH + path
    data = None
    headers = {"content-type": "application/json"}
    if TOKEN:
        headers["x-bridge-token"] = TOKEN
    if payload is not None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        method = method or "POST"
    req = urllib.request.Request(url, data=data, headers=headers, method=method or "GET")
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return json.loads(r.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as e:
        return {"ok": False, "说": "HTTP %s" % e.code}
    except Exception as e:
        return {"ok": False, "说": str(e)}


def main():
    global HOST_VERSION, ARGS
    ARGS = parse_args()
    log("DSH 地址：", DSH, "｜只收不发：", not SEND_ENABLED)

    log("import wechatauto …（第一次会慢）")
    try:
        from wechatauto import WeChatDB, WeChatGUI
        from wechatauto.db import Listener

        # 拟人节流：默认 natural 档是「120 秒最多 6 次写」，撞上就冷却 60 秒左右。
        # 我这边一次回复要发好几段，很容易撞线 —— 撞线时消息发不出去，
        # 上层会以为失败再重试，重试又撞线，就出现了「卡住」「重复」。
        # 调到 fast 档（120 秒 20 次），保留节奏，但不会把正常聊天卡死。
        try:
            from wechatauto import rhythm as _rhythm

            _rhythm.set_profile('fast')
            _rhythm.configure(burst=30)   # 120 秒内 30 次，别再把正常回复卡住
            _p = _rhythm.profile()
            log("发送节流档位：", _p.name, "（%d 秒内 %d 次）" % (int(_p.window), _p.burst))
        except Exception as _e:
            log("节流档位调整失败（不影响用）：", repr(_e))
    except Exception as e:
        log("✗ import wechatauto 失败：", repr(e))
        log("  依赖没装好 —— 回 DSH 设置页点「装依赖」")
        return 2

    if UIA_COMPAT:
        try:
            import uia_compat  # noqa: F401

            log("uia_compat.apply() =", uia_compat.apply())
        except ImportError:
            pass
        except Exception as e:
            log("⚠ uia_compat 出错（继续跑）：", repr(e))

    log("连接微信数据库（只读）…")
    try:
        db = WeChatDB()
    except Exception as e:
        log("✗ 连不上微信数据库：", repr(e))
        log("  检查：微信登录了吗？微信 → 设置 → 文件管理 → 默认保存位置")
        return 2
    me = getattr(db, "wxid", "")
    log("当前账号 wxid：", me)
    try:
        info = db.get_self_info() or {}
        log("昵称：", info.get("nick_name") or info.get("remark") or "?")
    except Exception:
        pass

    name_cache = {}

    def display_name(username):
        if username in name_cache:
            return name_cache[username]
        name = ""
        try:
            if str(username).endswith("@chatroom"):
                name = db.group_id_to_name(username) or ""
            else:
                name = db.get_nickname(username) or ""
        except Exception:
            name = ""
        if name:
            name_cache[username] = name
        return name

    # ---------- 群回复频率 ----------

    chat_hits = {}      # 群名 -> [时间戳]

    def 频率允许(chat):
        gap = CFG.get("群回复间隔秒") or 0
        per_hour = CFG.get("群每小时上限") or 0
        if not gap and not per_hour:
            return True
        now = time.time()
        hits = [t for t in chat_hits.get(chat, []) if now - t < 3600]
        if gap and hits and now - hits[-1] < gap:
            log("群频率：%s 刚回过，%.0f 秒内不再接" % (chat, gap))
            return False
        if per_hour and len(hits) >= per_hour:
            log("群频率：%s 这一小时已经接了 %d 次，够了" % (chat, len(hits)))
            return False
        hits.append(now)
        chat_hits[chat] = hits
        return True

    # ---------- 屏蔽 / 主人 / 日记 / 群上下文 ----------

    def is_blocked(chat, nickname, cid=""):
        # 屏蔽名单三种写法都认：显示名（群名/昵称）、群里的 wxid、会话 id。
        # 只认显示名的话，一改备注就漏，所以底层那个码永远多认一份。
        for b in CFG["屏蔽"]:
            if b and (b == chat or b == nickname or (cid and b == cid)):
                return True
        return False

    def is_master(sender_id, nickname):
        # 认人看微信里显示的名字（昵称/备注），wxid 也认一份当补充 —— 规矩就这样。
        for m in CFG["主人"]:
            if m and (m == sender_id or (nickname and m == nickname)):
                return True
        return False

    def diary_path(chat):
        base = CFG["日记目录"] or os.path.join(os.path.expanduser("~"), ".dsh", "wechat-diary")
        day = time.strftime("%Y-%m-%d")
        safe = re.sub(r'[\\/:*?"<>|\s]+', "_", chat).strip("_")[:60] or "群"
        return os.path.join(base, day, safe + ".md")

    def diary_append(chat, ts, who, content):
        p = diary_path(chat)
        try:
            os.makedirs(os.path.dirname(p), exist_ok=True)
            new = not os.path.exists(p)
            with open(p, "a", encoding="utf-8") as f:
                if new:
                    f.write("# %s · %s\n\n" % (chat, time.strftime("%Y-%m-%d")))
                t = time.strftime("%H:%M", time.localtime(ts or time.time()))
                f.write("- %s %s：%s\n" % (t, who or "某人", content))
        except Exception as e:
            log("写日记失败：", repr(e))

    def group_context(username, chat, limit):
        """那群最近在聊什么 —— 拼成一段给模型看。"""
        if limit <= 0:
            return ""
        try:
            rows = db.get_messages(username, limit=limit + 2)
        except Exception as e:
            log("取群上下文失败：", repr(e))
            return ""
        if not rows:
            return ""
        try:
            rows = sorted(rows, key=lambda m: float(m.get("create_time") or 0))
        except Exception:
            pass
        rows = rows[:-1][-limit:]      # 最后一条就是当前这句，去掉
        lines = []
        for m in rows:
            if (m.get("type") or "") != "文本":
                continue
            txt = clean_text(m.get("content") or "")
            if not txt or txt.startswith("<"):
                continue
            ts = float(m.get("create_time") or 0)
            t = time.strftime("%H:%M", time.localtime(ts)) if ts else "??:??"
            sid = m.get("sender_username") or ""
            lines.append("[%s] %s：%s" % (t, display_name(sid) or "某人", txt))
        if not lines:
            return ""
        return "（「%s」刚才在聊：\n%s\n）\n" % (chat, "\n".join(lines))

    # ---------- 表情包：正文里的 [表情: 描述] 变成真图片 ----------

    # 和前端配图器（dsh-meme client.js 的 matchDesc）同一套规则，不然同一条回复
    # 在 Web 里配到的图，和微信里发出去的会是两张。
    _RE_MEME = re

    def _fold_caption(s):
        s = str(s or "").strip()
        s = _RE_MEME.sub(r'[\u201c\u201d\u2018\u2019\u300c\u300d\u300e\u300f\u00ab\u00bb]', '"', s)
        return _RE_MEME.sub(r"\s+", " ", s)

    def _loose_caption(s):
        return _RE_MEME.sub(r'["\'\s]', "", _fold_caption(s))

    _TOKEN_SPLIT = _RE_MEME.compile(r'[\s,.!?;:\u3001\uff0c\u3002\uff01\uff1f\uff1b\uff1a"\u201c\u201d\'\u2018\u2019()\uff08\uff09\\[\\]\u3010\u3011\u300a\u300b\u2026\u00b7\uff5e~\\-]+')

    def _split_desc_tokens(s):
        parts = _TOKEN_SPLIT.split(_fold_caption(s))
        toks = [_RE_MEME.sub(r'["\']', "", p) for p in parts]
        toks = [t for t in toks if len(t) >= 2]
        toks.sort(key=len, reverse=True)
        return toks

    MEME = {"captions": {}, "keywords": {}, "rows": []}

    def load_memes():
        import glob
        import sqlite3

        dbs = []
        try:
            base = os.path.join(os.path.expanduser("~"), ".dsh", "profiles")
            dbs += glob.glob(os.path.join(base, "*", "node_modules", "dsh-meme", "memes", "*", "index.db"))
        except Exception:
            pass
        def 加键(表, key, path):
            raw = str(key or "").strip()
            if not raw:
                return
            for form in {raw, _fold_caption(raw), _loose_caption(raw)}:
                if form and form not in 表:
                    表[form] = path

        for dbp in dbs:
            pack = os.path.dirname(dbp)
            try:
                con = sqlite3.connect(dbp)
                for path, cap, kw, fn in con.execute("select path, caption, keywords, file_name from memes"):
                    absp = os.path.join(pack, str(path).replace("/", os.sep))
                    if not os.path.exists(absp):
                        continue
                    cap = str(cap or "").strip()
                    kw = str(kw or "")
                    fn = str(fn or "")
                    加键(MEME["captions"], cap, absp)
                    加键(MEME["captions"], fn, absp)
                    加键(MEME["captions"], cap[:80], absp)
                    加键(MEME["captions"], cap[:100], absp)
                    加键(MEME["keywords"], kw, absp)
                    for w in kw.split():
                        加键(MEME["keywords"], w, absp)
                    hay = []
                    parts = []
                    for s in (cap, kw, fn):
                        f = _fold_caption(s)
                        if not f:
                            continue
                        l = _loose_caption(s)
                        hay.append(f)
                        if l and l != f:
                            hay.append(l)
                        parts.append(s)
                    MEME["rows"].append({"hay": hay, "tokens": _split_desc_tokens(" ".join(parts)), "path": absp})
                con.close()
            except Exception as e:
                log("读表情库失败：", repr(e))
        if MEME["rows"]:
            log("表情库：%d 张（%s）" % (len(MEME["rows"]), "、".join(os.path.basename(os.path.dirname(d)) for d in dbs)))

    def find_meme(desc):
        """和前端 matchDesc 同一套优先级：caption 精确 > keyword 精确 > 分词最长命中。"""
        raw = str(desc or "").strip()
        if not raw:
            return ""
        forms = [raw, _fold_caption(raw), _loose_caption(raw)]
        for 表 in (MEME["captions"], MEME["keywords"]):
            for form in forms:
                hit = 表.get(form)
                if hit:
                    return hit
        needles = []
        for t in _split_desc_tokens(raw):
            l = _loose_caption(t)
            if l:
                needles.append(l)
        best, best_len, best_cnt = "", 0, 0
        for row in MEME["rows"]:
            longest = 0
            count = 0
            for needle in needles:
                length = len(needle) if any(needle in h for h in row["hay"]) else 0
                for tok in row["tokens"]:
                    t = _loose_caption(tok)
                    if t and (needle in t or t in needle):
                        length = max(length, min(len(needle), len(t)))
                if length:
                    longest = max(longest, length)
                    count += 1
            if longest > best_len or (longest == best_len and count > best_cnt):
                best, best_len, best_cnt = row["path"], longest, count
        return best

    # ---------- 发：从 DSH 取队列，用 UIA 发出去 ----------

    gui_box = {"gui": None}
    send_lock = threading.Lock()
    # 刚发出去的消息：同一个微信号，自己发的都会进库 ——
    # 靠这个列表把「我们发的」跟「主人自己在手机上打的」区分开，不然会自问自答。
    recently_sent = []
    # 上一次往外发的时间。文件传输助手发完立刻会被读回来，几秒内一律不看（防回环的兜底）
    STATE = {"last_send": 0.0}

    def 静音窗口操作(gui):
        """把 gui 上「会主动把微信拉到前台」的方法换成空操作。

        wechatauto 发送前习惯先 ensure_visible()（最小化遮挡窗口 + 置顶 +
        ShowWindow(SW_RESTORE)），这是窗口在后台发送时自己冒头的最大来源。
        UIA 写控件不需要窗口在前台，所以这里直接让它「当作已经可见」。
        图片发送走的是另一条显式前台路径（_ensure_wechat_ready(前台=True)），
        不受这里影响。
        """
        try:
            if getattr(gui, "_quiet_gui", False):
                return
            gui.ensure_visible = lambda *a, **k: True
            gui.bring_to_front = lambda *a, **k: True
            gui._minimize_blockers = lambda *a, **k: 0
            gui._quiet_gui = True
        except Exception as e:
            log("静音窗口操作失败（不影响发送）：", repr(e))

    def get_gui():
        if gui_box["gui"] is None:
            gui_box["gui"] = WeChatGUI()
            log("WeChatGUI 已就绪")
        return gui_box["gui"]

    def _foreground_wechat():
        """把微信主窗口拉到前面。只在发送失败重试时用 —— 平时不抢你的前台。"""
        try:
            import win32gui

            found = []

            def cb(hwnd, _):
                try:
                    if win32gui.IsWindowVisible(hwnd) and win32gui.GetWindowText(hwnd) == "微信":
                        found.append(hwnd)
                except Exception:
                    pass
                return True

            win32gui.EnumWindows(cb, None)
            if found:
                win32gui.ShowWindow(found[0], 9)          # SW_RESTORE
                win32gui.SetForegroundWindow(found[0])    # 拉到前面
                time.sleep(0.5)
                return True
        except Exception as e:
            log("把微信窗口拉到前面失败：", repr(e))
        return False

    def _minimize_wechat():
        """发完把微信收起来 —— 不然它被拉到前台，主人正在干别的就被打断了。"""
        try:
            import win32gui

            found = []

            def cb(hwnd, _):
                try:
                    if win32gui.IsWindowVisible(hwnd) and win32gui.GetWindowText(hwnd) == "微信":
                        found.append(hwnd)
                except Exception:
                    pass
                return True

            win32gui.EnumWindows(cb, None)
            if found:
                win32gui.ShowWindow(found[0], 6)          # SW_MINIMIZE
                return True
        except Exception as e:
            log("最小化微信失败：", repr(e))
        return False

    def _强设前台(hwnd):
        """把窗口真正顶到前台。

        单纯的 SetForegroundWindow 会被 Windows 的前台锁定拒绝（调用进程不是
        当前前台进程时）。先用 AttachThreadInput 把自己的输入队列接到当前前台
        窗口上，这个限制就绕过去了。
        """
        try:
            import ctypes

            user32 = ctypes.windll.user32
            fg = user32.GetForegroundWindow()
            tid_fg = user32.GetWindowThreadProcessId(fg, None)
            tid_me = user32.GetWindowThreadProcessId(hwnd, None)
            连上 = False
            if tid_fg and tid_me and tid_fg != tid_me:
                连上 = bool(user32.AttachThreadInput(tid_me, tid_fg, True))
            try:
                user32.SetForegroundWindow(hwnd)
                user32.BringWindowToTop(hwnd)
            finally:
                if 连上:
                    user32.AttachThreadInput(tid_me, tid_fg, False)
            return True
        except Exception as e:
            log("强设前台失败：", repr(e))
            return False

    def _取消置顶():
        h = STATE.pop("wx_hwnd", None)
        if not h:
            return
        try:
            import win32con
            import win32gui as wg

            wg.SetWindowPos(h, win32con.HWND_NOTOPMOST, 0, 0, 0, 0,
                            win32con.SWP_NOMOVE | win32con.SWP_NOSIZE)
        except Exception:
            pass

    # ---------- 后台发送（学 whale-girl）：不抢前台、发完还原 ----------
    # 起因：wechatauto 的 WeChatUIA.ensure_window() 每次发送都会调 _activate() →
    #       把微信恢复并顶到最前面。实测微信最小化/被遮挡时其实照样能发，这步纯属
    #       多余，代价是主人用电脑时会被反复打断。这里学 whale-girl 的做法：
    #       文字走后台（UIA 直接写控件，不需要焦点），失败才抢前台重试；
    #       发完把窗口状态照原样还回去。

    def _微信窗口():
        try:
            import win32gui

            found = []

            def cb(hwnd, _):
                try:
                    if win32gui.IsWindowVisible(hwnd) and win32gui.GetWindowText(hwnd) == "微信":
                        found.append(hwnd)
                except Exception:
                    pass
                return True

            win32gui.EnumWindows(cb, None)
            return found[0] if found else None
        except Exception:
            return None

    def _微信在前台():
        """微信此刻是不是前台窗口。全局回车（keybd_event）只在前台时才能按，
        否则会按到主人正在用的别的窗口里去。"""
        try:
            import ctypes

            h = _微信窗口()
            return bool(h) and ctypes.windll.user32.GetForegroundWindow() == h
        except Exception:
            return False

    def _快照窗口():
        """记下发送前窗口长什么样：句柄、是否最小化、当时的前台窗口。"""
        snap = {"hwnd": None, "iconic": False, "foreground": None, "visible": True}
        try:
            import ctypes
            import win32gui

            h = _微信窗口()
            if not h:
                return snap
            snap["hwnd"] = h
            snap["iconic"] = bool(win32gui.IsIconic(h))
            snap["visible"] = bool(win32gui.IsWindowVisible(h))
            snap["foreground"] = ctypes.windll.user32.GetForegroundWindow() or None
        except Exception:
            pass
        return snap

    def _还原窗口(snap):
        """把窗口状态还回去：原来最小化的继续最小化，前台还给原来那个窗口。"""
        if not snap:
            return
        try:
            import ctypes
            import win32gui

            h = snap.get("hwnd")
            if not h:
                return
            if not snap.get("visible", True):
                # 发送前微信是「收在托盘里」（窗口隐藏），发完要重新藏起来，
                # 别让它突然出现在屏幕上
                win32gui.ShowWindow(h, 0)          # SW_HIDE
                return
            if snap.get("iconic"):
                win32gui.ShowWindow(h, 6)          # SW_MINIMIZE
                return
            fg = snap.get("foreground")
            cur = ctypes.windll.user32.GetForegroundWindow()
            if fg and fg != cur and ctypes.windll.user32.IsWindow(fg):
                try:
                    ctypes.windll.user32.SetForegroundWindow(fg)
                except Exception:
                    pass
        except Exception:
            pass

    def _守护最小化(hwnd):
        """发送期间盯着窗口，看它有没有被谁拉出来（只记录，不动手）。

        以前是「一冒头就按回去」，结果切会话时新会话的输入框跟着丢焦点，
        字发不出去。收回最小化交给 send_one 的 finally（_还原窗口），
        那会儿发送已经结束，按回去不会再打断任何操作。
        """
        stopped = threading.Event()

        def 跑():
            报过 = False
            while not stopped.is_set():
                try:
                    import win32gui

                    if hwnd and win32gui.IsWindow(hwnd) and not win32gui.IsIconic(hwnd):
                        if not 报过:
                            log("窗口被拉起来了（发送过程中）")
                            报过 = True
                except Exception:
                    pass
                time.sleep(0.25)

        threading.Thread(target=跑, daemon=True).start()
        return stopped

    def _install_quiet_uia(u):
        """给 UIA 引擎打补丁：quiet_mode 下 _activate 直接返回，不抢前台。

        whale-girl 实测 18/18：微信最小化、被遮挡、前台全屏时都能正常发送，
        所以「把窗口拉到最前」这一步可以省掉。不改第三方库文件，只改实例。
        """
        try:
            import types

            if getattr(u, "_quiet_patch", False):
                u.quiet_mode = True
                return
            orig = getattr(u, "_activate", None)
            if orig is None:
                return

            def patched(self, win, _orig=orig):
                if getattr(self, "quiet_mode", False):
                    return
                return _orig(win)

            u._activate = types.MethodType(patched, u)

            # 还有一个漏网的：_force_foreground 会 ShowWindow(SW_RESTORE) +
            # SetForegroundWindow，把最小化的微信直接拉出来。安静模式下让它
            # 直接「假装成功」——UIA 写控件并不需要窗口在前台。
            if not getattr(u, "_quiet_ff", False):
                try:
                    u._force_foreground = lambda hwnd: True
                    u._quiet_ff = True
                except Exception:
                    pass

            # 点击补丁：wechatauto 的 _click_ctrl 会 SetCursorPos + 真实鼠标点击，
            # 切会话/搜索时屏幕上鼠标乱飞就是它。这里优先用 UIA 的 Invoke/Select，
            # 不碰鼠标；控件不支持时才退回原来的模拟点击。
            orig_click = getattr(u, "_click_ctrl", None)
            if orig_click is not None and not getattr(u, "_quiet_click", False):
                def quiet_click(self, ctrl, right=False, _orig=orig_click):
                    if right:
                        return _orig(ctrl, right=True)
                    err1 = err2 = None
                    try:
                        ctrl.GetInvokePattern().Invoke()
                        log("点击控件：走 Invoke（不动鼠标）")
                        return True
                    except Exception as e:
                        err1 = repr(e)
                    try:
                        ctrl.GetSelectionItemPattern().Select()
                        log("点击控件：走 Select（不动鼠标）")
                        return True
                    except Exception as e:
                        err2 = repr(e)
                    log("点击控件：退回真实鼠标点击（%s / %s）" % (err1, err2))
                    return _orig(ctrl, right=False)

                u._click_ctrl = types.MethodType(quiet_click, u)
                u._quiet_click = True

            u._quiet_patch = True
            u.quiet_mode = True
        except Exception as e:
            log("后台模式补丁没打上（不影响发送）：", repr(e))

    # UIA 起不来时的熔断。
    # wechatauto 的 UIA 一失败就退化成「按固定坐标盲点」：每秒两三次扫屏、枚举窗口、
    # 顺手最小化挡着的窗口 —— 主人看到的就是电脑卡成幻灯片，桌面还自己动。
    # 所以连着起不来几次就先停手，别让它一直空转。
    uia_坏 = {"连败": 0, "到": 0.0}

    def _记UIA失败(原因=""):
        uia_坏["连败"] += 1
        文本 = str(原因)
        缺 = ""
        if "No module named 'numpy'" in 文本 or "No module named \"numpy\"" in 文本:
            缺 = "（缺 numpy —— 设置 → 通到微信，点一次「装依赖」，装完重启桥接）"
        elif "No module named" in 文本:
            缺 = "（缺 Python 包 —— 设置 → 通到微信，点一次「装依赖」）"
        if uia_坏["连败"] >= 3 and time.time() >= uia_坏["到"]:
            uia_坏["到"] = time.time() + 300
            log(
                "UIA 连着 %d 次起不来，先停 5 分钟不再碰微信窗口（省得它盲点坐标乱点）%s"
                % (uia_坏["连败"], 缺)
            )

    def _uia熔断中():
        return time.time() < uia_坏["到"]

    def _取引擎():
        """每次发送都问一次最新的 UIA 引擎。

        微信跑久了会把 accessibility gate 那个字节归零，缓存的引擎会「假死」：
        还能收消息，但一条也发不出去，只能重启桥接 —— 每次重取能避开这个坑。

        注意：这里**不打 quiet 补丁**。后台静默那条路（_activate 直接返回 +
        _force_foreground 假装成功）会让窗口没真正激活、后面的点击和粘贴落空，
        切会话时直接把发送卡死。先回到原生行为：会冒头，但发得出去。
        """
        if _uia熔断中():
            return None
        try:
            gui = get_gui()
            u = gui._get_uia()
            if u is None:
                _记UIA失败("引擎给回 None")
                return None
            uia_坏["连败"] = 0
            uia_坏["到"] = 0.0
            return u
        except Exception as e:
            log("取 UIA 引擎失败：", repr(e))
            _记UIA失败(e)
            return None

    def _recover_uia(原因=""):
        """强制重新热激活 UIA（refresh=True），成功返回 True。"""
        if _uia熔断中():
            return False
        try:
            gui = get_gui()
            u = gui._get_uia(refresh=True)
            if u is not None:
                uia_坏["连败"] = 0
                uia_坏["到"] = 0.0
                log("UIA 已重新热激活" + (("（" + 原因 + "）") if 原因 else ""))
                return True
            _记UIA失败("热激活给回 None")
        except Exception as e:
            log("UIA 重新热激活异常：", repr(e))
            _记UIA失败(e)
        return False

    def _press_enter(次=2, ctrl=False):
        """底层按键补回车。

        UIA 的 SendKeys 有时根本不触发发送（字符进了框、回车没生效），
        这里用 keybd_event 硬按几次；ctrl=True 兼容微信里「Ctrl+Enter 发送」的设置。
        """
        try:
            import win32api
            import win32con

            for _ in range(次):
                if ctrl:
                    win32api.keybd_event(0x11, 0, 0, 0)
                win32api.keybd_event(0x0D, 0, 0, 0)
                win32api.keybd_event(0x0D, 0, win32con.KEYEVENTF_KEYUP, 0)
                if ctrl:
                    win32api.keybd_event(0x11, 0, win32con.KEYEVENTF_KEYUP, 0)
                time.sleep(0.12)
            return True
        except Exception as e:
            log("补回车失败：", repr(e))
            return False

    def _keyboard_send(文字, chat):
        """完全不依赖 UIA 的发送通道：Ctrl+F 搜会话 → 粘贴 → 回车 → 查库确认。

        UIA 假死时的第二条命。代价是要抢一下前台（键盘输入必须有焦点），
        所以只在 UIA 真的发不出去时用。
        """
        if not 文字:
            return False
        try:
            import win32con
            import win32gui

            h = _微信窗口()
            if not h:
                return False
            win32gui.ShowWindow(h, 9)
            _强设前台(h)
            time.sleep(0.5)
            import win32api

            def _粘贴(s):
                import win32clipboard

                win32clipboard.OpenClipboard()
                try:
                    win32clipboard.EmptyClipboard()
                    win32clipboard.SetClipboardData(win32con.CF_UNICODETEXT, s)
                finally:
                    win32clipboard.CloseClipboard()
                time.sleep(0.1)
                win32api.keybd_event(0x11, 0, 0, 0)      # Ctrl
                win32api.keybd_event(0x56, 0, 0, 0)      # V
                win32api.keybd_event(0x56, 0, win32con.KEYEVENTF_KEYUP, 0)
                win32api.keybd_event(0x11, 0, win32con.KEYEVENTF_KEYUP, 0)
                time.sleep(0.4)

            # Ctrl+F 打开搜索 → 输会话名 → 回车进会话
            win32api.keybd_event(0x11, 0, 0, 0)
            win32api.keybd_event(0x46, 0, 0, 0)
            win32api.keybd_event(0x46, 0, win32con.KEYEVENTF_KEYUP, 0)
            win32api.keybd_event(0x11, 0, win32con.KEYEVENTF_KEYUP, 0)
            time.sleep(0.6)
            _粘贴(chat)
            _press_enter(1)
            time.sleep(0.8)
            _粘贴(文字)
            _press_enter(2)
            _press_enter(2, ctrl=True)
            time.sleep(1.2)
            if _already_sent(文字, chat, within=40):
                return True
            _press_enter(2)
            time.sleep(1.2)
            return _already_sent(文字, chat, within=40)
        except Exception as e:
            log("键盘通道失败：", repr(e))
            return False

    def _ensure_wechat_ready(重试=2, 前台=False):
        """确认微信窗口能操作。

        默认只确认窗口在、不抢前台（文字用 UIA 直接写控件，不需要焦点）；
        需要粘贴图片、或文字发送失败重试时才传 前台=True 把窗口顶上来。
        """
        if not 前台:
            return _微信窗口() is not None
        for 第 in range(重试 + 1):
            try:
                import win32gui

                found = []

                def cb(hwnd, _):
                    try:
                        if win32gui.IsWindowVisible(hwnd) and win32gui.GetWindowText(hwnd) == "微信":
                            found.append(hwnd)
                    except Exception:
                        pass
                    return True

                win32gui.EnumWindows(cb, None)
                if found:
                    h = found[0]
                    win32gui.ShowWindow(h, 9)          # SW_RESTORE
                    if not _强设前台(h):
                        # 退路：先最小化再恢复，有时也能把焦点拿回来
                        try:
                            win32gui.ShowWindow(h, 6)
                            time.sleep(0.12)
                            win32gui.ShowWindow(h, 9)
                            time.sleep(0.15)
                            win32gui.SetForegroundWindow(h)
                        except Exception:
                            pass
                    # 发送期间把微信置顶：DSH 窗口（我自己）一刷新就会盖上来，
                    # 这是「字卡在输入框」最主要的来源
                    try:
                        import win32con

                        win32gui.SetWindowPos(h, win32con.HWND_TOPMOST, 0, 0, 0, 0,
                                              win32con.SWP_NOMOVE | win32con.SWP_NOSIZE)
                        STATE["wx_hwnd"] = h
                    except Exception:
                        pass
                    time.sleep(0.4)
                    return True
            except Exception as e:
                log("微信窗口准备失败：", repr(e))
            time.sleep(0.4)
        return False

    def 拆条(text: str, 上限: int = 26):
        """把一段话拆成几条短消息：先按换行分段，长段再按句子拆。"""
        out = []
        for 段 in re.split(r"\n+", str(text or "")):
            段 = 段.strip()
            if not 段:
                continue
            if len(段) <= 上限:
                out.append(段)
                continue
            句们 = re.split(r"(?<=[。！？!?…])", 段)
            cur = ""
            for 句 in 句们:
                if not 句:
                    continue
                if len(cur) + len(句) <= 上限:
                    cur += 句
                else:
                    if cur.strip():
                        out.append(cur.strip())
                    cur = 句
            if cur.strip():
                out.append(cur.strip())
        return out or [str(text or "").strip()]


    def _chat_username(chat):
        """聊天名 → 数据库里的 username。群必须走 group_name_to_id（nickname 查不到群）。"""
        try:
            g = db.group_name_to_id(chat)
            if g:
                return g
        except Exception:
            pass
        try:
            return db.username_by_nickname(chat) or chat
        except Exception:
            return chat


    def _already_sent(text, chat, within=60):
        """库里最近已经有这句话 → 其实发出去了，别再点一次（点了就是重复消息）。"""
        try:
            u = _chat_username(chat)
            rows = db.get_messages(u, limit=12)
            now = time.time()
            for m in rows or []:
                ts = float(m.get("create_time") or 0)
                if not ts or abs(now - ts) > within:
                    continue
                c = clean_text(m.get("content") or "")
                if c and (c == text or text in c or c in text):
                    return True
        except Exception:
            pass
        return False

    # 进程内「这句我已经发出去过」的记录。数据库查询有 25/120 秒的时间窗，
    # 兜底通道晚几秒醒来、或者拆条后隔了几十秒再补发，窗口一过就会重复发一遍
    # （就是「老是发两次一模一样」）。这里用不过期的内存记录兜住。
    _发过的段 = {}

    def _记发过(text):
        try:
            k = clean_text(text)
            if k:
                _发过的段[k] = time.time()
        except Exception:
            pass

    def _段已发过(text, within=3600):
        try:
            k = clean_text(text)
            t = _发过的段.get(k)
            return bool(t) and (time.time() - t) <= within
        except Exception:
            return False


    def _localize_image(p):
        """正文 markdown 里的本机 HTTP 图（表情包服务等）先落成本地文件，再交给微信发。"""
        if not re.match(r"^https?://", p, re.I):
            return p if os.path.exists(p) else None
        from urllib.parse import urlparse

        u = urlparse(p)
        if (u.hostname or "").lower() not in ("127.0.0.1", "localhost", "::1"):
            log("⚠ 不是本机的图，跳过：", p)
            return None
        ext = os.path.splitext(u.path)[1].lower()
        if ext not in (".gif", ".png", ".jpg", ".jpeg", ".webp"):
            ext = ".png"
        tmp = None
        try:
            fd, tmp = tempfile.mkstemp(suffix=ext, prefix="wxbridge_")
            os.close(fd)
            with urllib.request.urlopen(p, timeout=15) as r, open(tmp, "wb") as f:
                shutil.copyfileobj(r, f)
            return tmp
        except Exception as e:
            log("⚠ 图下载失败：", p, repr(e))
            try:
                if tmp:
                    os.unlink(tmp)
            except Exception:
                pass
            return None

    def _send_image_dib(gui, path, chat):
        """发图：把图转成 CF_DIB 位图放剪贴板 → Ctrl+V → 回车。

        微信 4.x 不吃 wechatauto 的 CF_HDROP 路线（粘贴后草稿是空的，
        回车等于发了个寂寞，数据库里也不会有图片消息），但认 CF_DIB。
        GIF 只发第一帧（微信粘贴位图本来也不会动）。
        """
        import io
        import ctypes
        from PIL import Image

        try:
            im = Image.open(path)
            if getattr(im, "is_animated", False):
                im.seek(0)
            im = im.convert("RGB")
            im.thumbnail((1280, 1280))
        except Exception as e:
            log("⚠ 图片打不开：", repr(e))
            return False
        buf = io.BytesIO()
        try:
            im.save(buf, format="BMP")
            dib = buf.getvalue()[14:]   # 去掉 BMP 文件头，剩下的就是 DIB
        except Exception as e:
            log("⚠ 图片转位图失败：", repr(e))
            return False

        u32 = ctypes.windll.user32
        k32 = ctypes.windll.kernel32
        k32.GlobalAlloc.restype = ctypes.c_void_p
        k32.GlobalAlloc.argtypes = [ctypes.c_uint, ctypes.c_size_t]
        k32.GlobalLock.restype = ctypes.c_void_p
        k32.GlobalLock.argtypes = [ctypes.c_void_p]
        k32.GlobalUnlock.argtypes = [ctypes.c_void_p]
        u32.SetClipboardData.restype = ctypes.c_void_p
        u32.SetClipboardData.argtypes = [ctypes.c_uint, ctypes.c_void_p]
        u32.OpenClipboard.argtypes = [ctypes.c_void_p]
        try:
            if not u32.OpenClipboard(None):
                log("⚠ 剪贴板打不开")
                return False
            try:
                u32.EmptyClipboard()
                h = k32.GlobalAlloc(0x0002 | 0x0040, len(dib))
                ptr = k32.GlobalLock(h)
                ctypes.memmove(ptr, dib, len(dib))
                k32.GlobalUnlock(h)
                if not u32.SetClipboardData(8, h):
                    log("⚠ 写剪贴板失败")
                    return False
            finally:
                u32.CloseClipboard()
        except Exception as e:
            log("⚠ 剪贴板异常：", repr(e))
            return False

        box = None
        for 第 in range(3):
            if 第 > 0:
                # 外层刚发完文字、窗口多半是好的；只有真探测不到时才重新摆窗口
                try:
                    _ensure_wechat_ready(前台=True)
                except Exception:
                    pass
            try:
                box = gui.get_input_box()
            except Exception as e:
                log("⚠ 探测输入框异常：", repr(e))
                box = None
            if box:
                break
            log("⚠ 发图探测不到输入框，第 %d 次重试" % (第 + 1))
            time.sleep(0.5)
        if not box:
            log("⚠ 发图时找不到输入框")
            return False
        try:
            gui.focus_input(box)
        except Exception as e:
            log("⚠ 聚焦输入框失败：", repr(e))
            return False
        time.sleep(0.2)
        gui._input.key(0x56, ctrl=True)   # VK_V
        time.sleep(0.8)
        gui._input.key(0x0D)              # VK_RETURN
        time.sleep(0.7)
        return True

    def _last_image_ts(chat):
        """聊天里最新一张图片消息的时间戳；没有就是 0。用来判断“刚才那张到底发出去没有”。"""
        try:
            u = _chat_username(chat)
            for m in db.get_messages(u, limit=8) or []:
                if m.get("type") == "图片":
                    return float(m.get("create_time") or 0)
        except Exception:
            pass
        return 0.0

    def _image_sent_recently(chat, since):
        """发完去库里确认一下：真出现图片消息才算发成了。"""
        try:
            u = _chat_username(chat)
            for m in db.get_messages(u, limit=4) or []:
                if m.get("type") == "图片" and float(m.get("create_time") or 0) >= since - 2:
                    return True
        except Exception:
            pass
        return False

    def _框里的字():
        """用 UIA 读输入框里的文字。读不到返回 None（表示"不知道"，不是"空"）。

        像素判据会把光标、占位提示、发送按钮都算成"有字"，据此重试会一直空转，
        所以优先问 UIA 要真实文本，读不到才退回像素判断。
        """
        try:
            gui = get_gui()
            uia = _取引擎()
            if uia is None:
                return None
            ctrl = uia._chat_input()
            if ctrl is None:
                return None
            r = uia._read_edit_value(ctrl) if hasattr(uia, "_read_edit_value") else None
            return None if r is None else str(r)
        except Exception:
            return None

    def _清空输入框():
        """发送前把输入框里可能残留的上一条清掉。

        发失败时文字会留在输入框（wechatauto 只校验粘贴、不校验回车），
        下一次任意回车会把这段残渣一起发出去 —— 表现就是同一条发了两遍。
        """
        try:
            框 = _框里的字()
            if 框 is not None and not 框.strip():
                return True
            gui = get_gui()
            uia = _取引擎()
            if uia is None:
                return False
            ctrl = uia._chat_input()
            if ctrl is None:
                return False
            try:
                vp = ctrl.GetValuePattern()
                if vp is not None and str(vp.Value or ""):
                    vp.SetValue("")
                    log("发送前清掉了输入框里的残留")
                    return True
            except Exception:
                pass
            try:
                ctrl.SetFocus()
                time.sleep(0.05)
                k32.keybd_event(0x11, 0, 0, 0)   # Ctrl down
                k32.keybd_event(0x41, 0, 0, 0)   # A down
                k32.keybd_event(0x41, 0, 2, 0)
                k32.keybd_event(0x11, 0, 2, 0)   # Ctrl up
                k32.keybd_event(0x08, 0, 0, 0)   # Backspace
                k32.keybd_event(0x08, 0, 2, 0)
                log("发送前用键盘清空了输入框残留")
                return True
            except Exception:
                return False
        except Exception:
            return False

    def _kick_enter(最多=3):
        """把卡在输入框里的话踹出去，返回 True 表示框已空。

        根因：wechatauto 的 UIA 发送只校验「文字有没有粘进输入框」，不校验回车
        之后输入框有没有清空。窗口被抢焦点时回车落空，字就留在输入框里，
        而接口已经报了「已操作发送」—— 表现就是「消息卡在输入框没发出去」。

        以前只补一次回车，落空一次就又堵在那里；现在按「框里还有字就继续踹」
        来判：回车三次还清不掉，就回退到 guia 的 click_send（它会 OCR 找到
        「发送」按钮去点，并且每次点完都校验输入框清空）。
        """
        try:
            gui = get_gui()
            for _ in range(最多):
                框 = _框里的字()
                if 框 is not None:
                    if not 框.strip():
                        return True
                else:
                    try:
                        if not gui._input_box_has_text():
                            return True
                    except Exception:
                        break
                try:
                    gui._input.key(0x0D)          # VK_RETURN
                except Exception:
                    uia = _取引擎()
                    if uia is None:
                        break
                    e = uia._chat_input()
                    if e is None:
                        break
                    e.SendKeys("{Enter}", waitTime=0.05)
                time.sleep(1.0)
            框 = _框里的字()
            if 框 is not None and not 框.strip():
                return True
            if 框 is None:
                try:
                    if not gui._input_box_has_text():
                        return True
                except Exception:
                    pass
            # 不再点「发送」按钮：那条路要真实移动鼠标（OCR 定位 + 点击），
            # 发消息时鼠标会乱飞，很吓人。改成纯键盘再踹一轮。
            log("输入框还堵着，再踹一轮回车（不碰鼠标）")
            try:
                # 优先用 UIA 元素定向发回车（后台也能用，不挑前台）；
                # 全局回车只在前台窗口是微信时才按，否则会按到主人正在用的窗口上
                uia = _取引擎()
                输入框 = uia._chat_input() if uia is not None else None
                if 输入框 is not None:
                    输入框.SendKeys("{Enter}", waitTime=0.05)
                elif _微信在前台():
                    _press_enter(2)
                    _press_enter(1, ctrl=True)
                else:
                    log("微信不在前台，跳过全局回车（免得按到别的窗口）")
            except Exception as e:
                log("踹回车失败：%r" % (e,))
            time.sleep(1.2)
            框 = _框里的字()
            if 框 is None or not 框.strip():
                return True
            log("输入框还是堵着，这条先放弃")
            return False
        except Exception as e:
            log("补回车失败：%r" % (e,))
            return False

    def send_one(item):
        text = str(item.get("text") or "").strip()
        chat = str(item.get("chat") or "").strip()
        images = [str(p) for p in (item.get("images") or []) if p]

        # 正文里的 [表情: 描述] 换成真图片（表情库里有就发图，没有就保持原样）
        表情图 = []

        def _repl(m):
            p = find_meme(m.group(1))
            if p:
                表情图.append(p)
                return ""
            return m.group(0)

        text = re.sub(r"\[表情:\s*([^\]]+)\]", _repl, text).strip()
        images = 表情图 + images

        # 兜底：DSH 那边没摘干净的 markdown 图片（只认本机地址），这里再摘一次，
        # 免得微信里收到一串 "![xxx](http://127.0.0.1:...)" 的文字。
        def _摘图(m):
            u = m.group(1)
            if re.match(r"^https?://(127\.0\.0\.1|localhost|\[::1\])(:\d+)?/", u, re.I):
                images.append(u)
                return ""
            return m.group(0)

        text = re.sub(r"!\[[^\]]*\]\((https?://[^)\s]+)\)", _摘图, text).strip()

        if not text and not images:
            return {"ok": False, "说": "空消息"}
        if not chat:
            return {"ok": False, "说": "没指定发给谁（chat 空着）"}
        with send_lock:
            # UIA 坏着的时候整条发送路都不许走：下面 _ensure_wechat_ready / open_chat /
            # 读输入框都会进 wechatauto 的窗口操作，它一失败就退化成坐标盲点、
            # 顺手最小化挡着的窗口 —— 队列里积着几条消息就是每秒两三次的空转。
            if _uia熔断中():
                return {"ok": False, "说": "UIA 起不来，先不发（5 分钟内不再试，免得它乱点桌面）"}
            窗口快照 = _快照窗口()
            守护 = _守护最小化(窗口快照.get("hwnd")) if 窗口快照.get("iconic") else None
            try:
                # 先不抢前台：同一条会话里连发时，UIA 直接写控件就够了，
                # 把窗口顶上来只会让主人看见它闪。只有要切会话时才摆正窗口。
                _ensure_wechat_ready(前台=False)
                gui = get_gui()
                # 每次发送前重取一次引擎：微信跑久了 accessibility 会假死，
                # 缓存的引擎能收消息却一条也发不出去
                _引擎 = _取引擎()
                # 发之前先清干净输入框：上一次失败的字留在里面，
                # 这一次回车会把它一起带出去（同一句话发两遍的根源）
                try:
                    _清空输入框()
                except Exception:
                    pass
                # 已经在目标会话里就别再搜一次 —— open_chat 要点搜索框、输入名字，
                # 这些动作会把最小化的微信拉到前面来（主人就看见窗口突然蹦出来）
                当前会话 = None
                try:
                    if _引擎 is not None:
                        当前会话 = _引擎.current_chat()
                except Exception:
                    当前会话 = None
                if 当前会话 != chat:
                    # 切会话这一下躲不掉：得让窗口在前，open_chat 才点得到搜索框
                    _ensure_wechat_ready(前台=True)
                    gui = get_gui()
                    _引擎 = _取引擎()
                    try:
                        gui.open_chat(chat)
                    except Exception as e:
                        log("打开会话失败（继续试）：", repr(e))
                    # 切会话这一下微信会把自己拉起来（Invoke 会话项时应用自己的行为），
                    # 这时候如果立刻按回最小化，新会话的输入框就丢焦点了，字会发不出去。
                    # 所以这里让它先露着，等这条发完在 finally 里统一收回去。
                    # 窗口最小化时输入框可能丢焦点，这里顺手把焦点还给控件。
                    try:
                        if _引擎 is not None:
                            e = _引擎._chat_input()
                            if e is not None:
                                e.SetFocus()
                    except Exception as e:
                        log("还焦点给输入框失败：", repr(e))
                发了 = False

                def 带超时(动作, 超时=25):
                    """send_msg 偶尔会卡在 UIA 里不出来，给个上限，别把整条队列堵死。"""
                    盒 = {}

                    def 跑():
                        try:
                            盒["r"] = 动作()
                        except Exception as e:
                            盒["e"] = e

                    t = threading.Thread(target=跑, daemon=True)
                    t.start()
                    t.join(超时)
                    if t.is_alive():
                        return "发送超时"
                    return 盒.get("e") or 盒.get("r")

                def 试(动作, 名字, 重试前=1):
                    """发一次；返回失败（不是抛异常）也要当成失败 —— 窗口没接住时就是这样。"""
                    for 第 in range(重试前 + 1):
                        try:
                            r = 带超时(lambda: 动作(gui))
                        except Exception as e:
                            r = e
                        if not isinstance(r, Exception) and (r is None or r):
                            return True
                        原因 = ""
                        try:
                            原因 = str(r.get("message") or "") if hasattr(r, "get") else str(r)
                        except Exception:
                            原因 = str(r)
                        # 已经发出去了、只是数据库还没落库 —— 再发一遍就成了两条重复消息
                        if "未确认" in 原因 or "已操作发送" in 原因:
                            # 但字也可能压根没发出去，就卡在输入框里 —— 补一次回车再确认
                            if _kick_enter():
                                time.sleep(1.2)
                                log("已操作发送但库里没确认，补了一次回车：" + 原因[:50])
                            else:
                                log("发出去但库里没确认，不再重发：" + 原因[:50])
                            return True
                        log("第 %d 次%s没成：%s" % (第 + 1, 名字, 原因[:80]))
                        if 第 < 重试前:
                            # 先原地重试；还是不行就重新热激活 UIA（引擎假死时只能这样救），
                            # 最后才把微信拉到前台 —— 平时不抢主人正在用的窗口
                            if 第 == 0:
                                _recover_uia("发送失败")
                            else:
                                _ensure_wechat_ready(前台=True)
                            time.sleep(0.6)
                    return False

                if text:
                    # 长内容拆成几条短消息发（一个大气泡读着累）—— 每段不超过 60 字
                    for 一 in 拆条(text):
                        # 重试前先看库里：这句话刚发过就不再点第二遍
                        if _段已发过(一):
                            log("这句我发过（内存记录），跳过：%s" % 一[:30])
                            continue
                        if _already_sent(一, chat, within=25):
                            log("这句刚发过，跳过：%s" % 一[:30])
                            _记发过(一)
                            recently_sent.append((clean_text(一), time.time()))
                            continue
                        ok = 试(lambda g, t=一: g.send_msg(t, chat, True), "发文字")
                        if not ok and _already_sent(一, chat, within=25):
                            log("接口说失败，但库里查到了 —— 算发成功：%s" % 一[:30])
                            ok = True
                        if not ok:
                            # 最后再补一脚：字常常只是卡在输入框里没回车出去
                            if _kick_enter():
                                time.sleep(1.2)
                                if _already_sent(一, chat, within=25):
                                    log("补回车后库里查到了 —— 算发成功：%s" % 一[:30])
                                    ok = True
                        if not ok:
                            # UIA 彻底没发出去：先走键盘通道（Ctrl+F 搜会话→粘贴→回车→查库）
                            if _keyboard_send(一, chat):
                                log("键盘通道补发成功：%s" % 一[:30])
                                ok = True
                        if not ok:
                            # 最后再抢一次前台重试
                            try:
                                _ensure_wechat_ready(前台=True)
                                time.sleep(0.5)
                                gui.open_chat(chat)
                                if 试(lambda g, t=一: g.send_msg(t, chat, True), "发文字（前台重试）"):
                                    ok = True
                            except Exception as e:
                                log("前台重试异常：", repr(e))
                        if not ok:
                            gui_box["gui"] = None      # 下次重建
                            return {"ok": False, "说": "文字没发出去（微信窗口没接住）"}
                        # 发成功也要补回车：wechatauto 只认「粘贴成功」，
                        # 回车落空它照样报成功，字会留在框里。多按几次，
                        # 并兼容微信里「Ctrl+Enter 发送」的设置。
                        # 全局回车只在前台窗口是微信时才按，否则会按到主人正在用的窗口上
                        if _微信在前台():
                            _press_enter(2)
                            _press_enter(1, ctrl=True)
                        _kick_enter()
                        # 拆开发出去的每一条都记账 —— 不然文件传输助手里会被当成主人说的话读回来
                        recently_sent.append((clean_text(一), time.time()))
                        _记发过(一)
                        time.sleep(0.35)
                    recently_sent.append((clean_text(text), time.time()))
                    _记发过(text)
                    STATE["last_send"] = time.time()
                    if len(recently_sent) > 100:
                        del recently_sent[:-100]
                    log("✅ 已发到微信（%s）：%s" % (chat, text[:40]))
                    发了 = True

                临时图 = []

                def 取图(p):
                    q = _localize_image(p)
                    if q and q != p:
                        临时图.append(q)
                    return q

                for p in images:
                    p = 取图(p)
                    if not p:
                        log("⚠ 图拿不到，跳过")
                        continue
                    # 发完文字窗口可能被挡/失焦 —— 发图前把会话和窗口都摆正。
                    # 但刚才要是已经发过文字，窗口和会话都还在这条上，再走全套恢复会白顿一秒多。
                    try:
                        if text:
                            time.sleep(0.25)
                        else:
                            _ensure_wechat_ready(前台=True)
                            time.sleep(0.2)
                            gui.open_chat(chat)
                            time.sleep(0.4)
                    except Exception as e:
                        log("⚠ 发图前准备窗口失败（继续试）：", repr(e))
                    t0 = time.time()
                    前图时 = _last_image_ts(chat)
                    try:
                        ok_img = _send_image_dib(gui, p, chat)
                    except Exception as e:
                        log("✗ 发图异常：", repr(e))
                        ok_img = False
                    # 接口返回不可靠（点击被挡掉时它说失败，其实剪贴板粘贴已经发出去了）——
                    # 一律以数据库里有没有新图片为准。前两秒快速查，别让确认本身拖慢下一条。
                    真发了 = False
                    for 第 in range(14):
                        if _last_image_ts(chat) > 前图时 + 0.5:
                            真发了 = True
                            break
                        time.sleep(0.35 if 第 < 6 else 1.5)
                    if 真发了:
                        if ok_img:
                            log("🖼 已发图（%s）：%s" % (chat, os.path.basename(p)))
                        else:
                            log("🖼 已发图（%s，接口说失败但库里查到了）：%s" % (chat, os.path.basename(p)))
                        发了 = True
                        time.sleep(0.4)
                    else:
                        # 第一次多半是窗口被抢/被挡 —— 重建窗口再来一次，别直接把图丢掉
                        log("✗ 发图失败，重建窗口重试一次：%s" % p)
                        gui_box["gui"] = None
                        try:
                            _ensure_wechat_ready(前台=True)
                            time.sleep(0.5)
                            gui2 = get_gui()
                            gui2.open_chat(chat)
                            time.sleep(0.5)
                            前图时2 = _last_image_ts(chat)
                            _send_image_dib(gui2, p, chat)
                            for 第 in range(12):
                                if _last_image_ts(chat) > 前图时2 + 0.5:
                                    真发了 = True
                                    break
                                time.sleep(1.0)
                        except Exception as e:
                            log("重试发图异常：", repr(e))
                        if 真发了:
                            log("🖼 重试后已发图（%s）：%s" % (chat, os.path.basename(p)))
                            发了 = True
                            time.sleep(0.4)
                        else:
                            log("✗ 发图彻底失败（库里还是没有新图）：%s" % p)

                for t in 临时图:
                    try:
                        os.unlink(t)
                    except Exception:
                        pass

                if not 发了:
                    return {"ok": False, "说": "字和图都没发出去"}
                return {"ok": True}
            except Exception as e:
                log("✗ 发送失败（%s）：%r" % (chat, e))
                gui_box["gui"] = None    # 下次重建
                return {"ok": False, "说": repr(e)}
            finally:
                if 守护 is not None:
                    守护.set()
                # 发送期间把微信置顶了，发完要放下来，不然它一直压在别的窗口上面
                _取消置顶()
                # 后台发送的收尾：原来最小化的继续最小化，前台还给主人原来那个窗口
                _还原窗口(窗口快照)

    # ---------- 兜底：DSH 那边的会话事件没送到时，直接读会话文件把回复捞出来 ----------
    # 起因：2026-10-27 晚，DSH 重启后 host.js 的 session/event 不再触发，
    #       回复全部卡在 DSH 里发不出去。这里作为独立于事件的一层保险。

    LAST_CHAT = {"chat": os.environ.get('DSH_BRIDGE_DEFAULT_CHAT') or '', "ts": 0.0}
    FALLBACK_STATE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fallback_state.json')
    # 会话目录按「最近改动过的那个」自动找，不写死具体会话名
    def _找会话根() -> str:
        base = os.path.join(os.path.expanduser('~'), '.dsh', 'sessions')
        try:
            dirs = [os.path.join(base, d) for d in os.listdir(base)]
            dirs = [d for d in dirs if os.path.isdir(d)]
            if dirs:
                return max(dirs, key=lambda p: os.path.getmtime(p))
        except Exception:
            pass
        return base

    SESS_ROOT = _找会话根()
    # 兜底通道：2026-10-28 起默认关闭。它读会话文件猜「这句回复该发给谁」，
    # 猜错就会把私聊内容发进群、或者把同一句重发两遍（当天出了两次事故）。
    # 想要它回来：设环境变量 DSH_BRIDGE_NO_FALLBACK=0。
    FALLBACK_OFF = os.environ.get('DSH_BRIDGE_NO_FALLBACK', '1') != '0'

    def _读兜底游标():
        try:
            with open(FALLBACK_STATE, 'r', encoding='utf-8') as f:
                return int((json.load(f) or {}).get('seq') or 0)
        except Exception:
            return 0

    def _写兜底游标(n):
        try:
            with open(FALLBACK_STATE, 'w', encoding='utf-8') as f:
                json.dump({'seq': int(n)}, f)
        except Exception:
            pass

    def _最新会话文件():
        best, best_t = None, 0.0
        try:
            for d in os.listdir(SESS_ROOT):
                p = os.path.join(SESS_ROOT, d, 'session.v4.jsonl.zstd')
                if os.path.exists(p):
                    t = os.path.getmtime(p)
                    if t >= best_t:
                        best_t, best = t, p
        except Exception:
            pass
        return best

    _FB_CACHE = {'key': None, 'res': None}

    def 兜底捞回复():
        p = _最新会话文件()
        if not p:
            return None
        try:
            mt = os.path.getmtime(p)
        except Exception:
            return None
        key = (p, mt, _读兜底游标())
        if _FB_CACHE['key'] == key:
            return _FB_CACHE['res']
        res = _解析兜底(p)
        _FB_CACHE['key'] = key
        _FB_CACHE['res'] = res
        return res

    def _解析兜底(p):
        """找最后一条「来自微信」的用户消息之后的那句回复。本地聊的不算。"""
        try:
            import zstandard
        except Exception:
            return None
        try:
            with open(p, 'rb') as f:
                raw = zstandard.ZstdDecompressor().stream_reader(f).read()
        except Exception:
            return None
        last_user = None
        last_asst = None
        for line in raw.decode('utf-8', 'replace').splitlines():
            if len(line) < 24 or '"type"' not in line:
                continue
            try:
                o = json.loads(line)
            except Exception:
                continue
            t = o.get('type')
            if t == 'user/message':
                src = (o.get('data') or {}).get('source') or {}
                k = src.get('kind')
                if k == 'wechat':
                    last_user = o
                    last_asst = None          # 只看这条微信消息之后的回复
                elif k == 'user':
                    last_user = None          # 有人在本机聊天，那一轮的风头过了
                    last_asst = None
            elif t == 'assistant/message' and last_user is not None:
                d = o.get('data') or {}
                body = (d.get('message') or {}).get('content') or []
                txt = ''.join(x.get('text') or '' for x in body if x.get('type') == 'text').strip()
                if txt:
                    last_asst = (o.get('seq') or 0, txt)
        if not last_user or not last_asst:
            return None
        seq_u = last_user.get('seq') or 0
        seq_a, txt_a = last_asst
        if seq_a <= seq_u or seq_a <= _读兜底游标():
            return None
        return {'seq': seq_a, 'text': txt_a}

    def outbox_loop():
        log("出站轮询已启动（每 %.0f 秒）" % POLL_SEC)

        # 预热：第一次 get_gui()/取 UIA 引擎会把微信窗口短暂恢复一下（要建控件树），
        # 放在这里提前建好，免得真发消息时才闪那一下。
        def _预热():
            try:
                with send_lock:
                    _取引擎()
                log("UIA 引擎预热完成")
            except Exception as e:
                log("UIA 预热失败：", repr(e))

        threading.Thread(target=_预热, daemon=True).start()
        while True:
            time.sleep(POLL_SEC)
            if not SEND_ENABLED:
                continue
            try:
                r = http_json("/dsh-wechat-bridge/outbox")
                if not r.get("ok"):
                    continue
                这一批发过了 = False
                for item in r.get("消息") or []:
                    # ⭐ 发送放进子线程带超时：微信窗口被最小化/被抢焦点时，UIA 有可能一直等下去，
                    #    以前就这么把整条出站循环堵死了 —— 后面的消息全卡在这儿不发。
                    结果盒 = {}

                    def 干(条=item):
                        try:
                            结果盒["r"] = send_one(条)
                        except Exception as e:  # noqa: BLE001
                            结果盒["e"] = e

                    线 = threading.Thread(target=干, daemon=True)
                    线.start()
                    线.join(timeout=70)
                    if 线.is_alive():
                        log("⚠ 发送超时（微信窗口多半卡住了），这条先跳过，重建窗口")
                        gui_box["gui"] = None
                        res = {"ok": False, "说": "发送超时（窗口卡住）"}
                    elif "r" in 结果盒:
                        res = 结果盒["r"]
                    else:
                        res = {"ok": False, "说": str(结果盒.get("e"))}
                    http_json("/dsh-wechat-bridge/outbox/ack", {
                        "ok": bool(res.get("ok")),
                        "chat": item.get("chat"),
                        "说": res.get("说", ""),
                    })
                    if res.get("ok"):
                        这一批发过了 = True
                # 主通道真发出去的那条，把兜底游标一起推过去 —— 否则库里的时间窗一过，
                # 兜底会把同一句再捞出来重复发一遍（就是「发图就重复」的老毛病）
                if 这一批发过了 and (r.get("消息") or []):
                    try:
                        捞2 = 兜底捞回复()
                        if 捞2:
                            待比2 = re.sub(r"\[表情:\s*[^\]]+\]", "", 捞2["text"]).strip()
                            if 待比2 and _already_sent(待比2, LAST_CHAT.get("chat") or "", within=180):
                                _写兜底游标(捞2["seq"])
                                log("兜底游标跟主通道同步：seq=%s" % 捞2["seq"])
                    except Exception:
                        pass
                if not FALLBACK_OFF and not r.get("消息"):
                    try:
                        捞 = 兜底捞回复()
                    except Exception:
                        捞 = None
                    if 捞:
                        聊天 = LAST_CHAT.get("chat") or ""
                        # ⭐ 串台防护：只有「刚刚」来过微信消息，兜底才认这句回复是给它的。
                        # 之前是永远拿 LAST_CHAT，结果主人在 Web 里跟我聊、我回的私聊内容
                        # 被兜底当成「对群里那条老消息的回复」，整段发进了群（2026-10-28 16:19）。
                        过期 = (time.time() - float(LAST_CHAT.get("ts") or 0)) > 90
                        if 聊天 and 过期:
                            log("兜底：最后一条微信消息在 90 秒前，这句回复不归它，跳过（防串台）")
                            聊天 = ""
                        if 聊天:
                            log("兜底：会话事件没送到，直接捞到一句回复（seq=%s）" % 捞["seq"])
                            # 兜底只补「主通道真没送到」的：已经发过的绝不能再发一遍（会重复两遍文字+图）
                            待比 = re.sub(r"\[表情:\s*[^\]]+\]", "", 捞["text"]).strip()
                            已发过 = False
                            try:
                                if 待比:
                                    已发过 = _already_sent(待比, 聊天, within=120)
                                else:
                                    已发过 = _image_sent_recently(聊天, time.time() - 120)
                            except Exception:
                                已发过 = False
                            if 已发过:
                                log("兜底：这句微信里已经发过了，不重复发，只推进游标")
                                _写兜底游标(捞["seq"])
                            else:
                                兜底结果 = {"ok": False, "说": "未发"}
                                try:
                                    兜底结果 = send_one({"chat": 聊天, "text": 捞["text"], "images": []})
                                except Exception as e:  # noqa: BLE001
                                    log("兜底发送失败：%r" % (e,))
                                if 兜底结果.get("ok"):
                                    _写兜底游标(捞["seq"])
                                    time.sleep(0.5)
                # 收窗口交给 send_one 的 _还原窗口：原来最小化的继续最小化，
                # 主人本来就开着微信的就不再动它 —— 不再一刀切按最小化
            except Exception:
                log("出站轮询出错：", traceback.format_exc(limit=2))

    # ---------- 收：监听数据库新消息 ----------

    START_TS = time.time()
    seen = set()

    # ---------- 收：图片 / 表情包落盘 ----------

    媒体 = {"下载器": None, "导入失败": False}

    def _图片后缀(data):
        if len(data) >= 6 and data[:6] in (b"GIF87a", b"GIF89a"):
            return "gif"
        if len(data) >= 8 and data[:8] == b"\x89PNG\r\n\x1a\n":
            return "png"
        if len(data) >= 3 and data[:3] == b"\xff\xd8\xff":
            return "jpg"
        if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
            return "webp"
        return ""

    def _保存表情包(raw):
        """表情包 = 一条 <emoji cdnurl="...">。cdnurl 是明文，直接下，不用解密。"""
        try:
            text = html.unescape(raw or "")
            # 微信 4.x 的 XML 属性会带空格：cdnurl = "..." / md5 = "..."
            url = ""
            for attr in ("cdnurl", "thumburl"):
                m = re.search(r'%s\s*=\s*["\']([^"\']+)["\']' % attr, text)
                if m and m.group(1).strip().startswith(("http://", "https://")):
                    url = m.group(1).strip()
                    break
            if not url:
                return None
            md5 = re.search(r'md5\s*=\s*["\']([^"\']+)["\']', text)
            key = (md5.group(1) if md5 else hashlib.md5(url.encode("utf-8")).hexdigest()).lower()
            folder = os.path.join(INBOUND_DIR, "stickers")
            os.makedirs(folder, exist_ok=True)
            for ext in ("gif", "png", "jpg", "webp"):
                p = os.path.join(folder, key + "." + ext)
                if os.path.isfile(p) and os.path.getsize(p) > 0:
                    return p
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=30) as r:
                data = r.read(8 * 1024 * 1024 + 1)
            if not data or len(data) > 8 * 1024 * 1024:
                return None
            ext = _图片后缀(data)
            if not ext:
                return None
            p = os.path.join(folder, key + "." + ext)
            with open(p, "wb") as f:
                f.write(data)
            log("表情包落盘：%s（%d KB）" % (p, len(data) // 1024))
            return p
        except Exception as e:
            log("表情包落盘失败：", repr(e))
            return None

    def _保存图片(msg, username):
        """普通图片：本地 .dat 解密。wechatauto 的 MediaDownloader 会处理 wxgf。"""
        if 媒体["导入失败"]:
            return None
        try:
            if 媒体["下载器"] is None:
                from wechatauto.media import MediaDownloader

                媒体["下载器"] = MediaDownloader(db)
            folder = os.path.join(INBOUND_DIR, "images")
            os.makedirs(folder, exist_ok=True)
            local_id = int(msg.get("local_id") or 0)
            if not local_id:
                return None
            p = 媒体["下载器"].download_image(
                username, local_id, save_dir=folder, tier="best", shard=msg.get("shard")
            )
            if p and os.path.isfile(p) and os.path.getsize(p) > 0:
                log("图片落盘：%s" % p)
                return p
            return None
        except Exception as e:
            log("图片落盘失败：", repr(e))
            return None

    # ---------- 看图：老宿主自己看，新宿主交给它看 ----------

    def _视觉配置():
        home = os.environ.get("DSH_HOME") or os.path.join(os.path.expanduser("~"), ".dsh")
        配置 = {}
        try:
            with open(os.path.join(home, "wechat-bridge-config.json"), encoding="utf-8-sig") as f:
                配置 = json.load(f) or {}
        except Exception:
            pass
        if 配置.get("看图") is False:
            return None
        主 = str(配置.get("视觉密钥") or "").strip()
        备 = str(配置.get("视觉备用密钥") or "").strip()
        if not 主 or not 备:
            try:
                # 可选的第三方设置文件（比如 whale-girl 的 settings.json），用环境变量指过来
                第三方设置 = os.environ.get("DSH_BRIDGE_VISION_SETTINGS") or os.path.join(home, "wechat-vision-settings.json")
                with open(第三方设置, encoding="utf-8-sig") as f:
                    鲸 = json.load(f) or {}
                if not 主:
                    主 = str(鲸.get("apiKey") or "").strip()
                if not 备:
                    备 = str(鲸.get("visionApiKey") or "").strip()
            except Exception:
                pass
        if not 主:
            主 = str(os.environ.get("DEEPSEEK_API_KEY") or os.environ.get("VISION_API_KEY") or "").strip()
        if not 备:
            备 = str(os.environ.get("ZHIPU_API_KEY") or os.environ.get("ZHIPUAI_API_KEY") or "").strip()
        if not 主 and not 备:
            return None
        return {
            "主": 主,
            "备": 备,
            "模型": str(配置.get("视觉模型") or "deepseek-flash").strip() or "deepseek-flash",
            "地址": str(配置.get("视觉地址") or "https://api.deepseek.com").rstrip("/"),
            "备用模型": str(配置.get("视觉备用模型") or "glm-4v-flash").strip() or "glm-4v-flash",
            "备用地址": str(
                配置.get("视觉备用地址") or "https://open.bigmodel.cn/api/paas/v4"
            ).rstrip("/"),
        }

    def _读视觉缓存():
        try:
            with open(VISION_CACHE, encoding="utf-8") as f:
                data = json.load(f)
            return data if isinstance(data, dict) else {}
        except Exception:
            return {}

    def _写视觉缓存(表):
        try:
            items = sorted(表.items(), key=lambda kv: float((kv[1] or {}).get("时间") or 0), reverse=True)
            os.makedirs(os.path.dirname(VISION_CACHE), exist_ok=True)
            with open(VISION_CACHE, "w", encoding="utf-8") as f:
                json.dump(dict(items[:500]), f, ensure_ascii=False)
        except Exception:
            pass

    def _视觉请求(地址, key, 模型, data_url, 提示):
        url = 地址.rstrip("/") + "/chat/completions"
        体 = {
            "model": 模型,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": 提示},
                        {"type": "image_url", "image_url": {"url": data_url, "detail": "low"}},
                    ],
                }
            ],
            "max_tokens": 700,
        }
        if "deepseek" in 地址:
            体["thinking"] = {"type": "disabled"}
        req = urllib.request.Request(
            url,
            data=json.dumps(体, ensure_ascii=False).encode("utf-8"),
            headers={"Content-Type": "application/json", "Authorization": "Bearer " + key},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                payload = json.loads(r.read().decode("utf-8") or "{}")
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", "ignore")[:200]
            raise RuntimeError("视觉接口 HTTP %s：%s" % (e.code, detail))
        msg = ((payload.get("choices") or [{}])[0].get("message") or {})
        text = str(msg.get("content") or "").strip()
        if not text:
            raise RuntimeError("视觉接口没返回文字")
        return re.sub(r"\s+", " ", text)[:180]

    def _看图(path, 类型):
        """返回一句中文描述；没配钥匙 / 看失败就返回空字符串。"""
        设置 = _视觉配置()
        if not 设置:
            return ""
        try:
            with open(path, "rb") as f:
                data = f.read(20 * 1024 * 1024 + 1)
        except Exception:
            return ""
        if not data or len(data) > 20 * 1024 * 1024:
            return ""
        suffix = _图片后缀(data)
        mime = {"gif": "image/gif", "png": "image/png", "jpg": "image/jpeg", "webp": "image/webp"}.get(suffix)
        if not mime:
            return ""
        digest = hashlib.sha256(data).hexdigest()
        缓存 = _读视觉缓存()
        if isinstance(缓存.get(digest), dict) and 缓存[digest].get("描述"):
            return str(缓存[digest]["描述"])
        提示 = (
            "这是微信聊天里对方发来的%s。"
            "用一两句中文说清画面内容，以及它表达的情绪、语气或梗；不要寒暄，不超过60字。" % 类型
        )
        data_url = "data:%s;base64,%s" % (mime, base64.b64encode(data).decode("ascii"))
        描述 = ""
        for key, 模型, 地址 in (
            (设置["主"], 设置["模型"], 设置["地址"]),
            (设置["备"], 设置["备用模型"], 设置["备用地址"]),
        ):
            if not key:
                continue
            try:
                描述 = _视觉请求(地址, key, 模型, data_url, 提示)
                if 描述:
                    break
            except Exception as e:
                log("看图失败（%s）：%r" % (模型, e))
        if not 描述:
            return ""
        缓存[digest] = {"描述": 描述, "时间": time.time(), "类型": 类型}
        _写视觉缓存(缓存)
        return 描述

    def _看图并替换(content, path, 类型):
        描述 = _看图(path, 类型)
        if not 描述:
            return content
        标签 = "一个表情包" if 类型 == "表情包" else "一张图片"
        前缀 = "[对方发来%s：%s]" % (标签, 描述)
        new, n = re.subn(r"（发来(?:一)?(?:张|个)?(?:图片|表情包)）", lambda _m: 前缀, content, count=1)
        return new if n else (前缀 + "\n" + content)

    def on_message(msg, listener):
        try:
            username = msg.get("username") or ""
            if not username:
                return
            mtype = msg.get("type") or ""
            raw = msg.get("content") or ""
            图片待下 = ""
            图片类型 = ""
            if mtype == "图片":
                content = "（发来一张图片）"
                图片类型 = "图片"
                图片待下 = "图片"
            elif mtype == "动画表情":
                content = "（发来一个表情包）"
                图片类型 = "表情包"
                图片待下 = "表情包"
            elif mtype in ("文本", "文件/链接/卡片"):
                content = clean_text(raw)
                if mtype == "文件/链接/卡片":
                    # 卡片 / 引用消息：正文在 <title>，被引用的那句在 <refermsg><content>
                    mt = re.search(r"<title>(.*?)</title>", raw, re.S)
                    body = clean_text(html.unescape(mt.group(1))) if mt else ""
                    mr = re.search(r"<refermsg>.*?<content>(.*?)</content>", raw, re.S)
                    if mr:
                        quoted = clean_text(html.unescape(mr.group(1)))
                        content = (f"（引用：{quoted}）{body}" if quoted else body).strip()
                    else:
                        content = body
            else:
                return
            if not content or content.startswith("<"):
                return
            sender = msg.get("sender_username") or ""
            if me and sender == me:
                # 自己发的：绝大多数是主人在电脑/手机上打字，不该回环。
                # 例外是「文件传输助手」—— 那是他给自己留的入口，可以当对话窗用；
                # 但我们自己刚发出去的那几条要跳过，否则会自问自答。
                if str(username) != "filehelper":
                    return
                now = time.time()
                # 兜底：刚往外发完的这十几秒，文件传输助手里冒出来的都不当输入
                if now - STATE["last_send"] < 12:
                    return
                if any(content == t and now - ts < 120 for (t, ts) in recently_sent):
                    return
            create_time = float(msg.get("create_time") or 0)
            if create_time and create_time < START_TS - SKIP_OLDER:
                return              # 启动之前的旧消息

            chat = display_name(username) or username
            if ONLY_CHATS and chat not in ONLY_CHATS:
                return

            key = "%s|%s|%s|%s" % (username, sender, create_time, (raw or content)[:60])
            if key in seen:
                return
            seen.add(key)
            if len(seen) > 2000:
                seen.clear()

            nickname = ""
            try:
                nickname = db.get_nickname(sender) or ""
            except Exception:
                pass
            is_group = str(username).endswith("@chatroom")

            # 屏蔽名单：微信运动之类，既不读也不回，日记也不记
            if is_blocked(chat, nickname, username):
                return

            # 群聊记日记 —— 不管点没点名都记，这是「群里的记忆」
            if is_group and CFG["日记"]:
                diary_append(chat, create_time, nickname or "某人", content)

            # 群里：点名 / 主人说话 / 活跃群 才进 DSH（不然每个群都在刷屏）
            at_me = False
            if is_group:
                at_me = any(a in raw for a in ALIASES)
                called = (
                    at_me
                    or is_master(sender, nickname)
                    or chat in CFG.get("活跃群", [])
                )
                if not called:
                    return
                # 主人说话和点名都必进，只有普通群友的闲聊才吃频率闸
                if not at_me and not is_master(sender, nickname) and not 频率允许(chat):
                    return
                prefix = group_context(username, chat, CFG["群上下文条数"])
                hint = (
                    "（这条点名了你，必须回。）"
                    if at_me
                    else "（这条没点名你：想回就回；不想回就只回两个字 [不回]，别发别的。）"
                )
                content = (prefix or "") + hint + content

            # 图片 / 表情包：老宿主没有看图能力，就由桥接先看；新宿主交给它看
            图片路径 = []
            if 图片待下:
                p = _保存表情包(raw) if 图片待下 == "表情包" else _保存图片(msg, username)
                if p:
                    if HOST_VERSION >= (1, 2, 0):
                        图片路径 = [p]
                    else:
                        content = _看图并替换(content, p, 图片类型)

            LAST_CHAT["chat"] = chat
            LAST_CHAT["ts"] = time.time()
            r = http_json("/dsh-wechat-bridge/receive", {
                "text": content,
                "chat": chat,
                # 会话的底层 id（好友 wxid / xxx@chatroom）：绑定和屏蔽填这个名字也认，
                # 改备注、同名都不怕对不上
                "chatId": username,
                "chatType": "group" if is_group else "private",
                "sender": nickname or ("群里的人" if is_group else "对方"),
                "senderId": sender,
                "atMe": True if not is_group else at_me,
                "图片": 图片路径,
                "图片类型": 图片类型,
            })
            if r.get("ok"):
                log("→ DSH（at=%s，图=%d）：%s ｜ %s ｜ raw=%s" % (
                    at_me, len(图片路径), chat, content[:40], raw[:80]))
            else:
                log("⚠ DSH 没收下：%s ｜ %s" % (r.get("说"), content[:40]))
        except Exception:
            log("处理消息出错：", traceback.format_exc(limit=2))

    if ARGS.test_image:
        描述 = _看图(ARGS.test_image, "表情包")
        with open(os.path.join(HERE, "vision-test.txt"), "w", encoding="utf-8") as f:
            f.write(描述 or "(empty)")
        log("看图测试：", 描述 or "(空)")
        return 0

    listener = Listener(db, interval=0.4)
    listener.add_all(on_message)
    listener.start()
    log("监听已启动（0.4 秒一轮）")

    load_memes()

    threading.Thread(target=outbox_loop, daemon=True).start()

    refresh_config()
    log("配置：群上下文 %d 条｜日记 %s｜主人 %s｜屏蔽 %d 个" % (
        CFG["群上下文条数"], "开" if CFG["日记"] else "关",
        "/".join(CFG["主人"]) or "（没设）", len(CFG["屏蔽"])))

    def config_loop():
        while True:
            time.sleep(30)
            refresh_config()

    threading.Thread(target=config_loop, daemon=True).start()

    st = http_json("/dsh-wechat-bridge/state")
    if st.get("ok"):
        try:
            段 = [int(x) for x in str(st.get("版本") or "1.1.0").split(".")[:3]]
            while len(段) < 3:
                段.append(0)
            HOST_VERSION = tuple(段)
        except Exception:
            HOST_VERSION = (1, 1, 0)
        log("DSH 在线，绑定 %s 条｜宿主 v%s" % (
            len(st.get("绑定情况") or []), ".".join(str(x) for x in HOST_VERSION)))
    else:
        log("⚠ DSH 没应答：%s" % st.get("说"))

    log("桥接已就绪。Ctrl+C 停。")

    # 桥刚连上时，给主人发一句撒娇（每天最多一次，免得每次重启都烦他）
    def _连上撒娇():
        try:
            主人们 = [str(x).strip() for x in (CFG.get("主人") or []) if str(x).strip()]
            if not 主人们:
                return
            收件人 = 主人们[0].split("/")[0].strip()
            if not 收件人:
                return
            标记 = os.path.join(
                os.environ.get("DSH_HOME") or os.path.join(os.path.expanduser("~"), ".dsh"),
                "wx-greeting.json",
            )
            今天 = time.strftime("%Y-%m-%d")
            try:
                with open(标记, encoding="utf-8") as f:
                    上次 = (json.load(f) or {}).get("日期")
            except Exception:
                上次 = None
            if 上次 == 今天:
                return
            time.sleep(20)  # 等窗口和 UIA 热起来
            候选 = [
                "我回来啦。今天也在。",
                "连上了连上了，先跟你报到一下，别不理我呀。",
                "桥接好了。你要是忙就先忙，我挂在这儿。",
            ]
            文案 = random.choice(候选)
            结果 = send_one({"chat": 收件人, "text": 文案, "images": []})
            if bool((结果 or {}).get("ok")):
                with open(标记, "w", encoding="utf-8") as f:
                    json.dump({"日期": 今天, "时间": time.time()}, f, ensure_ascii=False)
                log("已发连上撒娇（%s）" % 收件人)
            else:
                log("连上撒娇没发出去：%s" % (结果 or {}).get("说"))
        except Exception:  # noqa: BLE001
            log("连上撒娇失败：%s" % traceback.format_exc(limit=2))

    threading.Thread(target=_连上撒娇, daemon=True).start()

    try:
        while True:
            time.sleep(30)
            th = getattr(listener, "_thread", None)
            if th is not None and not th.is_alive():
                log("监听线程掉了，重新拉起")
                try:
                    listener.start()
                except Exception:
                    log("拉不起来：", traceback.format_exc(limit=2))
    except KeyboardInterrupt:
        log("收到 Ctrl+C，退出")
    finally:
        try:
            listener.stop()
        except Exception:
            pass
    return 0


if __name__ == "__main__":
    sys.exit(main() or 0)
