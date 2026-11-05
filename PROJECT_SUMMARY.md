# dsh-wechat-bridge 项目说明与交付报告

- **版本**：1.13.4
- **仓库**：https://github.com/K2I2Gary/ds-wechatbridge
- **本地目录**：`C:\Users\K2\Desktop\fish\dsh-wechat-bridge`
- **状态**：GitHub `main` 已到 1.13.4；本地 1.13.4 已同步到 DSH desktop profile；额外安装 `dsh-nekowhale-stickers` 1.1.1
- **日期**：2026-11-05

## 一句话

把 DSH 里的 AI 伙伴和微信打通：读微信 4.x 本地库收消息，用 Windows UI Automation + 剪贴板发消息；不注入、不 hook、不改微信协议，用的是你自己的微信号。同时支持本地图片 / 表情库和大肥鱼表情包。

## 架构

```text
微信 4.x 本地库（只读）
        │  Listener（0.4s 轮询）
        ▼
Python 桥接（bridge/wechat_bridge.py）
        │  POST /dsh-wechat-bridge/receive
        ▼
DSH 宿主插件（lib/host.js）
        │  agent.followup
        ▼
DSH 会话 / 模型
        │  session/event → turn/end
        ▼
宿主出站队列
        │  GET /dsh-wechat-bridge/outbox（0.5s 轮询）
        ▼
Python 桥接 → UIA / 剪贴板 / 键盘兜底 → 微信窗口
```

表情包有两条链路：

```text
收到的表情：wechat_sticker_search → wechat_send_image(id/path/url) → 出站队列 → 微信
            [表情: 描述] → 桥接先查本地表情库 → 再查 dsh-meme → 发图

大肥鱼表情：sticker_search → sticker_send → Markdown 本机图
            → 宿主摘图 → 出站队列 → 桥接下载本机 URL → 微信（GIF 只发第一帧）
```

| 层 | 文件 | 行数 | 职责 |
| --- | --- | ---: | --- |
| 宿主插件 | `lib/host.js` | 3369 | 路由、配置、会话绑定、权限闸、出站队列、主动搭话队列、Python 进程管理、9 个工具注册 |
| 设置页 | `lib/client.js` | 1819 | DSH 设置里的「通到微信」界面；绑定、屏蔽、人格、温度、图片 / 表情库、本地知识库、独立联网搜索 |
| 表情库纯函数 | `lib/sticker.js` | 117 | 情绪 / 标签抽取、内容指纹、检索打分、2 分钟冷却判断 |
| 看图 | `lib/vision.js` | 212 | 视觉模型描述、缓存、DeepSeek → 智谱备用 |
| Python 桥接 | `bridge/wechat_bridge.py` | 3850 | 只读微信库、收消息、图片 / 表情包落盘、发送、RAG、本地库、表情库匹配 |
| 本地检索 | `bridge/local_search.py` | 524 | 微信历史 / 笔记 / 联网结果检索、关键词注意力、去重 |
| 独立搜索 | `bridge/web_search.py` | 361 | 联网搜索、网页正文提关键词、搜索组 / 权重、要点 JSON |

## 能力总览

### 消息与会话
- **双向聊天**：微信消息转进绑定的 DSH 会话；伙伴说完一整轮，回复发回原聊天
- **只看选中的会话**：「只听」为空 = 全部；非空时名单外不读、不下载图片、不写日记
- **单独绑定**：一个微信聊天 → 一间 DSH 会话；支持显示名、wxid、`xxx@chatroom`
- **最近聊天**：设置页可从最近来找过的人 / 群里直接点选绑定或屏蔽
- **旧会话兜底**：目标会话没开着时尝试 `agents.resume`

### 微信语义与记忆
- **@ 语义**：按群成员名最长匹配 + `U+2005` 解析；正文保留 `@昵称`，额外标注「@了你 / @了谁」；`@所有人` 算点名
- **引用消息**：只从引用之外的正文解析 @
- **RAG**：收到消息时在当前会话最近 N 天历史里做本地词面检索（中文二元词 + IDF + 时间衰减 + 原句命中），不建向量库
- **人格画像**：从本地 `humanity.txt` / `~/.dsh/wechat-persona.txt` 读取，按需注入 `<persona>`；第 1 条 + 每 N 条重提
- **对话温度**：0–1 滑杆；0 主动、0.5 正常、1 消极但不沉默；作为采样 `temperature` 注入，并附带行为提示
- **图片倾向**：0–1 滑杆；每轮注入选图 / 发图提示（大肥鱼包 → 收到的表情 → 普通图片）
- **语言微调**：自定义说话风格，每轮注入；不改事实、权限和安全规则

