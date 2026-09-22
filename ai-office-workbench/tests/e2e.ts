// 端到端测试：登录、四个模块的增删改、写作 AI、手机布局。
// 使用临时数据库和本地模拟的模型服务，不会调用真实 AI，也不会动 data/ 里的数据。
// 需要先 npm run build，并安装 Google Chrome。

import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:http";
import { chromium, type Locator } from "playwright";
import { createApp } from "../server/app.js";
import { createStore } from "../server/db.js";

const dir = mkdtempSync(join(tmpdir(), "office-browser-"));
const outDir = resolve("test-results");
mkdirSync(outDir, { recursive: true });

const store = createStore(join(dir, "test.sqlite"));

let providerStatus = 200;

let requests = 0;

const provider = createServer(async (req, res) => {
  for await (const _ of req) {
  }
  requests++;
  await new Promise((r) => setTimeout(r, 250));
  res.writeHead(providerStatus, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify(
      providerStatus === 200
        ? {
            choices: [
              {
                message: {
                  content: "【测试输出】项目已完成基础页面，下一步验证交互。",
                },
              },
            ],
          }
        : { error: "test error" },
    ),
  );
}).listen(0, "127.0.0.1");
await new Promise<void>((r) => provider.once("listening", r));

const appServer = createApp(store).listen(0, "127.0.0.1");
await new Promise<void>((r) => appServer.once("listening", r));

const base = `http://127.0.0.1:${(appServer.address() as any).port}`;
const providerBase = `http://127.0.0.1:${(provider.address() as any).port}/v1`;
const browser = await chromium.launch({ channel: "chrome", headless: true });

const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  permissions: ["clipboard-read", "clipboard-write"],
  acceptDownloads: true,
});

const page = await context.newPage();
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));

const nav = async (name: string) => {
  await page.getByRole("navigation").getByRole("button", { name, exact: true }).click();
};

const confirm = async () => {
  await page.getByRole("alertdialog").getByRole("button", { name: "确认", exact: true }).click();
};

const save = async () => {
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "已保存到本机" }).waitFor();
};

async function valueIs(locator: Locator, value: string) {
  for (let i = 0; i < 60; i++) {
    if ((await locator.inputValue()) === value) return;
    await page.waitForTimeout(50);
  }
  assert.equal(await locator.inputValue(), value);
}

