# 接口说明

所有接口都在 `/api` 下，请求和返回都是 JSON。出错时返回 `{ "error": "错误说明" }`。

除 `/health` 与 `/auth/*` 外，其余接口都需要先登录（Cookie 会话）。服务只接受来自本机的请求，跨站的写请求会被拒绝。

**多账号**：一个工作空间可以有多个账号。所有业务接口都按当前登录账号过滤数据，隔离在服务端完成，不依赖前端传参。同一个账号名全局唯一。

## 健康检查

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | /health | 返回 `{ ok: true, mode: "local" }`，用于确认服务已启动，不需要登录 |

## 账号

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | /auth/session | 返回已注册账号列表 `{ accounts, user }`；`user` 为当前登录用户，未登录时为 `null` |
| POST | /auth/setup | 注册新账号 `{ username, password, name? }`，成功后直接登录 |
| POST | /auth/login | 登录 `{ username, password }`，连续失败 10 次锁定 15 分钟 |
| POST | /auth/logout | 退出登录（切换账号时调用，再重新登录即可） |
| POST | /auth/reset/request | 请求发送找回验证码 `{ account }`，`account` 可填账号名或已绑定邮箱 |
| POST | /auth/reset/confirm | 校验验证码并重置密码 `{ account, code, newPassword }` |
| GET / PUT | /profile | 读取 / 修改个人资料 `{ name, email, role, bio }` |
| POST | /profile/email/request | 请求发送邮箱验证码 `{ email }`（用于绑定邮箱） |
| POST | /profile/email/confirm | 校验验证码并绑定邮箱 `{ email, code }` |
| DELETE | /account/:username | 删除该账号及其全部数据，返回 `{ ok, accounts }` |

关于账号：

- 账号名 3–40 位，只允许字母、数字与 `._-`；密码至少 8 位。密码用 scrypt 加随机盐哈希保存。
- 登录校验失败时也会执行一次哈希运算，避免通过响应时间判断账号是否存在。
- 会话令牌 32 字节随机数，Cookie 为 HttpOnly + SameSite=Strict，有效期 7 天；数据库只存令牌的 SHA-256。
- `/auth/setup` 在已有账号时仍可用，就是「注册新账号」。

关于验证码（找回密码与绑定邮箱共用一套机制）：

- 验证码为 6 位数字，**5 分钟有效**，最多尝试 **5 次**；数据库里只存 SHA-256 哈希，不存明文。
- **发信冷却**：同一目标（IP + 账号标识）**60 秒内只发一封**，**每小时最多 10 封**，超出返回 `429`「发送过于频繁，请 N 秒后再试。」（`N` 为服务端算出的剩余秒数）。
  - 冷却按目标区分：换账号、换 IP、换绑定目标各自独立。
  - `/auth/reset/request` 的冷却判断在查账号**之前**，不存在的账号同样占用名额，因此不会通过「是否 429」暴露账号是否存在。
  - 被拦下的请求不占用名额；冷却记录只在内存，进程重启即清空。
  - 前端会同步显示倒计时，但它只是镜像，拦截始终以服务端为准。
- `/auth/reset/request` 在账号不存在、未绑定邮箱或未配置邮件服务时，**仍返回成功提示**，用于防止账号枚举。检查要点是看 `hint` 文案而非状态码。
- 未配置 SMTP 时会直接返回 503「发件邮箱尚未配置」，这属于服务端配置问题，不是账号问题。
- 重置密码成功后会**注销该账号的所有会话**，需用新密码重新登录。
- 一个邮箱只能绑定一个账号，被占用时返回 409。
- **删除账号不可恢复**：会一并清除该账号的会话、记录、任务、设置、日志、待处理请求与已上传的资源文件，随后重新登录。属于同一账号的登录会话会全部失效。

## 记录

写作、会议、项目、文档、知识库、资源库六类内容共用一张 `entries` 表，用 `kind` 区分。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | /entries?kind= | 列表，按修改时间倒序；不传 kind 返回全部 |
| GET | /entries/:id | 单条记录 |
| POST | /entries/:kind | 新建 `{ title, data }` |
| PUT | /entries/:id | 修改 `{ title, data }` |
| DELETE | /entries/:id | 删除；删除项目时连带删除其任务，删除资源时连带删除磁盘文件 |

`data` 中的字段：

- 写作：`mode`（compose / polish / summary）、`input`、`output`
- 会议：`date`、`source`、`summary`、`todos`
- 项目：`description`
- 文档：`source`、`notes`
- 知识库：`source`、`keywords`
- 资源库：`filename`、`storedName`（磁盘上的唯一文件名，前端只读）、`ext`、`size`、`category`、`downloads`、`notes`

