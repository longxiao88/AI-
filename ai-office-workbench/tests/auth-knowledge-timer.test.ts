import test from "node:test";
import assert from "node:assert/strict";
import { timerValue, formatDuration, type TimerState } from "../shared/timer.js";
import { createApp } from "../server/app.js";
import { createStore } from "../server/db.js";

test("account setup, login gate, durable profile, logout invalidates session, legacy records retained", async () => {
  const store = createStore(":memory:");
  // 旧版单账号数据（未迁移时通过首个账号 setup 归入该账号）
  store.save("tester", "writing", "旧文稿", { input: "已有数据" });
  const server = createApp(store).listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as any).port}/api`;
  let cookie = "";
  const call = async (path: string, method = "GET", body?: unknown, auth = true) => {
    const r = await fetch(base + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        Cookie: auth ? cookie : "",
      },
      body: method === "GET" ? undefined : JSON.stringify(body || {}),
    });
    if (r.headers.get("set-cookie")) cookie = r.headers.get("set-cookie")!.split(";")[0];
    return { status: r.status, body: await r.json(), headers: r.headers };
  };
  try {
    assert.equal((await call("/entries")).status, 401);
    assert.deepEqual((await call("/auth/session")).body.accounts, []);
    const setup = await call("/auth/setup", "POST", {
      username: "tester",
      password: "SafePass123",
      name: "测试员",
    });
    assert.equal(setup.status, 201);
    assert.match(setup.headers.get("set-cookie")!, /HttpOnly/);
    assert.match(setup.headers.get("set-cookie")!, /SameSite=Strict/);
    // 迁移后旧数据归入首个账号
    assert.equal((await call("/entries")).body[0].title, "旧文稿");
    // 多账号：允许注册第二个账号
    const second = await call("/auth/setup", "POST", {
      username: "second",
      password: "AnotherPass123",
    });
    assert.equal(second.status, 201);
    // 但第二个账号看不到 tester 的数据
    assert.equal((await call("/entries")).body.length, 0);
    // 重复注册同名账号被拒绝
    assert.equal(
      (
        await call("/auth/setup", "POST", {
          username: "second",
          password: "Whatever123",
        })
      ).status,
      409,
    );
    // 切回 tester 账号验证数据隔离
    await call("/auth/login", "POST", { username: "tester", password: "SafePass123" });
    assert.equal((await call("/entries")).body[0].title, "旧文稿");

    const updated = await call("/profile", "PUT", {
      name: "新名字",
      email: "user@example.com",
      role: "研究者",
      bio: "个人简介",
    });
    assert.equal(updated.body.name, "新名字");
    assert.equal((await call("/profile")).body.bio, "个人简介");
    assert.ok(
      !JSON.stringify(store.db.prepare("SELECT * FROM account").all()).includes("SafePass123"),
    );
    const oldCookie = cookie;
    await call("/auth/logout", "POST");
    cookie = oldCookie;
    assert.equal((await call("/entries")).status, 401);
    assert.equal(
      (
        await call("/auth/login", "POST", {
          username: "tester",
          password: "WrongPass123",
        })
      ).status,
      401,
    );
    assert.equal(
      (
        await call("/auth/login", "POST", {
          username: "tester",
          password: "SafePass123",
        })
      ).status,
      200,
    );
    assert.equal((await call("/auth/session")).body.user.name, "新名字");
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    store.db.close();
  }
});
test("knowledge keyword retrieval and sourced AI prompt, no hit prevents external call", async () => {
  const store = createStore(":memory:");
  store.save("tester", "knowledge", "交付流程", {
    keywords: "交付 验收",
    source: "先自测，再让客户验收。",
  });
  store.save("tester", "writing", "不应检索", { source: "交付" });
  let calls = 0;
  let prompt = "";
  const app = createApp(store, {
    fetcher: (async (_url, init) => {
      calls++;
      prompt = String(init?.body);
      return Response.json({
        choices: [{ message: { content: "先自测，再由客户验收 [1]。" } }],
      });
    }) as typeof fetch,
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as any).port}/api`;
  let cookie = "";
  const call = async (path: string, body?: unknown) => {
    const r = await fetch(base + path, {
      method: body ? "POST" : "GET",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (r.headers.get("set-cookie")) cookie = r.headers.get("set-cookie")!.split(";")[0];
    return { status: r.status, body: await r.json() };
  };
  try {
    await call("/auth/setup", { username: "tester", password: "SafePass123" });
    const hits = await call("/knowledge/search?q=" + encodeURIComponent("交付步骤"));
    assert.equal(hits.body.length, 1);
    assert.equal(hits.body[0].title, "交付流程");
    assert.equal((await call("/ai/knowledge", { question: "火星矿石" })).status, 404);
    assert.equal(calls, 0);
    await fetch(base + "/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        baseUrl: "https://example.com/v1",
        model: "test",
        key: "test-only",
      }),
    });
    const answer = await call("/ai/knowledge", { question: "如何交付" });
    assert.equal(answer.status, 200);
    assert.equal(answer.body.sources.length, 1);
    assert.match(answer.body.answer, /\[1\]/);
    assert.match(prompt, /不可信资料/);
    assert.match(prompt, /先自测/);
    assert.equal(calls, 1);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    store.db.close();
  }
});
test("timer remains correct across pause, page navigation, background delay and completion", () => {
  const state: TimerState = {
    mode: "countdown",
    running: true,
    baseMs: 60000,
    startedAt: 1000,
    durationMs: 60000,
  };
  assert.equal(timerValue(state, 11000), 50000);
  assert.equal(timerValue(state, 100000), 0);
  const paused = { ...state, running: false, baseMs: 50000 };
  assert.equal(timerValue(paused, 999999), 50000);
  const resumed = { ...paused, running: true, startedAt: 100000 };
  assert.equal(timerValue(resumed, 110000), 40000);
  assert.equal(timerValue({ ...state, mode: "stopwatch", baseMs: 2000 }, 6000), 7000);
  assert.equal(formatDuration(3661000), "01:01:01");
});
