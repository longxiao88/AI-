# 接口说明

所有接口都在 `/api` 下，请求和返回都是 JSON。出错时返回 `{ "error": "错误说明" }`。

除 `/health` 和 `/auth/*` 外，其余接口都需要先登录（Cookie 会话）。服务只接受来自本机的请求，跨站的写请求会被拒绝。

## 账号

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | /auth/session | 返回是否需要初始化账号，以及当前登录用户 |
| POST | /auth/setup | 首次创建账号 `{ username, password, name? }` |
| POST | /auth/login | 登录 `{ username, password }`，连续失败 10 次锁定 15 分钟 |
| POST | /auth/logout | 退出登录 |
| GET / PUT | /profile | 读取 / 修改个人资料 `{ name, email, role, bio }` |

密码用 scrypt 加盐哈希保存；会话令牌在数据库里只存 SHA-256 哈希，有效期 7 天。

## 记录

写作、会议、项目、文档、知识库五类内容共用一张 `entries` 表，用 `kind` 区分。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | /entries?kind= | 列表，按修改时间倒序；不传 kind 返回全部 |
| GET | /entries/:id | 单条记录 |
| POST | /entries/:kind | 新建 `{ title, data }` |
| PUT | /entries/:id | 修改 `{ title, data }` |
| DELETE | /entries/:id | 删除；删除项目时连带删除其任务 |

`data` 中的字段：

- 写作：`mode`（compose / polish / summary）、`input`、`output`
- 会议：`date`、`source`、`summary`、`todos`
- 项目：`description`
- 文档：`source`、`notes`
- 知识库：`source`、`keywords`

标题最多 120 字，其他文本字段最多 50,000 字。

## 项目任务

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | /projects/:projectId/tasks | 任务列表 |
| POST | /projects/:projectId/tasks | 新建 `{ title, status }`，status 为 todo / doing / done |
| PUT | /projects/:projectId/tasks/:id | 修改任务 |
| DELETE | /projects/:projectId/tasks/:id | 删除任务 |
| POST | /projects/:projectId/tasks/batch | 批量加入 `{ requestId, tasks: [{ title }] }`，最多 20 条 |

批量接口用 `requestId` 防止重复提交：同一个 requestId 再次提交相同内容时返回上次的结果（状态码 200），内容不同则返回 409。

## 设置

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | /settings | 返回 `{ baseUrl, model, hasKey }`，不返回密钥本身 |
| PUT | /settings | 保存 `{ baseUrl, model, key?, clearKey? }`；key 留空表示沿用当前密钥 |
| DELETE | /settings/key | 清除密钥 |

API 地址必须是 HTTPS（本机地址可以用 HTTP）。

## AI

| 方法 | 路径 | 请求 | 返回 |
| --- | --- | --- | --- |
| POST | /ai/test | 无 | `{ ok: true }` |
| POST | /ai/generate | `{ mode, input }` | `{ output }` |
| POST | /ai/meetings | `{ title, source }` | `{ summary, todos[] }` |
| POST | /ai/projects | `{ title, description }` | `{ tasks: [{ title }] }` |
| POST | /ai/documents | `{ title, source }` | `{ overview, keyPoints[], actions[] }` |
| POST | /ai/knowledge | `{ question }` | `{ answer, sources[] }` |
| POST | /ai/chat | `{ messages: [{ role, content }] }` | `{ answer }` |

- 输入原文最多 20,000 字，超出时返回 400，不会自动截断。
- 同一时间只处理一个 AI 请求，重复提交返回 409；请求进行中不能修改设置。
- 超时时间 60 秒，失败不自动重试。
- 会议、项目、文档三个接口要求模型返回 JSON，格式不符合时返回 502。
- 这些接口只返回草稿，不会写入数据库，由前端确认后再调用保存接口。
- `/ai/chat` 的 messages 由 user / assistant 交替组成、以 user 结尾，最多 39 条、单条 20,000 字、合计 40,000 字；不接受 system 角色，服务端不保存对话。
- 写作、知识库、问答要求模型输出纯文本；会议、项目、文档要求输出 JSON。

## 知识库检索

`GET /knowledge/search?q=关键词`：按标签、标题、正文匹配打分，中文额外按两字一组匹配，最多返回 5 条及原文片段。这是关键词检索，不是向量语义检索。

`POST /ai/knowledge` 会先做同样的检索，没有命中时直接返回 404，不调用模型。

## 操作日志

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | /history | 日志列表，最新在前 |
| POST | /history/:id/restore | 撤销该次操作 |

每次写操作都在一个事务里执行，并记录变更前后的数据。撤销时如果相关数据之后又被修改过，会返回 409，需要先撤销较新的操作。
