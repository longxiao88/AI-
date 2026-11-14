import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as XLSX from "xlsx";
import { createApp } from "../server/app.js";
import { createStore } from "../server/db.js";

async function harness() {
  const store = createStore(":memory:");
  const server = createApp(store).listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const addr = server.address() as { port: number };
  let cookie = "";
  const call = async (path: string, method = "GET", body?: unknown) => {
    const response = await fetch(`http://127.0.0.1:${addr.port}/api${path}`, {
      method,
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
    });
    if (response.headers.get("set-cookie"))
      cookie = response.headers.get("set-cookie")!.split(";")[0];
    return { status: response.status, body: await response.json() };
  };
  // 解析接口上传：POST multipart 到 /knowledge/parse，返回 { title, text }
  const parse = async (file: { name: string; buffer: Buffer }) => {
    const fd = new FormData();
    const bytes = new Uint8Array(file.buffer).slice();
    fd.append("file", new Blob([bytes as BlobPart]), file.name);
    const res = await fetch(`http://127.0.0.1:${addr.port}/api/knowledge/parse`, {
      method: "POST",
      headers: { Cookie: cookie },
      body: fd,
    });
    return { status: res.status, body: await res.json() };
  };
  const session = await call("/auth/session");
  await call(session.body.accounts.length === 0 ? "/auth/setup" : "/auth/login", "POST", {
    username: "tester",
    password: "TestPassword123",
  });
  return {
    parse,
    cookie: () => cookie,
    port: addr.port,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      store.db.close();
    },
  };
}

test("知识库：解析 Word 为纯文本", async () => {
  const h = await harness();
  try {
    const docx = readFileSync("node_modules/mammoth/test/test-data/single-paragraph.docx");
    const res = await h.parse({ name: "说明文档.docx", buffer: docx });
    assert.equal(res.status, 200);
    assert.equal(res.body.title, "说明文档");
    assert.match(res.body.text, /Walking on imported air/);
  } finally {
    await h.close();
  }
});

test("知识库：解析 Excel 为 CSV 文本", async () => {
  const h = await harness();
  try {
    const ws = XLSX.utils.aoa_to_sheet([
      ["姓名", "年龄"],
      ["张三", 28],
      ["李四", 35],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "员工");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    const res = await h.parse({ name: "员工名单.xlsx", buffer: buf });
    assert.equal(res.status, 200);
    assert.equal(res.body.title, "员工名单");
    assert.match(res.body.text, /【员工】/);
    assert.match(res.body.text, /张三/);
    assert.match(res.body.text, /李四/);
  } finally {
    await h.close();
  }
});

test("知识库：不支持的类型被拒绝，未登录无法解析", async () => {
  const h = await harness();
  try {
    // 未登录（无 cookie）
    const fd = new FormData();
    const bytes = new Uint8Array(Buffer.from("x")).slice();
    fd.append("file", new Blob([bytes as BlobPart]), "a.docx");
    const anon = await fetch(`http://127.0.0.1:${h.port}/api/knowledge/parse`, {
      method: "POST",
      body: fd,
    });
    assert.equal(anon.status, 401);

    // 登录后上传不支持的类型
    const bad = await h.parse({ name: "恶意.exe", buffer: Buffer.from("x") });
    assert.equal(bad.status, 400);
    assert.match(bad.body.error, /不支持/);
  } finally {
    await h.close();
  }
});
