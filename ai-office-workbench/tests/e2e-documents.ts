// 端到端测试：文档分析的 AI 流程（生成草稿 → 编辑 → 应用到分析笔记 → 保存）。
// 使用临时数据库和本地模拟的模型服务。

import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:http";
import { chromium } from "playwright";
import { createApp } from "../server/app.js";
import { createStore } from "../server/db.js";

const dir = mkdtempSync(join(tmpdir(), "office-documents-browser-"));
const outDir = resolve("test-results");
mkdirSync(outDir, { recursive: true });

const store = createStore(join(dir, "test.sqlite"));

let providerStatus = 200;

const answer = JSON.stringify({
  overview: "【测试】文档说明了四模块框架与交付节奏。",
  keyPoints: ["【测试】框架已搭建", "【测试】功能待完善"],
  actions: ["【测试】收集反馈", "【测试】安排验收"],
});

const provider = createServer(async (req, res) => {
  for await (const _ of req) {
  }
  await new Promise((r) => setTimeout(r, 250));
  res.writeHead(providerStatus, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify(
      providerStatus === 200
        ? { choices: [{ message: { content: answer } }] }
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

const page = await (
  await browser.newContext({ viewport: { width: 1440, height: 1000 } })
).newPage();

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

const checks: string[] = [];
try {
  await page.goto(base);
  await page.getByLabel("账号", { exact: true }).fill("documents");
  await page.getByLabel("密码", { exact: true }).fill("DocumentsPassword123");
  await page.getByRole("button", { name: "创建并进入", exact: true }).click();
  await page.getByText("这里还没有记录").waitFor();
  await nav("设置");
  await page.getByLabel("API 地址", { exact: true }).fill(providerBase);
  await page.getByLabel("模型名称", { exact: true }).fill("mock-model");
  await page.getByLabel("API Key", { exact: true }).fill("ISOLATED_TEST_KEY");
  await page.getByRole("button", { name: "保存并测试连接" }).click();
  await page.getByRole("status").filter({ hasText: "连接成功" }).waitFor();
  checks.push("配置模型并测试连接");
  await nav("文档分析");
  await page.getByLabel("标题", { exact: true }).fill("功能说明");
  await page
    .getByLabel("原文预览与编辑", { exact: true })
    .fill("本文介绍办公助手的四个模块与当前交付节奏。");
  await page.getByRole("button", { name: "生成分析草稿", exact: true }).click();
  const generating = page.getByRole("button", {
    name: "正在分析，请稍候…",
    exact: true,
  });
  await generating.waitFor();
  assert.equal(await generating.isDisabled(), true);
  assert.equal(await page.getByRole("button", { name: "保存", exact: true }).isDisabled(), true);
  await page.getByRole("status").filter({ hasText: "分析草稿已生成" }).waitFor();
  assert.equal(await page.getByLabel("分析笔记", { exact: true }).inputValue(), "");
  assert.equal(store.history().length, 0);
  await page
    .getByLabel("草稿 · 概述", { exact: true })
    .fill("【测试】文档说明了四模块框架。（已人工核对）");
  await page.screenshot({
    path: join(outDir, "documents-ai-draft.png"),
    fullPage: true,
  });
  checks.push("生成草稿、忙碌禁用保存、笔记未被覆盖、不写库");
  await page.getByRole("button", { name: "应用到分析笔记", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "已应用草稿" }).waitFor();
  const expected = [
    "【概述】",
    "【测试】文档说明了四模块框架。（已人工核对）",
    "",
    "【关键要点】",
    "1. 【测试】框架已搭建",
    "2. 【测试】功能待完善",
    "",
    "【建议行动】",
    "1. 【测试】收集反馈",
    "2. 【测试】安排验收",
  ].join("\n");
  assert.equal(await page.getByLabel("分析笔记", { exact: true }).inputValue(), expected);
  assert.equal(store.history().length, 0);
  await save();
  assert.equal(store.history().length, 1);
  checks.push("编辑草稿后应用，小标题拼接进笔记，保存产生一条日志");
  await page.getByRole("button", { name: "生成分析草稿", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "分析草稿已生成" }).waitFor();
  await page.getByRole("button", { name: "放弃草稿", exact: true }).click();
  assert.equal(await page.getByLabel("分析笔记", { exact: true }).inputValue(), expected);
  checks.push("放弃草稿不改变笔记");
  await page.getByRole("button", { name: "生成分析草稿", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "分析草稿已生成" }).waitFor();
  await page.getByRole("button", { name: "应用到分析笔记", exact: true }).click();
  await confirm();
  assert.equal(
    await page.getByLabel("分析笔记", { exact: true }).inputValue(),
    [
      "【概述】",
      "【测试】文档说明了四模块框架与交付节奏。",
      "",
      "【关键要点】",
      "1. 【测试】框架已搭建",
      "2. 【测试】功能待完善",
      "",
      "【建议行动】",
      "1. 【测试】收集反馈",
      "2. 【测试】安排验收",
    ].join("\n"),
  );
  assert.equal(store.history().length, 1);
  await save();
  assert.equal(store.history().length, 2);
  checks.push("已有笔记时应用需确认，替换后保存产生第二条日志");
  providerStatus = 401;
  await page.getByRole("button", { name: "生成分析草稿", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "API Key 无效" }).waitFor();
  assert.equal(
    await page.getByLabel("原文预览与编辑", { exact: true }).inputValue(),
    "本文介绍办公助手的四个模块与当前交付节奏。",
  );
  assert.equal(store.history().length, 2);
  providerStatus = 200;
  checks.push("401 失败保留原文与笔记，不产生日志");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(100);
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    "documents mobile overflow",
  );
  await page.screenshot({
    path: join(outDir, "documents-ai-mobile.png"),
    fullPage: true,
  });
  checks.push("390px 手机无水平溢出");
  assert.deepEqual(errors, []);
  writeFileSync(
    join(outDir, "e2e-documents.json"),
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
