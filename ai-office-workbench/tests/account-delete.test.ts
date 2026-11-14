import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../server/app.js";
import { createStore } from "../server/db.js";

async function harness() {
  const store = createStore(":memory:");
  const server = createApp(store).listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
  let cookie = "";
  const call = async (path: string, method = "GET", body?: unknown) => {
    const r = await fetch(base + path, {
      method,
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
    });
    if (r.headers.get("set-cookie")) cookie = r.headers.get("set-cookie")!.split(";")[0];
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  const setup = (username: string) =>
    call("/auth/setup", "POST", { username, password: "TestPass123", name: username });
  return {
    call,
    setup,
    store,
    close: async () => {
      await new Promise<void>((r) => server.close(() => r()));
      store.db.close();
    },
  };
}

test("账号上限：最多 3 个，删除后可再注册", async () => {
  const h = await harness();
  try {
    for (const u of ["alice", "bob", "carol"]) {
      const r = await h.setup(u);
      assert.equal(r.status, 201, `注册 ${u} 应成功`);
    }
    // 第 4 个账号被拒绝
    const fourth = await h.setup("dave");
    assert.equal(fourth.status, 409);
    assert.match(fourth.body.error, /最多/);

    // 删除后（剩 2 个）可以再注册
    const del = await h.call("/account/alice", "DELETE");
    assert.equal(del.status, 200);
    assert.equal(del.body.accounts.length, 2);

    const again = await h.setup("dave");
    assert.equal(again.status, 201);
  } finally {
    await h.close();
  }
});

test("删除账号：清空该账号的业务数据与账号记录", async () => {
  const h = await harness();
  try {
    await h.setup("alice");

    // 保存一条业务数据
    const save = await h.call("/entries/writing", "POST", {
      title: "测试笔记",
      data: { source: "hello world" },
    });
    assert.equal(save.status, 201);

    // 删除账号（无需密码，前端已做一次确认）
    const del = await h.call("/account/alice", "DELETE");
    assert.equal(del.status, 200);
    assert.equal(del.body.accounts.length, 0);

    const rows = h.store.db
      .prepare("SELECT COUNT(*) AS n FROM entries WHERE accountId = ?")
      .get("alice") as { n: number };
    assert.equal(rows.n, 0, "删除账号后其业务数据应被清空");

    const account = h.store.db.prepare("SELECT * FROM account WHERE id = ?").get("alice");
    assert.equal(account, undefined, "账号记录应被删除");
  } finally {
    await h.close();
  }
});