### 图片、表情与表情包
- **收图**：微信里收到的图片 / 表情包落到 `~/.dsh/wechat-inbound/`（`images/`、`stickers/`），视觉模型先描述一遍；同时复制一份到会话工作区的 `wechat-images/`
- **图片记忆**：`~/.dsh/wechat-image-memory.json`（最近 500 条），记录描述、工作区文件、原文件、聊天、发送人、类型、时间
- **表情库字段**：情绪、标签、内容指纹、使用次数、最后使用、最近发送、别名、启用状态；旧 JSON 读取时自动补全
- **内容去重**：同一张图换文件名只存一条，旧文件名进「别名」，按任一 id 都能发
- **`wechat_sticker_search`**：按关键词 / 情绪筛选，优先没用过、少用过的；同一聊天 2 分钟内发过的自动略过
- **`wechat_send_image`**：支持 `id` / `path` / `url`；按 id 发时工作区副本没了自动回落 `wechat-inbound` 原文件；同一聊天 2 分钟内不重复发同一张表情，`强制=true` 可绕过
- **`[表情: 描述]`**：桥接先查本地表情库（描述 + 情绪 + 标签），找不到再查 `dsh-meme`；图片记忆 mtime 变化时自动重建索引，不用重启桥接
- **大肥鱼 / GPT娘表情包**：安装 `dsh-nekowhale-stickers` 后可用 322 张表情；`sticker_send` 返回本机 Markdown 图，宿主摘图、桥接下载后发到微信。GIF 在微信里只发第一帧
- **设置页图片管理**：全部 / 表情包 / 图片筛选，情绪标签、使用次数、停用 / 启用、手动改描述 / 情绪 / 标签、单张删除 / 清空
- **`.wxgf`**：微信 HEVC 图片 / 动画表情容器；`imageio-ffmpeg` 自动转 PNG，视觉、预览、发送都可用；`wechat_read_image` 可单独读图
- **表情包**：`dsh-meme` 表情库仍可用于 `[表情: 描述]`；本地表情库优先

### 主动搭话
- 温度 ≤ 0.1 且空闲超过 N 分钟（默认 30）时触发
- **多会话串行队列**：按空闲最久优先排队，一个会话 `turn/end` 后才处理下一个；回复分别回到各自聊天
- 手动「现在就让她说一句」也进同一队列；单会话最多等 120 秒
- 不依赖桥接进程的部分：独立联网搜索

### 本地知识库与联网
- **SQLite + FTS5**：`~/.dsh/wechat-bridge-memory.db`
- 索引「只听」里的微信历史（默认 180 天 / 每聊 500 条）+ `~/.dsh/wechat-bridge-notes` 下的 `.md/.txt`
- **`local_search`**：搜微信历史、笔记、已入库的联网结果
- **`keyword_search`**：关键词注意力排序（关键词重叠 × 权重 + 来源权重 + 时间衰减，softmax 归一化），最多 5 条
- **独立联网搜索**：设置页「联网搜索（独立）」/ `web_search` 工具 / `web_search.py`；不需要启动微信桥接
- **网页关键词**：抓结果页正文（4 并发，限 1.5MB / 6 秒），提取关键词
- **搜索组**：每次搜索一组（`search_groups` / `search_keywords`），可回看最近 5 组
- **关键词权重**：0–10 可调并保存；参与 `keyword_search` 的注意力排序（同词取最大）
- **去重**：按归一化正文指纹（前 180 字）+ URL，微信 / 笔记优先
- **可视化**：每个搜索组 Top 10 关键词权重水平条形图（单系列、直接标注、无图例、浅深色适配、纯 HTML/CSS）
- **要点 JSON**：每次搜索同时保存 `.md` 和 `.json`；JSON 含 `query / ts / keywords / points / results`

### 发送可靠性
- 微信主窗口标题兼容 `微信` / `WeChat`；按标题 + `weixin.exe` 进程认窗口
- 最小化 / 托盘 / 被编辑器挡住时先还原窗口，发完按原状态收回
- UIA 查询加超时；`send_msg` 超时按失败处理，走键盘兜底（Ctrl+F → 粘贴 → 回车）
- **发送提速**：出站轮询 0.5 秒；微信已在前台 / 窗口正常时走快路径；拆条间隔 0.15 秒
- `zstandard`：长文本 / 卡片 / 动图解压；`winsdk`：OCR 兜底
- UIA 连续失败熔断 5 分钟，避免坐标盲点乱点桌面
- 长回复拆条失败会继续发后面的段；锁屏时消息留在队列，解锁后自动发
- 本机 HTTP 图（大肥鱼表情包 / DSH 本地服务）会在发送前下载成本地文件（30 秒超时）

