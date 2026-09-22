import test from "node:test";
import { request } from "node:http";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { complete, ApiError, prompts } from "../server/ai.js";
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
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
        ...headers,
      },
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
test("all four kinds persist, update, delete, and tasks cascade without touching other projects", async () => {
  const dir = mkdtempSync(join(tmpdir(), "office-db-"));
  const path = join(dir, "test.sqlite");
  let h = await harness({}, path);
  try {
    const ids: string[] = [];
    for (const kind of ["writing", "meetings", "documents", "projects"]) {
      let result = await h.call(`/entries/${kind}`, "POST", {
        title: kind,
        data: { notes: "测试" },
      });
      assert.equal(result.status, 201);
      ids.push(result.body.id);
      result = await h.call(`/entries/${result.body.id}`, "PUT", {
        title: `${kind}已修改`,
        data: { notes: "保留内容" },
      });
      assert.equal(result.body.data.notes, "保留内容");
    }
    const project = ids[3];
    const task = await h.call(`/projects/${project}/tasks`, "POST", {
      title: "任务",
      status: "todo",
    });
    assert.equal(task.status, 201);
    for (const status of ["doing", "done"]) {
      const result = await h.call(`/projects/${project}/tasks/${task.body.id}`, "PUT", {
        title: "修改任务",
        status,
      });
      assert.equal(result.body.status, status);
    }
    assert.equal(
      (
        await h.call(`/projects/${ids[0]}/tasks`, "POST", {
          title: "坏任务",
          status: "todo",
        })
      ).status,
      404,
    );
    await h.close();
    h = await harness({}, path);
    assert.equal((await h.call("/entries")).body.length, 4);
    assert.equal((await h.call(`/projects/${project}/tasks`)).body[0].status, "done");
    await h.call(`/entries/${project}`, "DELETE");
    assert.equal(h.store.db.prepare("SELECT COUNT(*) as count FROM tasks").get()?.count, 0);
    for (const id of ids.slice(0, 3)) await h.call(`/entries/${id}`, "DELETE");
    assert.equal((await h.call("/entries")).body.length, 0);
  } finally {
    await h.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("keys never persist or read back; restart forgets key but retains settings", async () => {
  const dir = mkdtempSync(join(tmpdir(), "office-key-"));
  const path = join(dir, "test.sqlite");
  let h = await harness({}, path);
  const secret = "TEST_SECRET_NEVER_PERSIST";
  try {
    assert.equal(
      (
        await h.call("/ai/generate", "POST", {
          input: "hello",
          mode: "compose",
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await h.call("/settings", "PUT", {
          baseUrl: "https://example.com/v1",
          model: "test",
          key: secret,
        })
      ).body.hasKey,
      true,
    );
    assert.ok(!JSON.stringify((await h.call("/settings")).body).includes(secret));
    assert.equal(
      (
        await h.call("/settings", "PUT", {
          baseUrl: "https://example.com/v1",
          model: "test",
        })
      ).body.hasKey,
      true,
    );
    await h.close();
    assert.ok(!readFileSync(path).includes(Buffer.from(secret)));
    h = await harness({}, path);
    const config = (await h.call("/settings")).body;
    assert.equal(config.model, "test");
    assert.equal(config.hasKey, false);
    await h.call("/settings", "PUT", {
      baseUrl: "https://example.com/v1",
      model: "test",
      key: secret,
    });
    assert.equal((await h.call("/settings/key", "DELETE")).body.hasKey, false);
  } finally {
    await h.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("validation and local request protection", async () => {
  const h = await harness();
  try {
    assert.equal((await h.call("/entries/writing", "POST", { title: "", data: {} })).status, 400);
    assert.equal((await h.call("/entries/unknown", "POST", { title: "x", data: {} })).status, 400);
    assert.equal(
      (
        await h.call("/entries/writing", "POST", {
          title: "x",
          data: { source: "a".repeat(50001) },
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await h.call(
          "/entries/writing",
          "POST",
          { title: "x", data: {} },
          { Origin: "https://evil.example" },
        )
      ).status,
      403,
    );
    const hostStatus = await new Promise<number | undefined>((resolve, reject) => {
      const req = request(
        {
          host: "127.0.0.1",
          port: h.port,
          path: "/api/entries",
          headers: { Host: "evil.example" },
        },
        (res) => {
          res.resume();
          resolve(res.statusCode);
        },
      );
      req.on("error", reject);
      req.end();
    });
    assert.equal(hostStatus, 403);
    for (const url of [
      "http://remote.example/v1",
      "https://user:secret@example.com/v1",
      "https://example.com/v1?key=secret",
    ])
      assert.equal((await h.call("/settings", "PUT", { baseUrl: url, model: "x" })).status, 400);
  } finally {
    await h.close();
  }
});
test("all writing modes use the correct prompt; no retries; errors are safe", async () => {
  const provider = {
    baseUrl: "https://example.com/v1/",
    model: "model",
    key: "secret",
  };
  for (const mode of ["compose", "polish", "summary"] as const) {
    let calls = 0;
    const output = await complete(provider, "input", mode, (async (url, init) => {
      calls++;
      assert.equal(url, "https://example.com/v1/chat/completions");
      const body = JSON.parse(String(init?.body));
      assert.equal(body.messages[0].content, prompts[mode]);
      assert.equal(body.messages[1].content, "input");
      return Response.json({ choices: [{ message: { content: "result" } }] });
    }) as typeof fetch);
    assert.equal(output, "result");
    assert.equal(calls, 1);
  }
  for (const status of [401, 403, 404, 400, 429, 500]) {
    let calls = 0;
    await assert.rejects(
      () =>
        complete(provider, "x", "compose", (async () => {
          calls++;
          return new Response("upstream secret", { status });
        }) as typeof fetch),
      (e: unknown) => e instanceof ApiError && !e.message.includes("secret"),
    );
    assert.equal(calls, 1);
  }
  await assert.rejects(
    () =>
      complete(provider, "x", "compose", (async () =>
        Response.json({ choices: [] })) as typeof fetch),
    /有效文本/,
  );
  await assert.rejects(
    () =>
      complete(provider, "x", "compose", (async () => {
        throw Error("private error");
      }) as typeof fetch),
    /无法连接/,
  );
  await assert.rejects(
    () =>
      complete(
        provider,
        "x",
        "compose",
        ((_url, init) =>
          new Promise((_resolve, reject) =>
            init?.signal?.addEventListener("abort", () => reject(Error("aborted"))),
          )) as typeof fetch,
        10,
      ),
    /超时/,
  );
});
test("duplicate AI submissions rejected; settings locked while in flight; server recovers", async () => {
  let release: () => void = () => {};
  let started: () => void = () => {};
  const begun = new Promise<void>((r) => (started = r));
  let calls = 0;
  const h = await harness({
    fetcher: (async () => {
      calls++;
      started();
      await new Promise<void>((r) => (release = r));
      return Response.json({ choices: [{ message: { content: "success" } }] });
    }) as typeof fetch,
  });
  try {
    await h.call("/settings", "PUT", {
      baseUrl: "https://example.com/v1",
      model: "test",
      key: "secret",
    });
    const first = h.call("/ai/generate", "POST", {
      mode: "compose",
      input: "x",
    });
    await begun;
    assert.equal(
      (await h.call("/ai/generate", "POST", { mode: "compose", input: "x" })).status,
      409,
    );
    assert.equal((await h.call("/settings/key", "DELETE")).status, 409);
    release();
    assert.equal((await first).body.output, "success");
    assert.equal(calls, 1);
    assert.equal((await h.call("/settings/key", "DELETE")).status, 200);
  } finally {
    release();
    await h.close();
  }
});
