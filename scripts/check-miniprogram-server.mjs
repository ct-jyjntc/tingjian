// Local HTTP integration fixture. Never uses real WeChat or AI credentials.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire, registerHooks } from "node:module";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const hook = registerHooks({
  resolve(specifier, context, next) {
    return specifier === "server-only"
      ? {
          url: pathToFileURL(
            require.resolve("next/dist/compiled/server-only/empty.js"),
          ).href,
          shortCircuit: true,
        }
      : next(specifier, context);
  },
});
const directory = await mkdtemp(path.join(tmpdir(), "tingjian-http-fixture-"));
const { MiniStore } = await import("../lib/mini-store.ts");
const store = new MiniStore(path.join(directory, "study.sqlite"));
const first = store.login("fixture-app", "alice", "fixture"),
  second = store.login("fixture-app", "bob", "fixture");
let requests = 0,
  child,
  logs = "";
const fake = createServer(async (request, response) => {
  try {
    assert.equal(request.url, "/v1/chat/completions");
    let input = "";
    for await (const chunk of request) input += chunk;
    const data = JSON.parse(input);
    for (const key of [
      "max_tokens",
      "max_completion_tokens",
      "max_output_tokens",
      "reasoning_effort",
    ])
      assert.equal(key in data, false);
    requests++;
    response.setHeader("Content-Type", "application/json");
    response.end(
      JSON.stringify({
        choices: [
          {
            finish_reason: "tool_calls",
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "explain-test",
                  type: "function",
                  function: {
                    name: "present_explanation",
                    arguments: JSON.stringify({
                      title: "测试讲解",
                      summary: "这是本地测试桩返回的讲解。",
                      sections: [],
                    }),
                  },
                },
              ],
            },
          },
        ],
      }),
    );
  } catch {
    response.writeHead(500);
    response.end("fixture failure");
  }
});
const listen = (server) =>
  new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const delay = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));
try {
  await listen(fake);
  const reservation = createServer();
  await listen(reservation);
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  const admin = "fixture-admin-token-longer-than-24-characters";
  child = spawn(
    process.execPath,
    [
      require.resolve("next/dist/bin/next"),
      "start",
      "--hostname",
      "127.0.0.1",
      "--port",
      String(port),
    ],
    {
      env: {
        ...process.env,
        APP_ACCESS_TOKEN: admin,
        WECHAT_APP_ID: "wx1234567890abcdef",
        WECHAT_APP_SECRET: "fixture-secret",
        MINI_OPERATOR: "Fixture",
        MINI_CONTACT: "fixture@example.test",
        MINI_AI_PROCESSORS: "Local fixture only",
        MINI_DATABASE_FILE: path.join(directory, "study.sqlite"),
        AI_SETTINGS_FILE: path.join(directory, "ai.json"),
        LLM_BASE_URL: `http://127.0.0.1:${fake.address().port}/v1`,
        LLM_API_KEY: "fixture-model-secret",
        LLM_MODEL: "fixture-model",
        LLM_PROVIDER: "openai-compatible",
        LLM_TOOL_CHOICE: "auto",
        MINI_DAILY_CREDITS: "100",
        MINI_GLOBAL_DAILY_CREDITS: "1000",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  child.stdout.on("data", (chunk) => {
    logs += chunk;
  });
  child.stderr.on("data", (chunk) => {
    logs += chunk;
  });
  const base = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${base}/api/mini/config`);
      if (r.ok) {
        ready = true;
        break;
      }
    } catch {}
    await delay(250);
  }
  assert.ok(ready, "Next server did not start");
  const call = (endpoint, token, data, method) =>
    fetch(`${base}${endpoint}`, {
      method: method || (data === undefined ? "GET" : "POST"),
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
  assert.equal((await call("/api/mini/bootstrap")).status, 401);
  const bootstrap = await call("/api/mini/bootstrap", first.token);
  assert.equal(bootstrap.status, 200);
  assert.ok(!(await bootstrap.text()).includes("fixture-model-secret"));
  assert.equal((await call("/api/ai-settings", first.token)).status, 401);
  assert.equal((await call("/api/mini/ai-settings", first.token)).status, 404);
  assert.equal(
    (
      await call("/api/mini/data", first.token, {
        key: "draft",
        revision: 0,
        value: { title: "Alice private", items: [], materials: [] },
        userId: second.user.id,
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await call("/api/mini/data", first.token, {
        key: "draft",
        revision: 0,
        value: { title: "Alice private", items: [], materials: [] },
      })
    ).status,
    200,
  );
  assert.equal(
    (await (await call("/api/mini/data?key=draft", second.token)).json()).value,
    null,
  );
  assert.equal(
    (
      await call("/api/mini/data", first.token, {
        key: "draft",
        revision: 0,
        value: { title: "stale", items: [], materials: [] },
      })
    ).status,
    409,
  );
  const submit = await call("/api/mini/jobs", first.token, {
    requestId: "fixture-explanation",
    action: "explain",
    payload: { text: "apple" },
  });
  assert.equal(submit.status, 202);
  const { id } = await submit.json();
  assert.equal(
    (await call(`/api/mini/jobs?id=${id}`, second.token)).status,
    404,
  );
  let result;
  for (let i = 0; i < 100; i++) {
    result = await (await call(`/api/mini/jobs?id=${id}`, first.token)).json();
    if (["done", "failed"].includes(result.state)) break;
    await delay(50);
  }
  assert.equal(result.state, "done", JSON.stringify(result));
  assert.equal(result.result.explanation.title, "测试讲解");
  assert.equal(requests, 1);
  assert.equal(
    (await (await call("/api/mini/bootstrap", first.token)).json()).quota.used,
    5,
  );
  const again = await call("/api/mini/jobs", first.token, {
    requestId: "fixture-explanation",
    action: "explain",
    payload: { text: "apple" },
  });
  assert.equal((await again.json()).id, id);
  assert.equal(
    (await (await call("/api/mini/bootstrap", first.token)).json()).quota.used,
    5,
  );
  assert.equal(
    (await call("/api/mini/account-delete", first.token, { confirm: "DELETE" }))
      .status,
    200,
  );
  assert.equal((await call("/api/mini/bootstrap", first.token)).status, 401);
  assert.equal((await call("/api/mini/bootstrap", second.token)).status, 200);
  console.log(
    "PASS: production HTTP auth, admin isolation, data isolation, CAS, after() jobs, polling ownership, quota idempotency and account deletion.",
  );
  console.log(
    "AI and WeChat identities in this check are local fixtures; this is not a live WeChat login test.",
  );
} catch (error) {
  console.error(error);
  console.error(logs.slice(-3000));
  process.exitCode = 1;
} finally {
  if (child && child.exitCode === null) {
    child.kill("SIGTERM");
    await new Promise((resolve) => child.once("exit", resolve));
  }
  fake.closeAllConnections();
  await new Promise((resolve) => fake.close(resolve));
  store.close();
  hook.deregister();
  await rm(directory, { recursive: true, force: true });
}
