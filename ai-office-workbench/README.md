# AI 办公助手

一个在本机运行的个人办公工作台，把写作、会议纪要、项目管理、文档分析、知识库和 AI 问答放在同一个界面里。

- **数据在自己的电脑上**：全部记录保存在本地 SQLite 文件，不需要注册账号、不联网也能用。
- **AI 用自己的服务**：通过 OpenAI 兼容的 Chat Completions 接口接入，可以换成任意支持该协议的模型（云端服务或本机 Ollama 都可以）。
- **AI 结果先出草稿**：模型生成的内容都先显示为可编辑草稿，确认后才写入记录，不会直接覆盖已有内容。
- **多账号互不干扰**：同一台机器可以建多个账号，各自的数据完全隔离。

团队：**李庚言**（技术实现、UI 优化）、**胡佳乐**（UI 设计与优化）、**李思怡**（测试、撰写使用说明）；后期维护由三人共同承担。

当前版本 `0.4.3`，改动记录见 [`docs/更新说明.md`](./docs/更新说明.md)。

## 功能

| 模块 | 说明 |
| --- | --- |
| 工作台 | 概览、最近记录、快捷入口 |
| 全局搜索 | 一个入口跨写作 / 会议 / 项目 / 文档 / 知识库检索全部记录，显示命中片段，点击直达 |
| AI 问答 | 独立提问、连续追问（最多 20 轮），可复制、导出 TXT、整段存入知识库 |
| AI 写作 | 撰写、润色、摘要三种模式，结果可编辑、复制、导出 TXT、存入知识库 |
| 会议纪要 | AI 生成「重点与结论 + 待办事项」草稿；待办可一键转为项目任务 |
| 项目管理 | 项目说明 + 任务看板（待开始 / 进行中 / 已完成），AI 拆解任务后可勾选批量加入 |
| 文档分析 | 导入 TXT / Markdown，AI 生成概述、关键要点与建议行动；可生成**工程导图**并导出 PNG / SVG / Markdown 大纲 |
| 知识库 | 保存资料和标签，关键词检索；从资源库取正文导入；AI 基于资料作答并标注来源 |
| 资源库 | 上传 Word / Excel / PDF / 文本 / 图片，支持 .zip 自动解压成多条；在线预览（Word 转 HTML、Excel 转表格）、下载、AI 快速分析内容 |
| 操作日志 | 记录每次新增、修改、删除，可查看前后对比并回溯 |
| 时钟与计时 | 倒计时与秒表 |
| 个人资料 | 昵称、角色、简介；绑定邮箱（验证码校验） |
| 账号 | 多账号注册与切换、邮箱验证码找回密码 |
| 外观 | 日夜主题切换（自底部向上揭幕过渡）、背景气泡（可点击点破、分裂并溅出水雾）、鱼群背景（五色各成一群，就近牵引、可游出画面）、场景轮播、动效总开关 |
| 设置 | AI 连接配置、邮件服务（SMTP）配置 |

AI 生成的内容都先作为草稿显示，用户确认后才会写入记录，不会直接覆盖已有内容。

## 技术栈

| 层次 | 选型 |
| --- | --- |
| 前端 | React 19、TypeScript、Vite 6、Tailwind CSS 4 |
| 后端 | Node.js 22.5+（推荐 24 LTS）、Express 5、Zod（参数校验） |
| 数据库 | Node.js 内置的 `node:sqlite`，不需要额外安装数据库服务 |
| 邮件 | nodemailer（Node 内置 `node:smtp` 尚不成熟） |
| 测试 | `node:test` 单元测试（58 组）、Playwright 端到端测试（5 组） |
| 界面动效 | 原生 Canvas、View Transitions API、CSS 遮罩动画，无额外动画库 |
| 导图渲染 | 手写 SVG，未引入图表库 |
| 凭据保护 | Node.js 内置 `node:crypto`（scrypt、AES-256-GCM、SHA-256） |

## 运行

需要 Node.js 22.5 或更高版本（`node:sqlite` 自 22.5 引入；22.x 会自动加 `--experimental-sqlite` 启动，推荐 24 LTS）。完整的安装、多账号、邮件配置、备份、升级和常见问题见 [`docs/安装与使用.md`](./docs/安装与使用.md)。

```sh
npm ci
npm run build
npm start
```

启动后打开 http://127.0.0.1:4318 ，第一次进入会让你创建账号。按 Ctrl+C 停止服务。

开发时用 `npm run dev`，前端地址是 http://127.0.0.1:5178 ，修改代码会自动刷新。

服务只监听 127.0.0.1，局域网内的其他设备无法访问。

## 配置 AI

进入「设置」页，填写：

