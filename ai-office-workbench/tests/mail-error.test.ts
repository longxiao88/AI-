import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../server/app.js";
import { createStore } from "../server/db.js";

test("邮箱绑定：SMTP 发信失败时返回具体错误而非笼统 500", async () => {
  const store = createStore(":memory:");
  // mock mailer：抛出发信失败，模拟授权码错误等 SMTP 故障
  const mailer = async () => {
    throw new Error("Invalid login: 535 Authentication failed");
  };
  const server = createApp(store, { mailer } as any).listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as any).port}/api`;
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

  try {
    // 注册账号
    const setup = await call("/auth/setup", "POST", {
      username: "alice",
      password: "TestPass123",
      name: "爱丽丝",
    });
    assert.equal(setup.status, 201);

    // 配置一份 SMTP（发信会失败）
    await call("/settings/smtp", "PUT", {
      host: "smtp.test.com",
      port: 465,
      secure: true,
      user: "sender@test.com",
      pass: "fake-auth-code",
      fromName: "测试",
    });

    // 请求绑定邮箱：应返回 502 且带具体原因，而不是 500「保存或处理失败」
    const req = await call("/profile/email/request", "POST", { email: "alice@test.com" });
    assert.equal(req.status, 502);
    assert.match(req.body.error, /邮件发送失败/);
    assert.match(req.body.error, /Invalid login/);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    store.db.close();
  }
});