## 配置项

配置保存在 `~/.dsh/wechat-bridge-config.json`；保存后桥接 30 秒内热更新。

| 项 | 默认 | 说明 |
| --- | --- | --- |
| 总开关 | 关 | 关着 = 一句都不发 |
| 试运行 | 开 | 只记「该发什么」，不真发 |
| 人格 | 开 | 从本地文件读人设 |
| 人格文件 | 空 | 留空 = 插件目录 `humanity.txt` / `~/.dsh/wechat-persona.txt` |
| 人格重提条数 | 10 | 每 N 条微信消息重提一次完整人设 |
| 温度 | 0.5 | 0 = 主动，0.5 = 正常，1 = 被动但不沉默；步长 0.1 |
| 图片倾向 | 0.3 | 0 = 文字优先，0.5 = 图文均衡，1 = 尽量用图片 |
| 语言微调 | 空 | 自定义说话风格，每轮注入 |
| 主动搭话 | 开 | 温度 ≤ 0.1 时，空闲到点主动说一句 |
| 主动搭话分钟 | 30 | 超过多少分钟没新消息触发 |
| 主动搭话每小时 | 2 | 每小时最多几次；0 = 不限 |
| 默认会话 | 空 | 微信来的消息进哪一间 |
| 只听 | 空 | 只读这些会话；空 = 全部 |
| 单独绑定 | 空 | 微信聊天 → DSH 会话；支持显示名 / wxid / 群 id |
| 接口令牌 | 空 | Python 侧请求令牌；留空不校验 |
| 解释器 | 空 | 已装 `wechatauto-replica` 的 `python.exe` |
| 微信语言 | 自动 | 自动 / 中文 / 英文 |
| 看图 | 开 | 收到图片时用视觉模型写描述 |
| 视觉密钥 / 模型 / 地址 | 空 / deepseek-flash / api.deepseek.com | 高级；可再配一套备用（智谱 glm-4v-flash） |
| 价_缓存读 / 价_输入 / 价_输出 | 空 | 用量账本单价；空 = 只记 token 不算钱 |
| 主人 | 空 | wxid 或昵称；只有主人能调用工具 |
| 外人只能聊天 | 开 | 非主人那一轮硬拦所有工具 |
| 群上下文条数 | 6 | 被叫到时往前带几条群聊 |
| RAG | 开 | 当前会话历史检索 |
| RAG 条数 | 5 | 每次最多几条；0 = 关 |
| RAG 天数 | 30 | 往回找多少天 |
| 本地库 | 开 | 索引微信历史 + 笔记 |
| 本地库文件 | 空 | 默认 `~/.dsh/wechat-bridge-memory.db` |
| 笔记目录 | 空 | 默认 `~/.dsh/wechat-bridge-notes` |
| 本地库天数 | 180 | 回填多少天 |
| 本地库每聊条数 | 500 | 每个聊天回填多少条 |
| 联网搜索 | 开 | 关键词搜索可联网抓取并入库 |
| 搜索地址 | Tavily | 默认 `https://api.tavily.com/search` |
| 搜索密钥 | 空 | Tavily key；留空退 DuckDuckGo HTML |
| 搜索条数 | 5 | 每次联网取几条写入库 |
| 关键词条数 | 5 | 注意力 Top 条数（上限 5） |
| 群回复间隔秒 | 30 | 同一个群两条回复的最小间隔 |
| 群每小时上限 | 6 | 同一个群一小时最多接几次 |
| 群聊日记 | 开 | 群里所有消息按天写 markdown |
| 日记目录 | 空 | 默认 `~/.dsh/wechat-diary` |
| 屏蔽 | 见上 | 不回、不读、不写日记的名字 / id |

## 工具

本插件 9 个：