const checks: string[] = [];
try {
  await page.goto(base);
  await page.getByLabel("账号", { exact: true }).fill("browser");
  await page.getByLabel("密码", { exact: true }).fill("BrowserPassword123");
  await page.getByRole("button", { name: "创建并进入", exact: true }).click();
  await page.getByText("这里还没有记录").waitFor();
  await page.screenshot({
    path: join(outDir, "01-home-desktop.png"),
    fullPage: true,
  });
  checks.push("空工作台：真实空数据、六入口");
  await nav("AI 写作");
  await page.getByLabel("标题", { exact: true }).fill("测试文稿");
  await page.getByLabel("写作要求", { exact: true }).fill("请写一封项目进度邮件");
  await page.getByRole("button", { name: "开始生成", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "模型名称" }).waitFor();
  assert.equal(
    await page.getByLabel("写作要求", { exact: true }).inputValue(),
    "请写一封项目进度邮件",
  );
  await save();
  checks.push("无凭证失败提示、保留输入、保存写作");
  await nav("设置");
  await page.getByLabel("API 地址", { exact: true }).fill(providerBase);
  await page.getByLabel("模型名称", { exact: true }).fill("mock-model");
  await page.getByLabel("API Key", { exact: true }).fill("ISOLATED_TEST_KEY");
  await page.getByRole("button", { name: "保存并测试连接" }).click();
  await page.getByRole("status").filter({ hasText: "连接成功" }).waitFor();
  assert.equal(await page.getByLabel("API Key", { exact: true }).inputValue(), "");
  checks.push("保存设置、测试连接、密钥输入框清空");
  await nav("AI 写作");
  await page.getByRole("button", { name: "测试文稿", exact: false }).click();
  for (const mode of ["compose", "polish", "summary"]) {
    await page.getByLabel("写作模式", { exact: true }).selectOption(mode);
    const count = requests;
    await page.getByRole("button", { name: "开始生成", exact: true }).click();
    if (mode !== "compose") await confirm();
    await page.getByRole("button", { name: "正在生成，请稍候…" }).waitFor();
    assert.equal(await page.getByRole("button", { name: "正在生成，请稍候…" }).isDisabled(), true);
    await page.getByRole("status").filter({ hasText: "生成完成" }).waitFor();
    assert.equal(requests, count + 1);
    await save();
  }
  checks.push("三模式生成、处理中按钮禁用、三次各一个请求");
  await page.getByLabel("结果内容", { exact: true }).fill("这是编辑后的结果");
  await page.getByRole("button", { name: "复制", exact: true }).click();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), "这是编辑后的结果");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出 TXT" }).click();
  const download = await downloadPromise;
  assert.equal(download.suggestedFilename(), "测试文稿.txt");
  await save();
  await page.screenshot({
    path: join(outDir, "02-writing-desktop.png"),
    fullPage: true,
  });
  providerStatus = 401;
  await page.getByRole("button", { name: "开始生成", exact: true }).click();
  await confirm();
  await page.getByRole("alert").filter({ hasText: "API Key 无效" }).waitFor();
  assert.equal(await page.getByLabel("结果内容", { exact: true }).inputValue(), "这是编辑后的结果");
  providerStatus = 200;
  checks.push("编辑、复制、TXT 下载；401 保留输入和结果");
  await nav("会议纪要");
  await page.getByLabel("标题", { exact: true }).fill("需求讨论");
  await page.getByLabel("会议日期", { exact: true }).fill("2026-09-17");
  await page.getByLabel("会议原文", { exact: true }).fill("讨论了四个模块和演示方式。");
  await page.getByLabel("重点与结论", { exact: true }).fill("优先完成写作。");
  await page.getByLabel("待办事项", { exact: true }).fill("核对界面");
  await save();
  await page.getByLabel("重点与结论", { exact: true }).fill("修改后的结论");
  await save();
  await nav("工作台");
  await page.getByRole("button", { name: "需求讨论", exact: false }).click();
  await valueIs(page.getByLabel("重点与结论", { exact: true }), "修改后的结论");
  checks.push("会议新增、修改、首页最近记录重新打开");
  await nav("项目管理");
  await page.getByLabel("标题", { exact: true }).fill("毕业设计演示");
  await page.getByLabel("项目说明", { exact: true }).fill("先完成框架，再补充功能");
  await save();
  await page.getByLabel("新任务", { exact: true }).fill("检查所有页面");
  await page.getByRole("button", { name: "添加任务", exact: true }).click();
  await page.getByRole("button", { name: "编辑任务 检查所有页面", exact: true }).click();
  await page.getByLabel("编辑任务", { exact: true }).fill("核对全部页面");
  await page.getByLabel("任务状态", { exact: true }).selectOption("doing");
  await page.getByRole("button", { name: "保存任务", exact: true }).click();
  await page.getByRole("button", { name: "编辑任务 核对全部页面", exact: true }).waitFor();
  await page.screenshot({
    path: join(outDir, "03-projects-desktop.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "编辑任务 核对全部页面", exact: true }).click();
  await page.getByLabel("任务状态", { exact: true }).selectOption("done");
  await page.getByRole("button", { name: "保存任务", exact: true }).click();
  await page.getByRole("button", { name: "编辑任务 核对全部页面", exact: true }).waitFor();
  await page.getByRole("button", { name: "删除任务 核对全部页面", exact: true }).click();
  await confirm();
  await page
    .getByRole("button", { name: "删除任务 核对全部页面", exact: true })
    .waitFor({ state: "detached" });
  await page.getByLabel("新任务", { exact: true }).fill("用于验证连动删除");
  await page.getByRole("button", { name: "添加任务", exact: true }).click();
  await page.getByRole("button", { name: "编辑任务 用于验证连动删除", exact: true }).waitFor();
  checks.push("项目保存、任务新增改名、三个状态与单任务删除");
  await nav("文档分析");
  await page.getByLabel("导入文本文件", { exact: true }).setInputFiles({
    name: "资料.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("# 演示资料\n四模块框架"),
  });
  await page.getByLabel("分析笔记", { exact: true }).fill("记录主要功能");
  await save();
  assert.equal(
    await page.getByLabel("原文预览与编辑", { exact: true }).inputValue(),
    "# 演示资料\n四模块框架",
  );
  await page.getByLabel("分析笔记", { exact: true }).fill("尚未保存");
  await nav("工作台");
  await page.getByRole("alertdialog").getByRole("button", { name: "取消", exact: true }).click();
  await valueIs(page.getByLabel("分析笔记", { exact: true }), "尚未保存");
  await save();
  checks.push("UTF-8 文件导入、笔记保存、离开取消保留修改");
  await page.getByLabel("导入文本文件", { exact: true }).setInputFiles({
    name: "bad.txt",
    mimeType: "text/plain",
    buffer: Buffer.from([0xff, 0xfe, 0x80]),
  });
  await page.getByRole("alert").filter({ hasText: "UTF-8" }).waitFor();
  checks.push("错误编码导入拒绝且保留原文");
  await page.reload();
  await nav("文档分析");
  await page.locator("aside.panel").getByRole("button", { name: "资料", exact: false }).click();
  await valueIs(page.getByLabel("分析笔记", { exact: true }), "尚未保存");
  checks.push("浏览器刷新后数据恢复");
  await page.setViewportSize({ width: 390, height: 844 });
  for (const name of ["工作台", "AI 写作", "会议纪要", "项目管理", "文档分析", "设置"]) {
    await nav(name);
    await page.waitForTimeout(100);
    assert.ok(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      `${name} horizontal overflow`,
    );
    await page.screenshot({
      path: join(outDir, `mobile-${name}.png`),
      fullPage: true,
    });
  }
  checks.push("390px 手机六页面无水平溢出");
  await nav("设置");
  await page.getByRole("button", { name: "清除密钥", exact: true }).click();
  await confirm();
  await page.getByRole("status").filter({ hasText: "密钥已清除" }).waitFor();
  assert.equal(
    await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage })),
    JSON.stringify({ "ai-office-theme": "dark" }),
  );
  for (const [name, title] of [
    ["AI 写作", "测试文稿"],
    ["会议纪要", "需求讨论"],
    ["文档分析", "资料"],
    ["项目管理", "毕业设计演示"],
  ]) {
    await nav(name);
    await page.locator("aside.panel").getByRole("button", { name: title, exact: false }).click();
    await page.getByRole("button", { name: "删除", exact: true }).click();
    await confirm();
    await page.getByRole("status").filter({ hasText: "记录已删除" }).waitFor();
  }
  assert.equal(store.list().length, 0);
  assert.equal(store.db.prepare("SELECT COUNT(*) as count FROM tasks").get()?.count, 0);
  checks.push("四模块删除、项目任务连动清除；浏览器无密钥存储");
  assert.deepEqual(errors, []);
  writeFileSync(
    join(outDir, "e2e.json"),
    JSON.stringify(
      {
        passed: true,
        checks,
        pageErrors: errors,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ passed: true, checks }, null, 2));
} finally {
  await browser.close();
  await new Promise<void>((r) => appServer.close(() => r()));
  await new Promise<void>((r) => provider.close(() => r()));
  store.db.close();
  rmSync(dir, { recursive: true, force: true });
}