| 项目 | 说明 |
| --- | --- |
| API 地址 | 服务商提供的基础地址，一般以 `/v1` 结尾，例如 `https://api.openai.com/v1`（不要带 `/chat/completions`） |
| 模型名称 | 服务商给出的模型 ID |
| API Key | 服务商后台申请的密钥 |

点「保存并测试连接」会发一条很短的请求确认配置可用。

API Key 只保存在后端进程的内存里，不写入数据库、日志或浏览器，**每次重启服务后需要重新填写**；API 地址和模型名称按账号保存。没有配置 AI 时，各模块的手动记录功能照常可用。

## 配置邮件（可选）

「找回密码」与「绑定邮箱」需要发验证码邮件。两种方式任选其一：

1. **在网页里配置**（设置 → 邮件服务）：授权码会用 **AES-256-GCM 加密**后存入本机数据库，解密密钥单独放在 `data/.mail-key`。
2. **用环境变量**（推荐，授权码完全不落库）：

```sh
SMTP_HOST=smtp.qq.com SMTP_PORT=465 SMTP_USER=you@qq.com SMTP_PASS=你的授权码 npm start
```

同时提供 `SMTP_HOST` 与 `SMTP_USER` 即视为启用，此时环境变量优先，设置页对应表单变为只读。完整变量列表见 `.env.example`。

不配置邮件服务也不影响其它功能，只是无法自助找回密码。

## 演示模式

```sh
npm run build:preview
```

生成的 `dist-preview/` 是纯静态页面，可以直接放到任意静态服务器上。演示模式不需要后端：数据保存在访客自己浏览器的 localStorage 里（按账号分区），自带几条示例数据，AI 与邮件功能不可用。适合在没有后端环境时展示界面和操作流程。

## 分享与分发

**不要把整个项目文件夹打包发给别人**——`node_modules/` 单独就有约 169 MB，而且 `data/` 里有你的账号与加密后的邮件授权码。

只发源码包（约 4.46 MB / 121 个文件）：

```sh
npm run pack:share
```

生成的 `dist-share/ai-office-workbench-<版本>-源码-<日期>.zip` 会自动排除：

| 排除项 | 原因 |
| --- | --- |
| `node_modules/` | 对方执行 `npm ci` 自行安装 |
| `dist/`、`dist-preview/` | 构建产物，重新构建即可 |
| `data/`、`.mail-key` | **本机数据库与密钥文件，含你的账号与邮件授权码** |
| `.workbuddy/` | 本地会话记忆与改动备份，含个人路径 |
| `.idea/`、`.vscode/` | 编辑器配置 |
| `.env`、`*sqlite*`、`*.log` | 本地配置、数据与日志 |
| `test-results/` | 测试截图 |

打包前脚本会自动扫一遍待打包的文本文件：**发现授权码明文、AES 密文、私钥或 API Key 就直接中止，不生成压缩包**；测试代码里的假密钥、文档里的占位邮箱只做提示。跑完会打印扫描结论。

对方拿到压缩包后的步骤：

```sh
# 解压后进入目录
npm ci
npm run build
npm start
```

首次打开会让他创建自己的账号，与你本机的数据完全无关。

## 目录结构

