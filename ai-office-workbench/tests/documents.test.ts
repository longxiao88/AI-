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
  await call(session.body.setupRequired ? "/auth/setup" : "/auth/login", "POST", {
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

const provider = (content: string) =>
  (async () =>
    Response.json({
      choices: [{ message: { content } }],
    })) as typeof fetch;

const validJson = JSON.stringify({
  overview: "【测试】文档介绍了四模块框架。",
  keyPoints: ["【测试】写作与会议"],
  actions: ["【测试】补充验收"],
});

async function configured(options: Parameters<typeof createApp>[1]) {
  const h = await harness(options);
  await h.call("/settings", "PUT", {
    baseUrl: "https://example.com/v1",
    model: "test",
    key: "secret",
  });
  return h;
}
test("document AI requires login, model and key; input boundaries enforced", async () => {
  let calls = 0;
  const h = await harness({
    fetcher: (async () => {
      calls++;
      return Response.json({ choices: [{ message: { content: validJson } }] });
    }) as typeof fetch,
  });
  try {
    const anonymous = await fetch(`http://127.0.0.1:${h.port}/api/ai/documents`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "", source: "原文" }),
    });
    assert.equal(anonymous.status, 401);
    assert.equal(
      (await h.call("/ai/documents", "POST", { title: "", source: "原文" })).status,
      409,
    );
    await h.call("/settings", "PUT", {
      baseUrl: "https://example.com/v1",
      model: "test",
    });
    const noKey = await h.call("/ai/documents", "POST", {
      title: "",
      source: "原文",
    });
    assert.equal(noKey.status, 409);
    assert.match(noKey.body.error, /API Key/);
    await h.call("/settings", "PUT", {
      baseUrl: "https://example.com/v1",
      model: "test",
      key: "secret",
    });
    for (const body of [
      { title: "", source: "" },
      { title: "", source: "  " },
      { title: "", source: "a".repeat(20001) },
      { title: "t".repeat(121), source: "原文" },
      { title: "", source: "原文", extra: 1 },
    ])
      assert.equal((await h.call("/ai/documents", "POST", body)).status, 400);
    assert.equal(
      (
        await h.call("/ai/documents", "POST", {
          title: "",
          source: "a".repeat(20000),
        })
      ).status,
      200,
    );
    assert.equal(calls, 1);
  } finally {
    await h.close();
  }
});
test("document AI contract: fenced ok, invalid shapes 502, busy released, nothing persisted", async () => {
  const cases: [string, number][] = [
    [validJson, 200],
    [`\`\`\`json\n${validJson}\n\`\`\``, 200],
    ["not json", 502],
    [JSON.stringify({ keyPoints: [], actions: [] }), 502],
    [JSON.stringify({ overview: " ", keyPoints: [], actions: [] }), 502],
    [
      JSON.stringify({
        overview: "o".repeat(10001),
        keyPoints: [],
        actions: [],
      }),
      502,
    ],
    [
      JSON.stringify({
        overview: "概述",
        keyPoints: Array.from({ length: 31 }, (_, i) => `要点${i}`),
        actions: [],
      }),
      502,
    ],
    [
      JSON.stringify({
        overview: "概述",
        keyPoints: [],
        actions: Array.from({ length: 31 }, (_, i) => `行动${i}`),
      }),
      502,
    ],
    [JSON.stringify({ overview: "概述", keyPoints: [""], actions: [] }), 502],
    [
      JSON.stringify({
        overview: "概述",
        keyPoints: ["k".repeat(501)],
        actions: [],
      }),
      502,
    ],
    [JSON.stringify({ overview: "概述", keyPoints: [], actions: [], extra: 1 }), 502],
  ];
  for (const [content, expected] of cases) {
    const h = await configured({ fetcher: provider(content) });
    try {
      const result = await h.call("/ai/documents", "POST", {
        title: "文档",
        source: "原文",
      });
      assert.equal(result.status, expected, content.slice(0, 40));
      assert.equal(h.store.list().length, 0);
      assert.equal(h.store.history().length, 0);
    } finally {
      await h.close();
    }
  }
  const recovered = await configured({ fetcher: provider("bad json") });
  try {
    assert.equal(
      (
        await recovered.call("/ai/documents", "POST", {
          title: "",
          source: "原文",
        })
      ).status,
      502,
    );
    const again = await recovered.call("/ai/documents", "POST", {
      title: "",
      source: "原文",
    });
    assert.equal(again.status, 502);
  } finally {
    await recovered.close();
  }
});
test("document AI shares busy with other modules and sends the office prompt", async () => {
  let release: () => void = () => {};
  let started: () => void = () => {};
  const begun = new Promise<void>((r) => (started = r));
  let seen: any = null;
  const h = await configured({
    fetcher: (async (_url, init) => {
      seen = JSON.parse(String(init?.body));
      started();
      await new Promise<void>((r) => (release = r));
      return Response.json({ choices: [{ message: { content: validJson } }] });
    }) as typeof fetch,
  });
  try {
    const first = h.call("/ai/documents", "POST", {
      title: "功能说明",
      source: "文档正文",
    });
    await begun;
    assert.equal((await h.call("/ai/meetings", "POST", { title: "", source: "x" })).status, 409);
    release();
    const done = await first;
    assert.equal(done.status, 200);
    assert.equal(done.body.overview.includes("【测试】"), true);
    assert.equal(seen.messages[0].content, officePrompts.document);
    assert.deepEqual(JSON.parse(seen.messages[1].content), {
      title: "功能说明",
      source: "文档正文",
    });
  } finally {
    release();
    await h.close();
  }
});
