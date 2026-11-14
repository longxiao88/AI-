import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../server/app.js";
import { createStore } from "../server/db.js";

/**
 * 真链路验证冷却：走 HTTP 接口，用注入的假 mailer 统计真实发信次数。
 * 重点不是算法（cooldown.test.ts 已覆盖），而是「第二个请求确实被拦下、
 * 且没有再触发一次发信」。
 */

// 用环境变量提供 SMTP，避免往数据库写授权码
process.env.SMTP_HOST = "127.0.0.1";
process.env.SMTP_PORT = "2525";
process.env.SMTP_USER = "sender@example.com";
process.env.SMTP_PASS = "fake-pass";

interface Sent {
  to: string;
  subject: string;
  code: string;
}

async function withServer(run: (base: string, sent: Sent[]) => Promise<void>) {
  const store = createStore(":memory:");
  const sent: Sent[] = [];
  const app = createApp(store, {
    mailer: async (_config, body) => {
      const match = body.text.match(/\b(\d{6})\b/);
      sent.push({ to: body.to, subject: body.subject, code: match ? match[1] : "" });
    },
  });

  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((done) => server.once("listening", () => done()));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;

  try {
    await run(`http://127.0.0.1:${port}/api`, sent);
  } finally {
    await new Promise<void>((done) => server.close(() => done()));
    store.db.close();
  }
}

function post(base: string, path: string, body: unknown, cookie = "") {
  return fetch(base + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  });
}

test("冷却：同目标 60 秒内第二次请求返回 429，且不再发信", async () => {
  await withServer(async (base, sent) => {
    // 注册账号
    const setup = await post(base, "/auth/setup", {
      username: "cooluser",
      password: "cool-pass-2026",
      name: "冷却测试",
    });
    assert.equal(setup.status, 201);
    const cookie = (setup.headers.getSetCookie?.() || [])
      .map((c) => c.split(";")[0])
      .join("; ");

    // 绑定邮箱：第一次发码
    const first = await post(base, "/profile/email/request", { email: "cool@example.com" }, cookie);
    assert.equal(first.status, 200);
    assert.equal(sent.length, 1);

    // 紧接着再发一次 -> 冷却拦截，且不发信
    const again = await post(base, "/profile/email/request", { email: "cool@example.com" }, cookie);
    assert.equal(again.status, 429);
    const body = (await again.json()) as { error: string };
    assert.match(body.error, /秒后再试/);
    assert.equal(sent.length, 1, "被冷却拦下的请求不应触发发信");

    // 用收到的验证码完成绑定，让账号拥有 email
    const confirm = await post(
      base,
      "/profile/email/confirm",
      { email: "cool@example.com", code: sent[0].code },
      cookie,
    );
    assert.equal(confirm.status, 200);

    // 找回密码：第一次发码（计数 +1），第二次被冷却拦下（计数不变）
    const r1 = await post(base, "/auth/reset/request", { account: "cooluser" });
    assert.equal(r1.status, 200);
    assert.equal(sent.length, 2);
    assert.equal(sent[1].to, "cool@example.com");

    const r2 = await post(base, "/auth/reset/request", { account: "cooluser" });
    assert.equal(r2.status, 429);
    assert.equal(sent.length, 2, "第二次不应发信");
  });
});

test("冷却：不存在的账号也占用名额，不会用 429 泄露账号是否存在", async () => {
  await withServer(async (base, sent) => {
    const r1 = await post(base, "/auth/reset/request", { account: "nobody_here" });
    assert.equal(r1.status, 200);
    assert.equal(sent.length, 0, "账号不存在时不发信");

    const r2 = await post(base, "/auth/reset/request", { account: "nobody_here" });
    assert.equal(r2.status, 429, "不存在的账号第二次同样被冷却拦下");
  });
});

test("冷却：按目标区分，换一个账号不受影响", async () => {
  await withServer(async (base, sent) => {
    await post(base, "/auth/setup", { username: "alpha", password: "alpha-pass-2026" });
    await post(base, "/auth/setup", { username: "beta", password: "beta-pass-2026" });

    const a1 = await post(base, "/auth/reset/request", { account: "alpha" });
    assert.equal(a1.status, 200);
    const a2 = await post(base, "/auth/reset/request", { account: "alpha" });
    assert.equal(a2.status, 429, "同一目标第二次应被拦");

    const b1 = await post(base, "/auth/reset/request", { account: "beta" });
    assert.equal(b1.status, 200, "不同目标的冷却互不影响");
    assert.equal(sent.length, 0, "两个账号都没绑定邮箱，不发信");
  });
});