```
server/                    后端（Express，只监听 127.0.0.1）
  index.ts                 启动入口：Node 版本检查、打开数据库、监听端口
  app.ts                   应用装配：安全中间件、鉴权、挂载各路由、静态托管、错误兜底
  context.ts               路由之间共享的运行时依赖（store / 文件存储 / 模型调用）
  schemas.ts               请求体的 zod 校验规则（记录、任务、设置、SMTP）
  hosts.ts                 本机 Host 白名单与同源判断
  routers/                 按领域拆分的路由
    history.ts             操作日志查看与撤销
    settings.ts            模型连接设置与 SMTP 发件配置
    ai.ts                  八个 AI 入口
    knowledge.ts           知识库检索与文件解析
    entries.ts             六类记录的增删改查
    resources.ts           资源库上传 / 下载 / 预览 / 分析
    tasks.ts               项目任务
  auth.ts                  多账号、注册登录、会话、找回密码、邮箱绑定、个人资料
  db.ts                    SQLite 建表、读写、事务与操作日志、回溯、旧库迁移
  ai.ts                    调用模型接口、超时与错误转换、写作 / 知识库 / 问答提示词
  office-prompts.ts        会议 / 项目 / 文档 / 工程导图四个模块的提示词
  files.ts                 资源库文件存储与解析（docx/xlsx 转文本或表格）
  mail.ts                  nodemailer 发信封装与 SmtpConfig 类型
  smtp.ts                  SMTP 配置解析与保存（环境变量优先、入库加密、脱敏视图）
  secrets.ts               AES-256-GCM 加解密与密钥文件管理
shared/                    前后端共用
  types.ts                 数据类型（按模块拆分，Entry 是判别联合）
  constants.ts             账号、验证码、发信冷却、内容长度、上传上限等规则常量
  ai-schemas.ts            AI 请求与返回的 JSON 结构校验（含递归导图结构）
  chat.ts                  问答的对话格式校验
  audit.ts                 操作日志的差异计算与回溯
  knowledge.ts             知识库关键词检索
  timer.ts                 计时器计算
src/                       前端
  main.tsx                 挂载入口
  App.tsx                  页面框架、导航、未保存离开确认
  config.ts                站点名称、导航菜单
  style.css                样式入口，按顺序 @import 下面 styles/ 的各段
  styles/                  拆分后的样式
    base.css               基础样式与字体
    tokens.css             主题色变量（Tailwind @theme）
    layout.css             左侧栏 / 页头 / 主区布局
    components.css         卡片、表单、按钮、登录页与各模块样式
    responsive.css         媒体查询
    theme-light.css        日间主题
    effects.css            动效：轮播、页面过渡、按钮光效
    decoration.css         流光边框、三个试验块、主题揭幕、字段高亮
  modules/                 各功能页面，每个模块一个文件
  components/
    ui.tsx                 按钮、空状态、提示、确认框等基础组件
    Workspace.tsx          列表 + 编辑表单的通用骨架
    ResourcePicker.tsx     从资源库挑文件并取正文（知识库 / 文档分析共用）
    BubbleBackground/      背景气泡特效（Canvas，深海气泡款式：渐变+高光，向上漂浮；点击点破、分裂、溅水雾）
    FishBackground/        鱼群背景特效（Canvas，五色鱼群各自成群、动态头鱼、允许游出画面）
    SceneCarousel.tsx      场景背景轮播
    LightFrame.tsx         卡片边缘流光装饰
    Mindmap.tsx            工程导图 SVG 渲染层
    Motion.tsx             动效总开关
    ThemeToggle.tsx        日夜主题切换按钮
  lib/
    api.ts                 接口请求
    editor.tsx             「列表 + 编辑表单」通用状态
    preview.ts             演示模式下的本地存储模拟接口
    mindmap.ts             导图布局引擎（纯函数，展示与导出共用）
    themeTransition.ts     主题切换的向上揭幕过渡
    useBusy.ts             异步操作期间的忙碌状态
    useCanvasEffect.ts     背景特效的挂载骨架（主题 / 动效 / 揭幕 / 销毁），气泡与鱼群共用
    format.ts              文件大小的统一格式化
    runtime.ts             运行环境标记
public/                    静态资源（主题预加载脚本、场景图片）
scripts/                   打包脚本（生成可分发的源码包）
tests/                     单元测试与端到端测试
docs/                      交付说明、安装使用、系统设计、接口、案例与验收清单
```

## 数据与备份

数据库文件在 `data/workbench.sqlite`，首次启动时自动创建；SMTP 授权码的加密密钥在 `data/.mail-key`。备份时先停止服务，再复制**整个 `data` 目录**（两个文件要在一起，否则恢复后需重填授权码）。

可以用环境变量修改端口和数据库位置，见 `.env.example`。

## 测试

```sh
npm test          # 58 组单元测试
npm run check     # 单元测试 + 类型检查 + 构建
npm run test:e2e  # 5 组端到端测试，需要安装 Google Chrome
```

测试使用临时数据库和本地模拟的模型服务，不会调用真实 AI、不会真的发邮件，也不会改动 `data/` 里的数据。端到端测试的截图保存在 `test-results/`。

## 文档

| 文档 | 内容 |
| --- | --- |
| [`docs/交付说明.md`](./docs/交付说明.md) | 交付内容、运行环境、功能范围、当前验收状态 |
| [`docs/安装与使用.md`](./docs/安装与使用.md) | 安装、多账号、模型与邮件配置、模块操作、备份恢复、升级、常见问题 |
| [`docs/系统设计.md`](./docs/系统设计.md) | 架构、模块关系、数据库、多账号隔离与迁移、请求流程、界面动效、导图布局、认证与安全 |
| [`docs/API.md`](./docs/API.md) | 全部接口说明 |
| [`docs/演示案例.md`](./docs/演示案例.md) | 七个 AI 入口的演示案例与检查要点 |
| [`docs/验收清单.md`](./docs/验收清单.md) | 逐项验收表与已知限制 |
| [`docs/更新说明.md`](./docs/更新说明.md) | 版本更新日志与升级方法 |