标题最多 120 字，其他文本字段最多 50,000 字，知识库关键词最多 500 字。

> 前端的两处「跨模块搬运」都直接复用这套接口，没有单独的后端入口：写作 / 问答结果存入知识库走 `POST /entries/knowledge`，会议待办转项目任务走下面的批量任务接口。

## 资源库

文件本体存在 `data/files/`，`entries` 表里只存元信息（`kind = resources`）。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | /resources/upload | `multipart/form-data`，字段 `file`（必填）、`title?`、`category?`。普通文件返回 `201` 与资源记录；`.zip` 返回 `{ entries, extracted, skipped, truncated }` |
| GET | /resources/:id/download | 以原始文件名下载，下载次数 +1 |
| GET | /resources/:id/preview | 在线预览，返回 `{ type, html }` / `{ type, sheets }` / `{ type, text }` |
| GET | /resources/:id/text | 提取文件正文，返回 `{ title, filename, text }`；供知识库、文档分析「从资源库选」使用 |
| POST | /resources/:id/analyze | 抽取正文交给模型分析，返回概述 / 要点 / 建议 |

关于资源库：

- 可上传：`.docx` `.xlsx` `.txt` `.md` `.markdown` `.csv` `.pdf` `.pptx` `.png` `.jpg` `.jpeg` `.gif`；单文件上限 **50 MB**，超出返回 `413`。
- **在线预览只支持** `.docx`（转 HTML）、`.xlsx`（转二维表）、`.txt` / `.md` / `.markdown` / `.csv`（纯文本）。PDF、PPTX 与图片返回 `400`，需要下载后查看。
- 预览返回的三种结构：`{ type: "html", html }`、`{ type: "sheets", sheets }`、`{ type: "text", text }`，渲染在前端完成。
- `/resources/:id/text` 只提取正文、不落盘、不改动资源本身；**PDF 与图片没有可用解析器**，返回 `400`「该格式不支持提取正文」，需要下载后查看。
- AI 分析会先把文件解析成纯文本，超过 **20,000 字符只取前两万**；解析不出文本（例如扫描件 PDF）返回 `400`。
- 下载计数只更新 `data.downloads`，不写操作日志，避免一次下载刷出一条记录。
- **压缩包**：`.zip` 会存为一条资源（原件可随时下载），同时把里面每个文件各存为一条资源（共用上传时填的分类）。目录、隐藏文件、`__MACOSX` 与不支持的格式会被跳过；单次最多 50 个文件、解压后合计不超过 200 MB，超出时 `truncated` 为 `true`。一个可用文件都没有时仍返回 `201`、`extracted` 为 `0`，原件照样保留。
- 删除资源记录时，后端会同步删除磁盘文件，不留孤儿文件。

## 项目任务

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | /projects/:projectId/tasks | 任务列表 |
| POST | /projects/:projectId/tasks | 新建 `{ title, status }`，status 为 todo / doing / done |
| PUT | /projects/:projectId/tasks/:id | 修改任务 |
| DELETE | /projects/:projectId/tasks/:id | 删除任务 |
| POST | /projects/:projectId/tasks/batch | 批量加入 `{ requestId, tasks: [{ title }] }`，最多 20 条 |

批量接口用 `requestId` 防止重复提交：同一个 requestId 再次提交相同内容时返回上次的结果（状态码 200），内容不同则返回 409。被回溯撤销过的批次不会假装还在，会提示重新生成草稿。

项目不存在或不属于当前账号时返回 404。

## 设置

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | /settings | 返回 `{ baseUrl, model, hasKey }`，不返回密钥本身 |
| PUT | /settings | 保存 `{ baseUrl, model, key?, clearKey? }`；key 留空表示沿用当前密钥 |
| DELETE | /settings/key | 清除密钥 |
| GET | /settings/smtp | 读取邮件服务配置（见下） |
| PUT | /settings/smtp | 保存邮件服务配置（见下） |

- API 地址必须是 HTTPS（本机地址可以用 HTTP），不允许带账号、查询参数或片段。
- API 地址与模型名称**按账号保存**（`settings` 表以 `accountId` 为主键）。
- API Key **全局共享且只存在服务进程内存里**，不写数据库、日志或浏览器；重启后需重新填写。AI 请求进行中不允许修改设置。

### 邮件服务（SMTP）

`GET /settings/smtp` 返回：

