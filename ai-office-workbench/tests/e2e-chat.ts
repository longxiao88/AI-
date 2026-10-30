import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:http";
import { createStore } from "../server/db.js";
import { createApp } from "../server/app.js";
const dir = mkdtempSync(join(tmpdir(), "office-chat-browser-"));
const evidence = resolve("test-results");
mkdirSync(evidence, { recursive: true });
const store = createStore(join(dir, "test.sqlite"));
let providerStatus = 200;
const answer = "【隔离测试】这是问答结果。";
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
try {
  await page.goto(base);
  await page.getByLabel("账号", { exact: true }).fill("chatuser");
  await page.getByLabel("密码", { exact: true }).fill("ChatPassword123");
  await page.getByRole("button", { name: "创建并进入", exact: true }).click();
  await nav("设置");
  await page.getByLabel("API 地址", { exact: true }).fill(providerBase);
  await page.getByLabel("模型名称", { exact: true }).fill("test");
  await page.getByLabel("API Key", { exact: true }).fill("ISOLATED_KEY");
  await page.getByRole("button", { name: "保存并测试连接" }).click();
  await page.getByRole("status").filter({ hasText: "连接成功" }).waitFor();
  await nav("AI 问答");
  const input = page.getByLabel("你的问题", { exact: true });
  const send = page.getByRole("button", { name: "发送问题", exact: true });
  await input.fill("如何安排会议？");
  await send.click();
  await page.getByRole("button", { name: "正在回答…" }).waitFor();
  assert.equal(await input.isDisabled(), true);
  await send.waitFor();
  assert.equal(await page.getByRole("log").locator("article").count(), 2);
  await input.fill("再简短一点");
  await send.click();
  await page.getByRole("status").filter({ hasText: "回答已完成" }).waitFor();
  assert.equal(await page.getByRole("log").locator("article").count(), 4);
  providerStatus = 401;
  await input.fill("保留这次提问");
  await send.click();
  await page.getByRole("alert").filter({ hasText: "API Key 无效" }).waitFor();
  assert.equal(await input.inputValue(), "保留这次提问");
  assert.equal(await page.getByRole("log").locator("article").count(), 4);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出 TXT" }).click();
  assert.equal((await download).suggestedFilename(), "AI问答.txt");
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: join(evidence, "chat-mobile.png"), fullPage: true });
  await page.getByRole("button", { name: "新对话", exact: true }).click();
  await page.getByRole("alertdialog").waitFor();
  assert.equal(store.list("chatuser").length, 0);
  assert.deepEqual(errors, []);
  writeFileSync(
    join(evidence, "chat-browser-report.json"),
    JSON.stringify(
      {
        passed: true,
        checks: [
          "多轮问答",
          "发送锁定",
          "401保留输入与历史",
          "TXT导出",
          "清空确认",
          "390px无溢出",
          "无数据库写入",
        ],
        provider: "isolated",
      },
      null,
      2,
    ),
  );
  console.log("chat browser passed");
} finally {
  await browser.close();
  await new Promise<void>((r) => appServer.close(() => r()));
  await new Promise<void>((r) => provider.close(() => r()));
  store.db.close();
  rmSync(dir, { recursive: true, force: true });
}
