import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../server/app.js";
import { createStore } from "../server/db.js";

async function harness(options: Parameters<typeof createApp>[1] = {}, dbPath = ":memory:") {
  const store = createStore(dbPath);
  const server = createApp(store, options).listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const addr = server.address() as { port: number };
  let cookie = "";
  const call = async (
    path: string,
    method = "GET",
    body?: unknown,
    headers: Record<string, string> = {},
  ) => {
    const response = await fetch(`http://127.0.0.1:${addr.port}/api${path}`, {
      method,
      headers: { "Content-Type": "application/json", Cookie: cookie, ...headers },
      body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
    });
    if (response.headers.get("set-cookie"))
      cookie = response.headers.get("set-cookie")!.split(";")[0];
    return { status: response.status, body: await response.json() };
  };
  const upload = async (
    file: { name: string; buffer: Buffer },
    fields: Record<string, string> = {},
  ) => {
    const fd = new FormData();
    const bytes = new Uint8Array(file.buffer).slice();
    fd.append("file", new Blob([bytes as BlobPart]), file.name);
    for (const [k, v] of Object.entries(fields)) fd.append(k, v);
    const res = await fetch(`http://127.0.0.1:${addr.port}/api/resources/upload`, {
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
    call,
    upload,
    store,
    port: addr.port,
    cookie: () => cookie,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      store.db.close();
    },
  };
}

test("资源库：上传 docx 可预览、下载计数、删除清理文件", async () => {
  const dir = mkdtempSync(join(tmpdir(), "office-res-"));
  const filesDir = join(dir, "files");
  const h = await harness({ filesDir }, join(dir, "test.sqlite"));
  try {
    const docx = readFileSync("node_modules/mammoth/test/test-data/single-paragraph.docx");

    // 上传 docx
    const up = await h.upload({ name: "测试文档.docx", buffer: docx }, { category: "文档" });
    assert.equal(up.status, 201);
    assert.equal(up.body.kind, "resources");
    assert.equal(up.body.data.category, "文档");
    assert.equal(up.body.data.ext, ".docx");
    assert.ok(up.body.data.storedName);

    // 文件确实落盘
    assert.ok(existsSync(join(filesDir, up.body.data.storedName)));

    // 列表里能看到
    const list = await h.call("/entries?kind=resources");
    assert.equal(list.body.length, 1);

    // 在线预览返回 HTML
    const preview = await h.call(`/resources/${up.body.id}/preview`);
    assert.equal(preview.status, 200);
    assert.equal(preview.body.type, "html");
    assert.match(preview.body.html, /Walking on imported air/);

    // 下载（带 cookie）：计数 +1
    const dlRes = await fetch(
      `http://127.0.0.1:${h.port}/api/resources/${up.body.id}/download`,
      { headers: { Cookie: h.cookie() } },
    );
    assert.equal(dlRes.status, 200);
    assert.equal((h.store.get("tester", up.body.id)!.data as { downloads?: number }).downloads, 1);

    // AI 分析：未配置模型时应 409（但接口存在且能走到解析）
    const analyze = await h.call(`/resources/${up.body.id}/analyze`, "POST", {});
    assert.equal(analyze.status, 409);

    // 删除资源应清理磁盘文件
    const storedName = up.body.data.storedName as string;
    const del = await h.call(`/entries/${up.body.id}`, "DELETE");
    assert.equal(del.status, 200);
    assert.equal(h.store.get("tester", up.body.id), undefined);
    assert.ok(!existsSync(join(filesDir, storedName)));
  } finally {
    await h.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("资源库：不支持的类型被拒绝，未登录无法上传", async () => {
  const dir = mkdtempSync(join(tmpdir(), "office-res-"));
  const h = await harness({ filesDir: join(dir, "files") });
  try {
    // 未登录上传
    const fd = new FormData();
    const bytes = new Uint8Array(Buffer.from("x")).slice();
    fd.append("file", new Blob([bytes as BlobPart]), "a.docx");
    const res = await fetch(`http://127.0.0.1:${h.port}/api/resources/upload`, {
      method: "POST",
      body: fd,
    });
    assert.equal(res.status, 401);

    // 登录后上传不支持的扩展名
    const bad = await h.upload({ name: "a.exe", buffer: Buffer.from("x") });
    assert.equal(bad.status, 400);
    assert.match(bad.body.error, /不支持/);
  } finally {
    await h.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("提取正文：/resources/:id/text 返回纯文本，PDF / 图片给出明确提示", async () => {
  const dir = mkdtempSync(join(tmpdir(), "res-text-"));
  const h = await harness({ filesDir: dir }, join(dir, "db.sqlite"));
  try {
    const md = await h.upload(
      {
        name: "报销流程.md",
        buffer: Buffer.from("# 报销流程\n\n先填申请表，主管审批后提交。", "utf8"),
      },
      { category: "制度" },
    );
    assert.equal(md.status, 201);

    const ok = await h.call(`/resources/${md.body.id}/text`);
    assert.equal(ok.status, 200);
    assert.equal(ok.body.title, "报销流程");
    assert.match(ok.body.text, /主管审批/);

    // 图片没有可用的解析器，应给出「不支持提取正文」而不是解析失败
    const png = await h.upload({ name: "截图.png", buffer: Buffer.from("89504e470d0a1a0a", "hex") });
    assert.equal(png.status, 201);
    const bad = await h.call(`/resources/${png.body.id}/text`);
    assert.equal(bad.status, 400);
    assert.match(bad.body.error, /不支持提取正文/);

    const missing = await h.call("/resources/nope/text");
    assert.equal(missing.status, 404);
  } finally {
    await h.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("压缩包上传：解压成多条资源，并跳过目录与不支持的格式", async () => {
  const dir = mkdtempSync(join(tmpdir(), "res-zip-"));
  const h = await harness({ filesDir: dir }, join(dir, "db.sqlite"));
  try {
    const JSZip = (await import("jszip")).default;
    const zip = new JSZip();
    zip.file("制度/报销流程.md", "# 报销流程\n\n先填申请表，主管审批后提交。");
    zip.file("制度/年假规定.txt", "入职满一年享有 5 天带薪年假。");
    zip.file("bin/setup.exe", Buffer.from("MZ"));          // 不支持的格式，跳过
    zip.file("__MACOSX/._报销流程.md", "junk");            // macOS 资源分支，跳过
    const buffer = await zip.generateAsync({ type: "nodebuffer" });

    const res = await h.upload({ name: "制度合集.zip", buffer }, { category: "制度" });
    assert.equal(res.status, 201);
    assert.equal(res.body.extracted, 2);
    assert.equal(res.body.entries.length, 3, "压缩包原件 + 2 个解压文件");
    assert.ok(res.body.skipped >= 2, "应跳过 exe 与 __MACOSX 条目");

    type Row = {
      id: string;
      title: string;
      data: { ext: string; category: string; storedName: string };
    };
    const rows = res.body.entries as Row[];
    const zipEntry = rows.find((e) => e.data.ext === ".zip")!;
    assert.equal(zipEntry.title, "制度合集");
    assert.equal(zipEntry.data.category, "制度");
    assert.ok(zipEntry.data.storedName, "压缩包应已落盘，随时可下载");

    const titles = rows.filter((e) => e.data.ext !== ".zip").map((e) => e.title).sort();
    assert.deepEqual(titles, ["年假规定", "报销流程"]);

    // 原件能下载回来，且是合法的 zip
    const dl = await fetch(`http://127.0.0.1:${h.port}/api/resources/${zipEntry.id}/download`, {
      headers: { Cookie: h.cookie() },
    });
    assert.equal(dl.status, 200);
    assert.equal(dl.headers.get("content-type"), "application/zip");
    const bytes = Buffer.from(await dl.arrayBuffer());
    assert.equal(bytes.subarray(0, 2).toString(), "PK", "应返回 zip 文件头");

    // 解压出来的文件应能取正文
    const target = rows.find((e) => e.title === "报销流程")!;
    const text = await h.call(`/resources/${target.id}/text`);
    assert.equal(text.status, 200);
    assert.match(text.body.text, /主管审批/);

    // 空压缩包：原件照样保存，只是解压出 0 个
    const empty = await new JSZip().generateAsync({ type: "nodebuffer" });
    const emptyRes = await h.upload({ name: "空.zip", buffer: empty });
    assert.equal(emptyRes.status, 201);
    assert.equal(emptyRes.body.extracted, 0);
    assert.equal(emptyRes.body.entries.length, 1);
  } finally {
    await h.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