```json
{
  "host": "smtp.qq.com",
  "port": 465,
  "secure": true,
  "user": "you@qq.com",
  "fromName": "AI 办公助手",
  "configured": true,
  "managedByEnv": false
}
```

- **接口从不返回授权码本身**，只返回 `configured` 布尔值表示是否已配置。
- `managedByEnv` 为 `true` 表示当前由环境变量接管（见下），此时前端应把表单改为只读。
- `PUT /settings/smtp` 接收 `{ host, port, secure, user, fromName?, pass?, clearPass? }`：
  - `pass` 留空表示沿用原值；`clearPass: true` 才清空授权码。
  - 填写的授权码会用 **AES-256-GCM 加密**后写入 `app_config` 表，解密密钥在数据库同目录的 `.mail-key` 文件中。

**环境变量方式**（优先级高于数据库）：同时提供 `SMTP_HOST` 与 `SMTP_USER` 即视为启用，可配合 `SMTP_PORT`、`SMTP_SECURE`、`SMTP_PASS`、`SMTP_FROM_NAME`。这种方式下授权码**完全不写入数据库**。未显式指定 `SMTP_SECURE` 时按「端口 465 走 SSL，其余走 STARTTLS」推断。配置项与说明见 `.env.example`。

## AI

| 方法 | 路径 | 请求 | 返回 |
| --- | --- | --- | --- |
| POST | /ai/test | 无 | `{ ok: true }` |
| POST | /ai/generate | `{ mode, input }` | `{ output }` |
| POST | /ai/meetings | `{ title, source }` | `{ summary, todos[] }` |
| POST | /ai/projects | `{ title, description }` | `{ tasks: [{ title }] }` |
| POST | /ai/documents | `{ title, source }` | `{ overview, keyPoints[], actions[] }` |
| POST | /ai/mindmap | `{ title, source }` | `{ title, root }`，`root` 为递归树 |
| POST | /ai/knowledge | `{ question }` | `{ answer, sources[] }` |
| POST | /ai/chat | `{ messages: [{ role, content }] }` | `{ answer }` |

- 输入原文最多 20,000 字，超出时返回 400，不会自动截断。
- 同一时间只处理一个 AI 请求（全局互斥），重复提交返回 409；请求进行中不能修改设置。
- 超时时间 60 秒，失败不自动重试。
- 会议、项目、文档、**工程导图**四个接口要求模型返回 JSON，格式不符合时返回 502。
- 这些接口只返回草稿，不会写入数据库，由前端确认后再调用保存接口。
- `/ai/chat` 的 messages 由 user / assistant 交替组成、以 user 结尾，最多 39 条、单条 20,000 字、合计 40,000 字；不接受 system 角色，服务端不保存对话。
- 写作、知识库、问答要求模型输出纯文本；会议、项目、文档、工程导图要求输出 JSON。

### 工程导图的返回结构

`POST /ai/mindmap` 返回一棵递归树，每个节点是 `{ text, children }`，`text` 最多 120 字，`children` 最多 12 个，层级不限：

```json
{
  "title": "差旅费报销办法",
  "root": {
    "text": "差旅费报销",
    "children": [
      { "text": "交通费", "children": [{ "text": "450 元上限", "children": [] }] },
      { "text": "住宿费", "children": [] }
    ]
  }
}
```

接口只负责产出结构；布局与渲染都在前端完成（`src/lib/mindmap.ts`），因此导出 PNG / SVG / Markdown 与页面展示完全一致。

## 知识库检索

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | /knowledge/search?q= | 按标签、标题、正文匹配打分，中文额外按两字一组匹配，最多返回 5 条及原文片段 |
| POST | /knowledge/parse | `multipart/form-data`，字段 `file`，把 Word / Excel / 文本解析成纯文本返回 |

关于知识库检索：

- 这是**关键词检索，不是向量语义检索**。
- `POST /ai/knowledge` 会先做同样的检索，没有命中时直接返回 404，不调用模型。
- `/knowledge/parse` **不落盘、不入库**，只把解析结果交给前端填进「原始资料」输入框——知识库只存正文，不保存文件本体。

> 前端的「全局搜索」页不走这个接口，而是拉取 `GET /entries` 在前端做跨模块匹配；`/knowledge/search` 专门服务于知识库问答的打分检索。

## 操作日志

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | /history | 日志列表，最新在前（仅当前账号） |
| POST | /history/:id/restore | 撤销该次操作 |

每次写操作都在一个事务里执行，并记录变更前后的数据。撤销时如果相关数据之后又被修改过，会返回 409，需要先撤销较新的操作。