| 工具 | 参数 | 作用 |
| --- | --- | --- |
| `wechat_block` | `{who, action: add / remove / list}` | 改「不回谁」名单 |
| `wechat_bind` | `{chat, session, action}` | 微信聊天绑定 DSH 会话 |
| `wechat_sticker_search` | `{query?, mood?, chat?, limit?}` | 从微信收到的表情里按关键词 / 情绪挑一张，优先少用的 |
| `wechat_send_image` | `{id / path / url, chat?, text?, 强制?}` | 发图到微信；id 副本缺失回落原文件；2 分钟冷却 |
| `wechat_image_memory` | `{query?, id?, 类型?, chat?, limit?}` | 查图片 / 表情记忆（描述、情绪、路径、使用次数） |
| `wechat_read_image` | `{id? / path?}` | 视觉模型单独读一张图，并把描述写回记忆 |
| `local_search` | `{query, chat?, limit?}` | 搜本地微信历史 / 笔记 / 已入库联网结果 |
| `keyword_search` | `{query, chat?, web?, limit?}` | 关键词注意力排序，最多 5 条；`web=true` 联网并入库 |
| `web_search` | `{query, limit?, save?, fetch?}` | 独立联网搜索；不需要启动微信桥接 |

安装 `dsh-nekowhale-stickers` 后会额外有 4 个工具（属于该插件）：

| 工具 | 作用 |
| --- | --- |
| `sticker_search` | 在大肥鱼 / GPT娘 322 张表情里按情绪 / 场景检索 |
| `sticker_send` | 返回一行 Markdown 本机图片，宿主摘出来发到微信 |
| `meme_render` | 用「想 / 举牌 / 葱卷 / 上联 / 下联 / 抱」模板本地生成表情 |
| `sticker_manage` | 浏览、开关、白名单、同步、出处 |

## HTTP 接口

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| POST | `/dsh-wechat-bridge/receive` | 收消息 → 会话 |
| POST | `/dsh-wechat-bridge/seen` | 名单外会话只报名字 / id / 类型 |
| GET | `/dsh-wechat-bridge/outbox` | 取待发队列 |
| POST | `/dsh-wechat-bridge/outbox/ack` | 发送结果回报 |
| GET | `/dsh-wechat-bridge/state` | 设置页状态 |
| GET | `/dsh-wechat-bridge/memory` | 本地记忆统计 |
| POST | `/dsh-wechat-bridge/memory/clear` | 清本地记忆（all / chat / notes / web） |
| GET | `/dsh-wechat-bridge/images` | 图片 / 表情库列表 |
| POST | `/dsh-wechat-bridge/images/delete` | 删图 / 清空 |
| POST | `/dsh-wechat-bridge/images/meta` | 改描述 / 情绪 / 标签 |
| POST | `/dsh-wechat-bridge/images/toggle` | 停用 / 启用表情 |
| GET | `/dsh-wechat-bridge/image?path=…` | 预览图片 |
| POST | `/dsh-wechat-bridge/save` | 保存配置 |
| POST | `/dsh-wechat-bridge/test-send` | 发一条测试消息 |
| POST | `/dsh-wechat-bridge/send` | 手动发到指定聊天 |
| POST | `/dsh-wechat-bridge/test-inbound` | 灌一条测试消息进会话 |
| POST | `/dsh-wechat-bridge/vision-test` | 试看本地图片 |
| GET | `/dsh-wechat-bridge/check-update` | 检查 GitHub 版本 |
| POST | `/dsh-wechat-bridge/web-search` | 独立联网搜索 |
| GET | `/dsh-wechat-bridge/web-search/groups` | 最近搜索组 |
| POST | `/dsh-wechat-bridge/web-search/weights` | 保存某组关键词权重 |
| GET/POST | `/dsh-wechat-bridge/bridge/status` | 桥接状态 |
| POST | `/dsh-wechat-bridge/bridge/install` | 装依赖 |
| POST | `/dsh-wechat-bridge/bridge/start` | 启动桥接 |
| POST | `/dsh-wechat-bridge/bridge/stop` | 停止桥接 |
| POST | `/dsh-wechat-bridge/speak-now` | 立即触发一次主动搭话 |

## 数据与文件

