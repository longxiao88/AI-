// 端到端测试：项目的 AI 任务拆解流程（生成草稿 → 勾选 → 批量加入）。
// 使用临时数据库和本地模拟的模型服务。

import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:http";
import { chromium } from "playwright";
import { createApp } from "../server/app.js";
import { createStore } from "../server/db.js";

const dir = mkdtempSync(join(tmpdir(), "office-projects-browser-"));
const outDir = resolve("test-results");
mkdirSync(outDir, { recursive: true });

const store = createStore(join(dir, "test.sqlite"));

let providerStatus = 200;

const answer = JSON.stringify({
  tasks: [
    { title: "【测试】梳理需求" },
    { title: "【测试】搭建页面" },
    { title: "【测试】编写测试" },
  ],
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

const save = async () => {
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "已保存到本机" }).waitFor();
};

const checks: string[] = [];
try {
  await page.goto(base);
  await page.getByLabel("账号", { exact: true }).fill("projects");
  await page.getByLabel("密码", { exact: true }).fill("ProjectsPassword123");
  await page.getByRole("button", { name: "创建并进入", exact: true }).click();
  await page.getByText("这里还没有记录").waitFor();
  await nav("设置");
  await page.getByLabel("API 地址", { exact: true }).fill(providerBase);
  await page.getByLabel("模型名称", { exact: true }).fill("mock-model");
  await page.getByLabel("API Key", { exact: true }).fill("ISOLATED_TEST_KEY");
  await page.getByRole("button", { name: "保存并测试连接" }).click();
  await page.getByRole("status").filter({ hasText: "连接成功" }).waitFor();
  checks.push("配置模型并测试连接");
  await nav("项目管理");
  await page.getByLabel("标题", { exact: true }).fill("网站重构");
  await page.getByLabel("项目说明", { exact: true }).fill("把现有页面拆成可独立交付的模块。");
  await page.getByRole("button", { name: "生成任务草稿", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "请先保存项目" }).waitFor();
  checks.push("项目未保存时提示先保存");
  await save();
  const logsBefore = store.history("projects").length;
  await page.getByRole("button", { name: "生成任务草稿", exact: true }).click();
  const generating = page.getByRole("button", {
    name: "正在生成草稿，请稍候…",
    exact: true,
  });
  await generating.waitFor();
  assert.equal(await generating.isDisabled(), true);
  assert.equal(await page.getByRole("button", { name: "保存", exact: true }).isDisabled(), true);
  await page.getByRole("status").filter({ hasText: "任务草稿已生成" }).waitFor();
  assert.equal(store.history("projects").length, logsBefore);
  await page.screenshot({
    path: join(outDir, "projects-ai-draft.png"),
    fullPage: true,
  });
  checks.push("生成草稿、忙碌禁用保存、不写库不加日志");
  await page.getByLabel("选择草稿 3", { exact: true }).uncheck();
  await page.getByLabel("草稿任务 1", { exact: true }).fill("【测试】梳理需求（已确认）");
  await page.getByLabel("新任务", { exact: true }).fill("尚未保存的手动任务");
  await page.getByRole("button", { name: /确认加入所选（2）/ }).click();
  await page.getByRole("alert").filter({ hasText: "请先保存或取消正在编辑的任务" }).waitFor();
  assert.equal(await page.getByLabel("新任务", { exact: true }).inputValue(), "尚未保存的手动任务");
  assert.equal(store.history("projects").length, logsBefore);
  await page.getByLabel("新任务", { exact: true }).fill("");
  checks.push("手动任务未保存时阻止加入草稿，保留输入且不写库");
  await page.getByRole("button", { name: /确认加入所选（2）/ }).click();
  await page.getByRole("status").filter({ hasText: "已加入 2 条任务" }).waitFor();
  await page.getByText("【测试】梳理需求（已确认）").waitFor();
  await page.getByText("【测试】搭建页面").waitFor();
  assert.equal(await page.getByText("【测试】编写测试").count(), 0);
  assert.equal(store.history("projects").length, logsBefore + 1);
  assert.equal(store.tasks("projects", store.list("projects", "projects")[0].id).length, 2);
  checks.push("编辑草稿、取消勾选、确认加入两条、产生一条日志");
  await page.getByRole("button", { name: "生成任务草稿", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "任务草稿已生成" }).waitFor();
  await page.getByRole("button", { name: "放弃草稿", exact: true }).click();
  assert.equal(await page.getByText("AI 任务草稿（未加入）").count(), 0);
  assert.equal(store.tasks("projects", store.list("projects", "projects")[0].id).length, 2);
  checks.push("放弃草稿不改变任务列表");
  providerStatus = 401;
  await page.getByRole("button", { name: "生成任务草稿", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "API Key 无效" }).waitFor();
  assert.equal(
    await page.getByLabel("项目说明", { exact: true }).inputValue(),
    "把现有页面拆成可独立交付的模块。",
  );
  assert.equal(store.history("projects").length, logsBefore + 1);
  providerStatus = 200;
  checks.push("401 失败保留说明与任务，不产生日志");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(100);
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    "projects mobile overflow",
  );
  await page.screenshot({
    path: join(outDir, "projects-ai-mobile.png"),
    fullPage: true,
  });
  checks.push("390px 手机无水平溢出");
  assert.deepEqual(errors, []);
  writeFileSync(
    join(outDir, "e2e-projects.json"),
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
