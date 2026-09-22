import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
    async makeProject() {
      const result = await this.call("/entries/projects", "POST", {
        title: "演示项目",
        data: { description: "目标说明" },
      });
      return result.body.id as string;
    },
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
  tasks: [{ title: "整理需求" }, { title: "搭建框架" }],
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
test("project AI requires login, model and key; input boundaries enforced", async () => {
  let calls = 0;
  const h = await harness({
    fetcher: (async () => {
      calls++;
      return Response.json({ choices: [{ message: { content: validJson } }] });
    }) as typeof fetch,
  });
  try {
    const anonymous = await fetch(`http://127.0.0.1:${h.port}/api/ai/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "", description: "说明" }),
    });
    assert.equal(anonymous.status, 401);
    assert.equal(
      (await h.call("/ai/projects", "POST", { title: "", description: "说明" })).status,
      409,
    );
    await h.call("/settings", "PUT", {
      baseUrl: "https://example.com/v1",
      model: "test",
      key: "secret",
    });
    for (const body of [
      { title: "", description: "" },
      { title: "", description: "  " },
      { title: "", description: "a".repeat(20001) },
      { title: "t".repeat(121), description: "说明" },
      { title: "", description: "说明", extra: 1 },
    ])
      assert.equal((await h.call("/ai/projects", "POST", body)).status, 400);
    assert.equal(
      (
        await h.call("/ai/projects", "POST", {
          title: "项目",
          description: "a".repeat(20000),
        })
      ).status,
      200,
    );
    assert.equal(calls, 1);
  } finally {
    await h.close();
  }
});
test("project AI contract: fenced ok, invalid rejected 502, duplicates removed, nothing persisted", async () => {
  const cases: [string, number][] = [
    [validJson, 200],
    [`\`\`\`json\n${validJson}\n\`\`\``, 200],
    ["not json", 502],
    [JSON.stringify({ tasks: [] }), 502],
    [
      JSON.stringify({
        tasks: Array.from({ length: 21 }, (_, i) => ({ title: `任务${i}` })),
      }),
      502,
    ],
    [JSON.stringify({ tasks: [{ title: "" }] }), 502],
    [JSON.stringify({ tasks: [{ title: "t".repeat(201) }] }), 502],
    [JSON.stringify({ tasks: [{ title: "任务", id: "fake" }] }), 502],
    [JSON.stringify({ tasks: [{ title: "任务" }], extra: 1 }), 502],
  ];
  for (const [content, expected] of cases) {
    const h = await configured({ fetcher: provider(content) });
    try {
      const result = await h.call("/ai/projects", "POST", {
        title: "项目",
        description: "说明",
      });
      assert.equal(result.status, expected, content.slice(0, 40));
    } finally {
      await h.close();
    }
  }
  const dupes = await configured({
    fetcher: provider(
      JSON.stringify({
        tasks: [{ title: "重复" }, { title: "重复" }, { title: "唯一" }],
      }),
    ),
  });
  try {
    const result = await dupes.call("/ai/projects", "POST", {
      title: "项目",
      description: "说明",
    });
    assert.deepEqual(result.body.tasks, [{ title: "重复" }, { title: "唯一" }]);
    assert.equal(dupes.store.list().length, 0);
    assert.equal(dupes.store.history().length, 0);
    let seen: any = null;
    const spy = await configured({
      fetcher: (async (_url, init) => {
        seen = JSON.parse(String(init?.body));
        return Response.json({ choices: [{ message: { content: validJson } }] });
      }) as typeof fetch,
    });
    try {
      await spy.call("/ai/projects", "POST", {
        title: "办公助手",
        description: "做一个工具",
      });
      assert.equal(seen.messages[0].content, officePrompts.project);
      assert.deepEqual(JSON.parse(seen.messages[1].content), {
        title: "办公助手",
        description: "做一个工具",
      });
    } finally {
      await spy.close();
    }
  } finally {
    await dupes.close();
  }
});
test("task batch: atomic single log, idempotent replay, conflict 409, restart and restore safe", async () => {
  const dir = mkdtempSync(join(tmpdir(), "office-batch-"));
  const path = join(dir, "test.sqlite");
  let h = await harness({}, path);
  try {
    const project = await h.makeProject();
    const writing = (await h.call("/entries/writing", "POST", { title: "文稿", data: {} })).body.id;
    const logsBefore = h.store.history().length;
    assert.equal(
      (
        await h.call(`/projects/${writing}/tasks/batch`, "POST", {
          requestId: "r-x",
          tasks: [{ title: "任务" }],
        })
      ).status,
      404,
    );
    assert.equal(
      (
        await h.call(`/projects/${crypto.randomUUID()}/tasks/batch`, "POST", {
          requestId: "r-y",
          tasks: [{ title: "任务" }],
        })
      ).status,
      404,
    );
    for (const body of [
      { requestId: "", tasks: [{ title: "a" }] },
      { requestId: "r1", tasks: [] },
      {
        requestId: "r1",
        tasks: Array.from({ length: 21 }, (_, i) => ({ title: `t${i}` })),
      },
      { requestId: "r1", tasks: [{ title: " " }] },
      { requestId: "r1", tasks: [{ title: "t".repeat(201) }] },
      { requestId: "r1", tasks: [{ title: "a", status: "todo" }] },
    ])
      assert.equal(
        (await h.call(`/projects/${project}/tasks/batch`, "POST", body)).status,
        400,
        JSON.stringify(body).slice(0, 50),
      );
    const created = await h.call(`/projects/${project}/tasks/batch`, "POST", {
      requestId: "r-batch-1",
      tasks: [{ title: "第一步" }, { title: "第二步" }, { title: "第三步" }],
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.replayed, false);
    assert.equal(created.body.tasks.length, 3);
    assert.ok(created.body.tasks.every((t: any) => t.status === "todo"));
    assert.equal(h.store.history().length, logsBefore + 1);
    const replay = await h.call(`/projects/${project}/tasks/batch`, "POST", {
      requestId: "r-batch-1",
      tasks: [{ title: "第一步" }, { title: "第二步" }, { title: "第三步" }],
    });
    assert.equal(replay.status, 200);
    assert.equal(replay.body.replayed, true);
    assert.deepEqual(
      replay.body.tasks.map((t: any) => t.id),
      created.body.tasks.map((t: any) => t.id),
    );
    assert.equal(h.store.history().length, logsBefore + 1);
    assert.equal(
      (
        await h.call(`/projects/${project}/tasks/batch`, "POST", {
          requestId: "r-batch-1",
          tasks: [{ title: "不同内容" }],
        })
      ).status,
      409,
    );
    assert.equal((await h.call(`/projects/${project}/tasks`)).body.length, 3);
    await h.close();
    h = await harness({}, path);
    const afterRestart = await h.call(`/projects/${project}/tasks/batch`, "POST", {
      requestId: "r-batch-1",
      tasks: [{ title: "第一步" }, { title: "第二步" }, { title: "第三步" }],
    });
    assert.equal(afterRestart.status, 200);
    assert.equal(afterRestart.body.replayed, true);
    assert.equal((await h.call(`/projects/${project}/tasks`)).body.length, 3);
    const log = h.store.history().find((l) => l.changes.some((c) => c.table === "tasks"));
    assert.ok(log);
    await h.call(`/history/${log!.id}/restore`, "POST");
    assert.equal((await h.call(`/projects/${project}/tasks`)).body.length, 0);
    const revoked = await h.call(`/projects/${project}/tasks/batch`, "POST", {
      requestId: "r-batch-1",
      tasks: [{ title: "第一步" }, { title: "第二步" }, { title: "第三步" }],
    });
    assert.equal(revoked.status, 409);
    assert.match(revoked.body.error, /回溯撤销/);
    const fresh = await h.call(`/projects/${project}/tasks/batch`, "POST", {
      requestId: "r-batch-2",
      tasks: [{ title: "第一步" }, { title: "第二步" }, { title: "第三步" }],
    });
    assert.equal(fresh.status, 201);
    assert.equal((await h.call(`/projects/${project}/tasks`)).body.length, 3);
  } finally {
    await h.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
