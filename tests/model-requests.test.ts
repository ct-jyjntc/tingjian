import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createRequire, registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
import { newItem } from "../lib/types";

// Use the same empty marker that Next.js supplies to server components.
const require = createRequire(import.meta.url);
const serverOnly = pathToFileURL(
  require.resolve("next/dist/compiled/server-only/empty.js"),
).href;
const hook = registerHooks({
  resolve(specifier, context, nextResolve) {
    return specifier === "server-only"
      ? { url: serverOnly, shortCircuit: true }
      : nextResolve(specifier, context);
  },
});
const configuration = {
  AI_SETTINGS_FILE: `/tmp/tingjian-model-requests-${process.pid}.json`,
  LLM_BASE_URL: "https://model.test/v1",
  LLM_API_KEY: "test-key",
  LLM_MODEL: "test-model",
  LLM_PROVIDER: "openai-compatible",
  LLM_TOOL_CHOICE: "required",
  VISION_BASE_URL: "https://vision.test/v1",
  VISION_API_KEY: "test-key",
  VISION_MODEL: "test-vision",
  LLM_REASONING_EFFORT: "none",
};
const previous = Object.fromEntries(
  Object.keys(configuration).map((key) => [key, process.env[key]]),
);
before(() => Object.assign(process.env, configuration));
after(() => {
  hook.deregister();
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function assertProviderDefaults(body: Record<string, unknown>) {
  for (const parameter of [
    "max_tokens",
    "max_completion_tokens",
    "max_output_tokens",
    "reasoning_effort",
  ]) {
    assert.equal(Object.hasOwn(body, parameter), false, parameter);
  }
}

test("text and vision requests leave output and reasoning budgets to the provider", async (t) => {
  const { chat } = await import("../lib/server");
  const longContent = "完整输出。".repeat(5000);
  const requests: Record<string, unknown>[] = [];
  t.mock.method(
    globalThis,
    "fetch",
    async (_url: unknown, init: RequestInit) => {
      requests.push(JSON.parse(String(init.body)));
      return Response.json({
        choices: [{ finish_reason: "stop", message: { content: longContent } }],
      });
    },
  );
  for (const prefix of ["LLM", "VISION"]) {
    assert.equal(
      await chat(prefix, [{ role: "user", content: "test" }], true),
      longContent,
    );
  }
  assert.equal(requests.length, 2);
  for (const request of requests) {
    assertProviderDefaults(request);
    assert.deepEqual(request.response_format, { type: "json_object" });
  }
});

test("every assistant turn omits output caps in extraction and generation modes", async (t) => {
  const { runLearningAgent } = await import("../lib/agent-server");
  const requests: Record<string, unknown>[] = [];
  t.mock.method(
    globalThis,
    "fetch",
    async (_url: unknown, init: RequestInit) => {
      requests.push(JSON.parse(String(init.body)));
      const inspect = requests.length % 2 === 1;
      return Response.json({
        choices: [
          {
            finish_reason: "tool_calls",
            message: {
              role: "assistant",
              content: "已查看材料。".repeat(1000),
              reasoning_content: "test-only tool reasoning",
              tool_calls: [
                {
                  id: `call-${requests.length}`,
                  type: "function",
                  function: {
                    name: inspect ? "inspect_material" : "prepare_dictation",
                    arguments: JSON.stringify(
                      inspect
                        ? { detail: "full" }
                        : { scope: "current", mode: "words" },
                    ),
                  },
                },
              ],
            },
          },
        ],
      });
    },
  );
  for (const mode of ["original", "generate"] as const) {
    const result = await runLearningAgent(
      {
        instruction: "逐词整理",
        items: [newItem("spring")],
        materials: [],
        sources: [],
        mode,
      },
      new AbortController().signal,
    );
    assert.deepEqual(
      result.proposal?.map((item) => item.spoken),
      ["spring"],
    );
  }
  assert.equal(requests.length, 4);
  requests.forEach(assertProviderDefaults);
  const secondTurn = requests[1].messages as {
    role: string;
    reasoning_content?: string;
  }[];
  assert.equal(
    secondTurn.find((message) => message.role === "assistant")
      ?.reasoning_content,
    "test-only tool reasoning",
  );
});

test("provider-truncated results are rejected before they can become an applied draft", async (t) => {
  const { chat, ServiceError } = await import("../lib/server");
  const { runLearningAgent, AgentServiceError } =
    await import("../lib/agent-server");
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({
      choices: [{ finish_reason: "length", message: { content: "partial" } }],
    }),
  );
  await assert.rejects(
    chat("LLM", []),
    (error: unknown) => error instanceof ServiceError && error.status === 502,
  );
  const items = [newItem("spring")];
  const before = structuredClone(items);
  await assert.rejects(
    runLearningAgent(
      {
        instruction: "整理",
        items,
        materials: [],
        sources: [],
        mode: "original",
      },
      new AbortController().signal,
    ),
    (error: unknown) =>
      error instanceof AgentServiceError && error.status === 502,
  );
  assert.deepEqual(items, before);
});

test("conversation agent uses tool calls and preserves provider output defaults", async (t) => {
  const { runSessionAgent } = await import("../lib/session-agent-server");
  const { sessionContext } = await import("../lib/session-agent");
  const { defaults } = await import("../lib/types");
  let body: Record<string, unknown> = {};
  t.mock.method(
    globalThis,
    "fetch",
    async (_url: unknown, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      return Response.json({
        choices: [
          {
            finish_reason: "tool_calls",
            message: {
              tool_calls: [
                {
                  id: "call-1",
                  type: "function",
                  function: {
                    name: "control_dictation",
                    arguments: JSON.stringify({
                      command: "repeat",
                      message: "再读一次。",
                    }),
                  },
                },
              ],
            },
          },
        ],
      });
    },
  );
  const context = sessionContext({
    id: "test",
    items: [newItem("ran")],
    index: 0,
    round: 2,
    phase: "waiting",
    settings: defaults,
    started: 1,
  });
  const result = await runSessionAgent(
    {
      text: "刚才没跟上",
      context,
      history: [{ role: "user", content: "慢一点好吗" }],
    },
    new AbortController().signal,
  );
  assert.equal(result.type, "control");
  if (result.type === "control") assert.equal(result.command, "repeat");
  assertProviderDefaults(body);
  assert.ok(JSON.stringify(body.messages).includes("慢一点好吗"));
  assert.ok(!JSON.stringify(body.messages).includes('"answer":"ran"'));
  assert.equal(body.tool_choice, "required");
});

test("conversation agent refuses invalid, multiple and unavailable tools", async (t) => {
  const { runSessionAgent } = await import("../lib/session-agent-server");
  const { sessionContext } = await import("../lib/session-agent");
  const { defaults } = await import("../lib/types");
  const context = sessionContext({
    id: "test",
    items: [newItem("ran")],
    index: 0,
    round: 2,
    phase: "paused",
    settings: { ...defaults, allowHints: false },
    started: 1,
  });
  let calls: unknown[] = [];
  t.mock.method(
    globalThis,
    "fetch",
    async (_url: unknown, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      assertProviderDefaults(body);
      assert.ok(!JSON.stringify(body.tools).includes("explain_current_item"));
      assert.ok(!JSON.stringify(body.messages).includes('"answer":"ran"'));
      return Response.json({
        choices: [
          { finish_reason: "tool_calls", message: { tool_calls: calls } },
        ],
      });
    },
  );
  for (const [name, args] of [
    ["control_dictation", { command: "next", message: "下一项" }],
    ["control_dictation", { command: "delete_data", message: "清除" }],
    ["explain_current_item", { question: "答案是什么" }],
  ] as const) {
    calls = [
      {
        id: "test",
        type: "function",
        function: { name, arguments: JSON.stringify(args) },
      },
    ];
    await assert.rejects(
      runSessionAgent(
        { text: "测试", context, history: [] },
        new AbortController().signal,
      ),
    );
  }
  calls = [1, 2].map((i) => ({
    id: `test-${i}`,
    type: "function",
    function: {
      name: "control_dictation",
      arguments: '{"command":"repeat","message":"重读"}',
    },
  }));
  await assert.rejects(
    runSessionAgent(
      { text: "测试", context, history: [] },
      new AbortController().signal,
    ),
  );
});

test("explanations consume structured tool output and tolerate ordinary final prose", async (t) => {
  const { explainCurrentItem } = await import("../lib/session-agent-server");
  let structured = true;
  t.mock.method(
    globalThis,
    "fetch",
    async (_url: unknown, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      assertProviderDefaults(body);
      assert.equal(body.tool_choice, "required");
      return Response.json({
        choices: [
          {
            finish_reason: structured ? "tool_calls" : "stop",
            message: {
              reasoning: "private reasoning must never be shown",
              content: structured ? "" : "**记忆提示：** 反复比较词形。",
              ...(structured
                ? {
                    tool_calls: [
                      {
                        type: "function",
                        function: {
                          name: "present_explanation",
                          arguments: JSON.stringify({
                            title: "词形",
                            summary: "run—ran—run",
                            sections: [{ label: "例句", text: "I have run." }],
                          }),
                        },
                      },
                    ],
                  }
                : {}),
            },
          },
        ],
      });
    },
  );
  const result = await explainCurrentItem(
    "ran",
    "它的过去分词？",
    [],
    new AbortController().signal,
  );
  assert.equal(result.summary, "run—ran—run");
  assert.ok(!JSON.stringify(result).includes("private reasoning"));
  structured = false;
  const fallback = await explainCurrentItem(
    "ran",
    "解释",
    [],
    new AbortController().signal,
  );
  assert.equal(fallback.summary, "记忆提示： 反复比较词形。");
  assert.ok(!JSON.stringify(fallback).includes("private reasoning"));
});

test("automatic tool selection preserves thinking-provider compatibility without executing prose", async (t) => {
  const { runSessionAgent } = await import("../lib/session-agent-server");
  const { sessionContext } = await import("../lib/session-agent");
  const { defaults } = await import("../lib/types");
  const previous = process.env.LLM_TOOL_CHOICE;
  process.env.LLM_TOOL_CHOICE = "auto";
  t.mock.method(
    globalThis,
    "fetch",
    async (_url: unknown, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      assert.equal(body.tool_choice, "auto");
      assertProviderDefaults(body);
      return Response.json({
        choices: [
          {
            finish_reason: "stop",
            message: {
              content: "我们慢慢来。",
              reasoning_content: "private reasoning",
            },
          },
        ],
      });
    },
  );
  try {
    const context = sessionContext({
      id: "test",
      items: [newItem("ran")],
      index: 0,
      round: 2,
      phase: "waiting",
      settings: defaults,
      started: 1,
    });
    const reply = await runSessionAgent(
      { text: "你好", context, history: [] },
      new AbortController().signal,
    );
    assert.equal(reply.type, "reply");
    assert.ok(reply.message.includes("进度保持不变"));
    assert.ok(!JSON.stringify(reply).includes("private reasoning"));
  } finally {
    if (previous === undefined) delete process.env.LLM_TOOL_CHOICE;
    else process.env.LLM_TOOL_CHOICE = previous;
  }
});
