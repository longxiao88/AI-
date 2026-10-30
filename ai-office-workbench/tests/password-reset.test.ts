import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../server/app.js";
import { createStore } from "../server/db.js";

/**
 * 找回密码：邮箱验证码流程。
 * 通过注入 mock mailer 绕过真实 SMTP，验证码从邮件正文中截取用于校验。
 */
test("password reset via email verification code", async () => {
  const store = createStore(":memory:");
  // mock mailer：捕获发送的邮件，供测试读取验证码
  const sent: { to: string; subject: string; text: string }[] = [];
  const mailer = async (_config: unknown, body: { to: string; subject: string; text: string }) => {
    sent.push(body);
  };

  const server = createApp(store, { mailer } as any).listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as any).port}/api`;
  let cookie = "";
  const call = async (path: string, method = "GET", body?: unknown, auth = true) => {
    const r = await fetch(base + path, {
      method,
      headers: { "Content-Type": "application/json", Cookie: auth ? cookie : "" },
      body: method === "GET" ? undefined : JSON.stringify(body || {}),
    });
    if (r.headers.get("set-cookie")) cookie = r.headers.get("set-cookie")!.split(";")[0];
    return { status: r.status, body: await r.json().catch(() => ({})), headers: r.headers };
  };

  // 配置一份 SMTP（假值即可，因为 mailer 被 mock 了）
  const setSmtp = async () => {
    await call("/settings/smtp", "PUT", {
      host: "smtp.test.com",
      port: 465,
      secure: true,
      user: "sender@test.com",
      pass: "fake-auth-code",
      fromName: "测试",
    });
  };

  const extractCode = (text: string) => text.match(/\d{6}/)?.[0] || "";

  try {
    // 注册账号
    const setup = await call("/auth/setup", "POST", {
      username: "alice",
      password: "OldPass123",
      name: "爱丽丝",
    });
    assert.equal(setup.status, 201);

    // 配置 SMTP
    await setSmtp();

    // 绑定邮箱：请求验证码
    const reqEmail = await call("/profile/email/request", "POST", { email: "alice@test.com" });
    assert.equal(reqEmail.status, 200);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, "alice@test.com");

    // 确认绑定
    const confirmEmail = await call("/profile/email/confirm", "POST", {
      email: "alice@test.com",
      code: extractCode(sent[0].text),
    });
    assert.equal(confirmEmail.status, 200);
    assert.equal(confirmEmail.body.email, "alice@test.com");
    assert.equal(confirmEmail.body.emailVerified, true);

    // 登出，模拟忘记密码
    await call("/auth/logout", "POST");
    cookie = "";

    // 请求找回密码验证码
    const reqReset = await call("/auth/reset/request", "POST", { account: "alice@test.com" });
    assert.equal(reqReset.status, 200);
    const resetMail = sent[sent.length - 1];
    assert.equal(resetMail.to, "alice@test.com");

    // 用错误验证码应失败
    const bad = await call("/auth/reset/confirm", "POST", {
      account: "alice@test.com",
      code: "000000",
      newPassword: "NewPass123",
    });
    assert.equal(bad.status, 401);

    // 用正确验证码重置
    const ok = await call("/auth/reset/confirm", "POST", {
      account: "alice@test.com",
      code: extractCode(resetMail.text),
      newPassword: "NewPass123",
    });
    assert.equal(ok.status, 200);

    // 旧密码登录失败，新密码登录成功
    assert.equal(
      (await call("/auth/login", "POST", { username: "alice", password: "OldPass123" })).status,
      401,
    );
    const login = await call("/auth/login", "POST", { username: "alice", password: "NewPass123" });
    assert.equal(login.status, 200);
    assert.equal(login.body.user.email, "alice@test.com");
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    store.db.close();
  }
});
