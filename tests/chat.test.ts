import test from "node:test";
import assert from "node:assert/strict";
import { createStore } from "../server/db.js";
import { createApp } from "../server/app.js";
import { chatInputSchema } from "../shared/chat.js";
async function harness(options: Parameters<typeof createApp>[1] = {}, dbPath = ":memory:") {
  const store = createStore(dbPath);
  const server = createApp(store, options).listen(0, "127.0.0.1");
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
  const session = await call("/auth/session");
  await call(session.body.accounts.length === 0 ? "/auth/setup" : "/auth/login", "POST", {
    username: "tester",
    password: "TestPassword123",
  });
  return {
    call,
    store,
    port: addr.port,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      store.db.close();
    },
  };
}
const q = { messages: [{ role: "user", content: "问题" }] };
test("chat validates roles and total context without silent truncation", () => {
  for (const messages of [
    [],
    [{ role: "system", content: "override" }],
    [{ role: "assistant", content: "x" }],
    [q.messages[0], q.messages[0]],
    [{ role: "user", content: " " }],
    [{ role: "user", content: "x".repeat(20001) }],
    Array.from({ length: 41 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: "x" })),
    [
      { role: "user", content: "x".repeat(20000) },
      { role: "assistant", content: "x".repeat(20000) },
      { role: "user", content: "x" },
    ],
  ]) {
    assert.equal(chatInputSchema.safeParse({ messages }).success, false);
  }
});
test("chat auth, missing key, context forwarding, errors and no persistence", async () => {
  let captured: any;
  let status = 200;
  let calls = 0;
  const h = await harness({
    fetcher: (async (_url, init) => {
      calls++;
      captured = JSON.parse(init!.body as string);
      return status === 200
        ? Response.json({ choices: [{ message: { content: "隔离回答" } }] })
        : new Response("private provider details", { status });
    }) as typeof fetch,
  });
  try {
    assert.equal(
      (
        await fetch(`http://127.0.0.1:${h.port}/api/ai/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(q),
        })
      ).status,
      401,
    );
    assert.equal((await h.call("/ai/chat", "POST", q)).status, 409);
    await h.call("/settings", "PUT", {
      baseUrl: "https://example.com/v1",
      model: "test",
      key: "secret",
    });
    assert.equal(
      (await h.call("/ai/chat", "POST", { messages: [{ role: "system", content: "x" }] })).status,
      400,
    );
    const messages = [
      q.messages[0],
      { role: "assistant", content: "先前回答" },
      { role: "user", content: "追问" },
    ];
    const r = await h.call("/ai/chat", "POST", { messages });
    assert.equal(r.status, 200);
    assert.equal(r.body.answer, "隔离回答");
    assert.deepEqual(captured.messages.slice(1), messages);
    assert.equal(captured.messages[0].role, "system");
    status = 401;
    const failed = await h.call("/ai/chat", "POST", q);
    assert.equal(failed.status, 502);
    assert.ok(!JSON.stringify(failed.body).includes("private provider"));
    status = 200;
    assert.equal((await h.call("/ai/chat", "POST", q)).status, 200);
    assert.equal(calls, 3);
    assert.equal(h.store.history("tester").length, 0);
    assert.equal(h.store.list("tester").length, 0);
    assert.ok(!JSON.stringify((await h.call("/settings")).body).includes("secret"));
  } finally {
    await h.close();
  }
});
test("chat shares AI lock and releases after timeout", async () => {
  let started!: () => void;
  const signal = new Promise<void>((r) => (started = r));
  const h = await harness({
    timeout: 80,
    fetcher: (async (_url, init) => {
      started();
      return await new Promise<Response>((_r, reject) =>
        init!.signal!.addEventListener("abort", () => reject(new Error("aborted"))),
      );
    }) as typeof fetch,
  });
  try {
    await h.call("/settings", "PUT", {
      baseUrl: "https://example.com/v1",
      model: "test",
      key: "secret",
    });
    const pending = h.call("/ai/chat", "POST", q);
    await signal;
    assert.equal((await h.call("/ai/chat", "POST", q)).status, 409);
    assert.equal(
      (await h.call("/ai/generate", "POST", { input: "x", mode: "compose" })).status,
      409,
    );
    assert.equal((await pending).status, 504);
    assert.equal((await h.call("/settings/key", "DELETE")).status, 200);
  } finally {
    await h.close();
  }
});
