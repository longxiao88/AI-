import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../server/app.js";
import { createStore } from "../server/db.js";
import { officePrompts } from "../server/office-prompts.js";

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

const provider = (content: string, status = 200) =>
  (async () =>
    status === 200
      ? Response.json({ choices: [{ message: { content } }] })
      : new Response("upstream failure", { status })) as typeof fetch;

const validJson = JSON.stringify({
  summary: "【测试】结论：按时交付。",
  todos: ["【测试】核对界面", "【测试】补充测试"],
});

async function configured(options: Parameters<typeof createApp>[1], dbPath?: string) {
  const h = await harness(options, dbPath);
  await h.call("/settings", "PUT", {
    baseUrl: "https://example.com/v1",
    model: "test",
    key: "secret",
  });
  return h;
}
test("meeting AI requires login, model and key before any provider call", async () => {
  let calls = 0;
  const h = await harness({
    fetcher: (async () => {
      calls++;
      return Response.json({ choices: [{ message: { content: validJson } }] });
    }) as typeof fetch,
  });
  try {
    const anonymous = await fetch(`http://127.0.0.1:${h.port}/api/ai/meetings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "", source: "原文" }),
    });
    assert.equal(anonymous.status, 401);
    assert.equal((await h.call("/ai/meetings", "POST", { title: "", source: "原文" })).status, 409);
    await h.call("/settings", "PUT", {
      baseUrl: "https://example.com/v1",
      model: "test",
    });
    const noKey = await h.call("/ai/meetings", "POST", {
      title: "",
      source: "原文",
    });
    assert.equal(noKey.status, 409);
    assert.match(noKey.body.error, /API Key/);
    assert.equal(calls, 0);
  } finally {
    await h.close();
  }
});
test("meeting AI input boundaries: no silent truncation, strict body", async () => {
  const h = await configured({ fetcher: provider(validJson) });
  try {
    for (const body of [
      { title: "", source: "" },
      { title: "", source: "   " },
      { title: "", source: "a".repeat(20001) },
      { title: "t".repeat(121), source: "原文" },
      { title: "", source: "原文", extra: true },
    ])
      assert.equal(
        (await h.call("/ai/meetings", "POST", body)).status,
        400,
        JSON.stringify(body).slice(0, 60),
      );
    const okResult = await h.call("/ai/meetings", "POST", {
      title: "",
      source: "a".repeat(20000),
    });
    assert.equal(okResult.status, 200);
  } finally {
    await h.close();
  }
});
test("meeting AI result contract: fenced JSON ok, invalid shapes rejected with 502, busy released", async () => {
  const cases: [string, number][] = [
    [validJson, 200],
    [`\`\`\`json\n${validJson}\n\`\`\``, 200],
    ["not json at all", 502],
    [`${validJson}\n多余文字`, 502],
    [JSON.stringify({ todos: [] }), 502],
    [JSON.stringify({ summary: "  ", todos: [] }), 502],
    [JSON.stringify({ summary: "s".repeat(20001), todos: [] }), 502],
    [
      JSON.stringify({
        summary: "结论",
        todos: Array.from({ length: 51 }, (_, i) => `事项${i}`),
      }),
      502,
    ],
    [JSON.stringify({ summary: "结论", todos: [""] }), 502],
    [JSON.stringify({ summary: "结论", todos: [], unexpected: 1 }), 502],
  ];
  for (const [content, expected] of cases) {
    const h = await configured({ fetcher: provider(content) });
    try {
      const result = await h.call("/ai/meetings", "POST", {
        title: "周会",
        source: "会议原文",
      });
      assert.equal(result.status, expected, content.slice(0, 40));
      if (expected === 200) {
        assert.equal(typeof result.body.summary, "string");
        assert.ok(Array.isArray(result.body.todos));
      } else {
        assert.match(result.body.error, /AI 返回/);
        const again = await h.call("/ai/meetings", "POST", {
          title: "周会",
          source: "会议原文",
        });
        assert.equal(again.status, 502);
      }
      assert.equal(h.store.list("tester").length, 0);
      assert.equal(h.store.history("tester").length, 0);
    } finally {
      await h.close();
    }
  }
});
test("meeting AI shares busy with writing, locks settings, releases after failure, never retries", async () => {
  let release: () => void = () => {};
  let started: () => void = () => {};
  const begun = new Promise<void>((r) => (started = r));
  let calls = 0;
  const h = await configured({
    fetcher: (async () => {
      calls++;
      started();
      await new Promise<void>((r) => (release = r));
      return Response.json({ choices: [{ message: { content: validJson } }] });
    }) as typeof fetch,
  });
  try {
    const first = h.call("/ai/meetings", "POST", {
      title: "周会",
      source: "会议原文",
    });
    await begun;
    assert.equal((await h.call("/ai/meetings", "POST", { title: "", source: "x" })).status, 409);
    assert.equal(
      (await h.call("/ai/generate", "POST", { mode: "compose", input: "x" })).status,
      409,
    );
    assert.equal(
      (
        await h.call("/settings", "PUT", {
          baseUrl: "https://example.com/v1",
          model: "test",
        })
      ).status,
      409,
    );
    release();
    const done = await first;
    assert.equal(done.status, 200);
    assert.equal(done.body.todos.length, 2);
    assert.equal(calls, 1);
  } finally {
    release();
    await h.close();
  }
  let providerCalls = 0;
  const failing = await configured({
    fetcher: (async () => {
      providerCalls++;
      return new Response("upstream failure", { status: 500 });
    }) as typeof fetch,
  });
  try {
    const result = await failing.call("/ai/meetings", "POST", {
      title: "",
      source: "原文",
    });
    assert.equal(result.status, 502);
    assert.ok(!result.body.error.includes("upstream failure"));
    const recovered = await failing.call("/ai/meetings", "POST", {
      title: "",
      source: "原文",
    });
    assert.equal(recovered.status, 502);
    assert.equal(providerCalls, 2);
  } finally {
    await failing.close();
  }
});
test("meeting AI sends the office prompt and title/source payload", async () => {
  let seen: { url: string; auth: string; body: any } | null = null;
  const h = await configured({
    fetcher: (async (url, init) => {
      seen = {
        url: String(url),
        auth: String((init?.headers as Record<string, string>).Authorization),
        body: JSON.parse(String(init?.body)),
      };
      return Response.json({ choices: [{ message: { content: validJson } }] });
    }) as typeof fetch,
  });
  try {
    const result = await h.call("/ai/meetings", "POST", {
      title: "季度复盘",
      source: "讨论了发布节奏。",
    });
    assert.equal(result.status, 200);
    assert.equal(seen!.url, "https://example.com/v1/chat/completions");
    assert.equal(seen!.auth, "Bearer secret");
    assert.equal(seen!.body.messages[0].role, "system");
    assert.equal(seen!.body.messages[0].content, officePrompts.meeting);
    assert.deepEqual(JSON.parse(seen!.body.messages[1].content), {
      title: "季度复盘",
      source: "讨论了发布节奏。",
    });
  } finally {
    await h.close();
  }
});