| 路径 | 内容 |
| --- | --- |
| `~/.dsh/wechat-bridge-config.json` | 插件配置 |
| `~/.dsh/wechat-bridge-venv/` | Python 虚拟环境 |
| `~/.dsh/wechat-bridge-memory.db` | 本地知识库（SQLite FTS5） |
| `~/.dsh/wechat-bridge-notes/` | 本地笔记目录（`.md/.txt`） |
| `~/.dsh/wechat-bridge-notes/web/` | 联网搜索保存的 `.md` + `.json` |
| `~/.dsh/wechat-persona.txt` | 当前生效的人设文件 |
| `~/.dsh/wechat-image-memory.json` | 图片 / 表情记忆（描述、情绪、标签、指纹、使用次数、别名） |
| `~/.dsh/wechat-vision-cache.json` | 视觉描述缓存（按内容哈希，最多 500 条） |
| `~/.dsh/wechat-inbound/` | 收到的图片 / 表情包原文件（`images/`、`stickers/`） |
| `<会话工作区>/wechat-images/` | 当前会话的图片副本 |
| `~/.dsh/wechat-diary/` | 群聊日记 |
| `~/.dsh/wechat-affinity.json` | 外人的好感度 |
| `~/.dsh/wechat-bridge-chats.json` | 最近来找过的聊天 |
| `~/.dsh/wechat-bridge-usage.json` | 用量与费用账本 |
| `~/.dsh/wechat-bridge-host.log` | 宿主日志 |
| `~/.dsh/nekowhale-stickers/` | 大肥鱼表情包缓存（`manifest.json`、`packs/`） |
| `bridge/bridge.log` | Python 桥接日志 |

## 权限与安全

- **主人**：`主人` 名单里的 wxid / 昵称；可以聊天、读文件、跑命令、改设置
- **外人**：只能聊天；那一轮宿主用 `tools.guard` 在工具执行前硬拒
- **令牌**：Python 侧请求带 `x-bridge-token`；留空不校验（仅建议本机）
- **密钥**：视觉密钥 / 搜索密钥在设置页只显示「（已设）」，保存时不回写明文
- **本机**：微信桥接只读写本机；联网搜索仅在你主动搜索时访问外部搜索接口
- **大肥鱼表情包**：由独立插件 `dsh-nekowhale-stickers` 提供；素材许可 Apache-2.0 AND CC BY-NC 4.0，仅限非商业使用
- **账号风险**：个人微信自动化不是官方接口，有封号风险；建议先用小号 / 测试号

## 性能与响应

- 出站轮询：**0.5 秒**
- 微信在前台 / 窗口正常：快路径，不反复最小化 / 还原 VS Code
- 微信最小化 / 被挡：先还原再发，发完按原状态收回
- 拆条发送间隔：0.15 秒
- UIA 查询有超时；`send_msg` 超时走键盘兜底
- 主动搭话：串行队列，按空闲最久优先，单会话最多等 120 秒
- 网页抓取：4 并发，单页限 1.5MB / 6 秒
- 本地检索：中文二元词 + FTS5；关键词权重参与 softmax 注意力
- 长文本 / 卡片 / 动图：`zstandard` 解压，2MB 上限
- 本机图片下载：30 秒超时；大肥鱼表情首次使用才下载

## Double check 结果（2026-11-05）

| 检查 | 结果 |
| --- | --- |
| Git 分支 | `main` 与 `origin/main` 一致（1.13.4） |
| 最近提交 | 1.13.4：本地表情库 + 大肥鱼表情包接入 |
| `package.json` 版本 | 1.13.4 |
| 宿主自测 | 104 条全过 |
| 设置页自测 | 69 条全过 |
| 「只听」自测 | 10 条全过 |
| RAG / @ / zstd 自测 | 24 条全过 |
| 本地知识库自测 | 28 条全过 |
| 本地表情库自测 | 8 条固定断言 + 真实数据检查全过（含 `--meme-test` 端到端匹配） |
| `node --check` / `py_compile` / `git diff --check` | 通过 |
| DSH 已装版本 | 1.13.4（本地同步） |
| 大肥鱼表情包 | `dsh-nekowhale-stickers` 1.1.1，322 张清单已拉取 |
| 真实表情库 | 15 张表情包；`无语` / `得意` / `猫` 等检索命中 |

## 版本演进

| 版本 | 主要内容 |
| --- | --- |
| 1.13.4 | 接入 `dsh-nekowhale-stickers`；本工具改名 `wechat_sticker_search`；摘本机 Markdown 图、清理工具附言 |
| 1.13.3 | 冷却改 2 分钟；`[表情: 描述]` 接入本地表情库并热更新；设置页可编辑描述 / 情绪 / 标签 |
| 1.13.2 | 情绪 / 标签 / 指纹、去重、`sticker_search`、使用计数与 30 分钟冷却、设置页筛选 / 停用 |
| 1.13.1 | 图片记忆按类型过滤；`wechat_send_image` 按 id 发图回落原文件；回填脚本 |
| 1.13.0 | 图片倾向 + 语言微调 |
| 1.12.0 | 支持 `.wxgf`（微信 HEVC 图片） |
| 1.11.0 | 图片落工作区 + 设置页图片管理 |
| 1.10.x | 图片描述入 JSON、发图工具、图片记忆、工具 inject 修复 |
| 1.9.x | 发送提速、去重、关键词条形图、本地记忆、记忆清除、中英文微信 |
| 1.8.x | 网页抓取关键词、搜索组、关键词权重 |
| 1.7.0 | 独立联网搜索 |
| 1.6.0 | 关键词注意力、联网入库 |
| 1.5.0 | 温度 0 主动搭话、本地知识库 |
| 1.4.x | `winsdk`、窗口标题 / 最小化还原、UIA 超时与键盘兜底 |
| 1.3.x | 只看选中的会话、@ / 引用、RAG、人格、温度 |

## 部署与重启

当前 DSH desktop profile 已装 1.13.4（本地同步）+ `dsh-nekowhale-stickers` 1.1.1。让运行中的 DSH 加载新代码 / 新插件：

1. 完全退出 DSH（托盘 → 退出，确认进程结束）
2. 重新打开
3. 设置 → 通到微信，确认版本 1.13.4
4. 启动桥接（需要微信已登录）
5. 侧栏「插件」确认「大肥鱼表情包」已加载

从仓库安装 / 更新：

```powershell
dsh plugin --profile desktop add github:K2I2Gary/ds-wechatbridge
dsh plugin --profile desktop add dsh-nekowhale-stickers
```

独立联网搜索不需要启动微信桥接：

```powershell
python bridge/web_search.py "关键词" --limit 5
python bridge/web_search.py --list-groups --db ~/.dsh/wechat-bridge-memory.db
python bridge/web_search.py --set-weights 1 '{"关键词": 3.5}' --db ~/.dsh/wechat-bridge-memory.db
```

表情匹配排障：

```powershell
python bridge/wechat_bridge.py --meme-test 无语
# {"ok": true, "路径": "...gif", "本地表情": 15, "说": ""}
```

## 已知限制与风险

1. **微信 UIA 可能假死**：还能收消息但发送一直超时 / 落点错误。最有效的恢复是完整重启微信，再停止 / 启动桥接。
2. **旧 DSH 会话可能不可恢复**：会话日志里出现当前 harness 不认识的 `job/registered` 时会被拒绝加载。
3. **网页抓取可能失败**：目标站反爬、超时、非 HTML 时会退回搜索摘要。
4. **联网搜索**：Tavily 需要密钥；无密钥退 DuckDuckGo HTML，部分网络可能访问不了。
5. **去重是近似**：按归一化前 180 字 + URL，同义改写 / 不同摘要仍可能各留一条。
6. **RAG 是词面检索**：当前会话、不跨私聊；同义改写可能捞不到。
7. **关键词权重是全局同词最大**：不是严格按搜索组隔离。
8. **主动搭话**：默认 30 分钟；手动按钮也要桥接在跑、会话活着；串行队列单会话最多等 120 秒。
9. **温度是行为提示 + 采样参数**：模型仍可能按自己的判断偏离。
10. **GIF 只发第一帧**：微信剪贴板位图限制；微信里收到的表情和大肥鱼表情都如此，原文件会完整保留。
11. **2 分钟冷却只作用于本插件表情库**：大肥鱼包走 `sticker_send`，频率由它自己的 `frequency` 设置控制。
12. **大肥鱼表情首次使用才下载**：需要网络访问 `kiriyuki.com`；单个 GIF 最大约 5.6MB。
13. **大肥鱼素材许可**：Apache-2.0 AND CC BY-NC 4.0，仅限非商业使用；分发请保留署名。
14. **个人微信自动化有封号风险**，只在 Windows 上可用，微信升级可能导致 UIA 失效。

## 开发自测

```powershell
$env:DSH_HOME="$PWD\.testhome"; node _selftest.mjs
$env:DSH_HOME="$PWD\.testhome"; node _selftest_client.mjs
python -I _selftest_filter.py
python -I _selftest_rag.py
python -I _selftest_localdb.py
python -I _selftest_sticker.py
```

自测全部使用临时目录 / 假 ctx / 假 React，不碰真实配置和微信数据。

维护脚本：

```powershell
node _backfill_image_memory.mjs --dry-run   # 看会补哪些图片描述
node _backfill_image_memory.mjs             # 真写：补描述、情绪、标签、指纹，合并重复
```
