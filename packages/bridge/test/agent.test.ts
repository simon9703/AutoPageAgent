import assert from "node:assert/strict";
import test from "node:test";
import type { PageSnapshot } from "@auto-page-agent/shared";
import { createAgentPrompt, extractJson, extractResponsesText, normalizeDecision, OpenAIResponsesProvider, readResponsesStream } from "../src/agent.js";

const snapshot = {
  snapshotId: "snapshot-1", url: "https://example.com", title: "Example", language: "en", selectedText: "", headings: [], mainText: "", simplifiedDom: "[1]<button>Save</button>",
  pageInfo: { viewportWidth: 1000, viewportHeight: 800, pageWidth: 1000, pageHeight: 800, scrollX: 0, scrollY: 0, pixelsAbove: 0, pixelsBelow: 0 },
  elements: [{ ref: "element-1", tagName: "button", role: "button", label: "Save", text: "Save", selector: "button", disabled: false, sensitive: false, contentEditable: false, viewportRect: { x: 0, y: 0, width: 10, height: 10 } }],
  performance: { resources: [], apiRequests: [], summary: { requestCount: 0, totalTransferSize: 0, slowRequestCount: 0 } },
} satisfies PageSnapshot;

test("extractJson supports fenced model output", () => {
  assert.deepEqual(extractJson("```json\n{\"kind\":\"answer\",\"content\":\"ok\"}\n```"), { kind: "answer", content: "ok" });
});

test("normalizeDecision rejects filling sensitive fields", () => {
  const sensitiveSnapshot = { ...snapshot, elements: [{ ...snapshot.elements[0], sensitive: true }] };
  const result = normalizeDecision({ kind: "action_plan", steps: [{ action: "fill", targetRef: "element-1", value: "secret" }] }, sensitiveSnapshot);
  assert.deepEqual(result, { kind: "blocked", reason: "No safe action could be matched to the current page.", recoverable: true });
});

test("normalizeDecision rejects invented element refs", () => {
  const result = normalizeDecision({ kind: "action_plan", steps: [{ action: "click", targetRef: "element-99" }] }, snapshot);
  assert.equal(result.kind, "blocked");
});

test("normalizeDecision requires evidence before completing a browser task", () => {
  assert.equal(normalizeDecision({ kind: "complete", summary: "Done" }, snapshot).kind, "blocked");
  assert.deepEqual(
    normalizeDecision({ kind: "complete", summary: "BTC details opened", evidence: ["Heading BTC is visible"] }, snapshot),
    { kind: "complete", summary: "BTC details opened", evidence: ["Heading BTC is visible"] },
  );
});

test("normalizeDecision keeps blocked and needs-user states distinct from answers", () => {
  assert.deepEqual(
    normalizeDecision({ kind: "blocked", reason: "Login required", recoverable: false }, snapshot),
    { kind: "blocked", reason: "Login required", recoverable: false },
  );
  assert.deepEqual(
    normalizeDecision({ kind: "needs_user", question: "Which account?" }, snapshot),
    { kind: "needs_user", question: "Which account?" },
  );
});

test("normalizeDecision binds the current snapshot and requires confirmation", () => {
  const result = normalizeDecision({ kind: "action_plan", confidence: 0.9, steps: [{ action: "click", targetRef: "element-1" }] }, snapshot);
  assert.equal(result.kind, "action_plan");
  if (result.kind === "action_plan") {
    assert.equal(result.snapshotId, "snapshot-1");
    assert.equal(result.requiresConfirmation, true);
  }
});

test("V2 planner accepts only one action before re-observation", () => {
  const result = normalizeDecision({ kind: "action_plan", steps: [
    { action: "focus", targetRef: "element-1" },
    { action: "click", targetRef: "element-1" },
  ] }, snapshot);
  assert.equal(result.kind, "action_plan");
  if (result.kind === "action_plan") assert.equal(result.steps.length, 1);
});

test("Responses SSE emits text deltas and returns the completed response id", async () => {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({ start(controller) {
    controller.enqueue(encoder.encode('event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"{\\"kind\\":\\"answer\\","}\n\n'));
    controller.enqueue(encoder.encode('event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"\\"content\\":\\"ok\\"}"}\n\n'));
    controller.enqueue(encoder.encode('event: response.completed\ndata: {"type":"response.completed","response":{"id":"resp-1"}}\n\n'));
    controller.close();
  } });
  const events: string[] = [];
  const streamed = await readResponsesStream(new Response(body, { headers: { "content-type": "text/event-stream" } }), (event) => {
    if (event.type === "thinking") events.push(event.content);
  });
  assert.equal(streamed.text, '{"kind":"answer","content":"ok"}');
  assert.equal(streamed.responseId, "resp-1");
  assert.equal(events.length, 2);
});

test("Responses API provider sends selected images and parses structured output", async () => {
  let requestBody: Record<string, unknown> | undefined;
  const provider = new OpenAIResponsesProvider({
    apiKey: "test-key",
    model: "test-model",
    fetchImpl: (async (_input, init) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({ output_text: '{"kind":"answer","content":"image understood"}' }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch,
  });
  const decision = await provider.run("Describe the selected image", {
    ...snapshot,
    context: { selectedElement: { tagName: "img", role: "img", label: "Chart", text: "", attributes: {}, nearbyText: "", image: { src: "https://example.com/chart.png", alt: "Chart", width: 400, height: 200 } } },
  }, { conversationId: "conversation-1", history: [] });
  assert.deepEqual(decision, { kind: "answer", content: "image understood" });
  assert.match(JSON.stringify(requestBody), /input_image/u);
  assert.equal(requestBody?.model, "test-model");
});

test("Responses API provider sends a selected viewport screenshot without embedding it in the text prompt", async () => {
  let requestBody = "";
  const provider = new OpenAIResponsesProvider({
    apiKey: "test-key",
    fetchImpl: (async (_input, init) => {
      requestBody = String(init?.body);
      return new Response(JSON.stringify({ output_text: '{"kind":"answer","content":"screenshot understood"}' }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch,
  });
  const screenshotData = "data:image/jpeg;base64,c2NyZWVuc2hvdA==";
  const decision = await provider.run("Describe the screenshot", { ...snapshot, context: { screenshot: { dataUrl: screenshotData, title: "Viewport", url: snapshot.url } } }, { conversationId: "screenshot-1", history: [] });
  assert.deepEqual(decision, { kind: "answer", content: "screenshot understood" });
  const request = JSON.parse(requestBody) as { input: Array<{ content: Array<Record<string, unknown>> }> };
  assert.equal(request.input[0]?.content.some((item) => item.type === "input_image" && item.image_url === screenshotData), true);
  const text = String(request.input[0]?.content.find((item) => item.type === "input_text")?.text ?? "");
  assert.doesNotMatch(text, /c2NyZWVuc2hvdA/u);
  assert.match(text, /Viewport/u);
});

test("Responses API provider prefers a cropped screenshot over selected image metadata", async () => {
  let requestBody = "";
  const provider = new OpenAIResponsesProvider({
    apiKey: "test-key",
    fetchImpl: (async (_input, init) => {
      requestBody = String(init?.body);
      return new Response(JSON.stringify({ output_text: '{"kind":"answer","content":"crop understood"}' }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch,
  });
  const crop = "data:image/jpeg;base64,Y3JvcA==";
  await provider.run("Describe the selection", {
    ...snapshot,
    context: {
      selectedElement: { tagName: "img", role: "img", label: "Chart", text: "", attributes: {}, nearbyText: "", image: { src: "https://example.com/original.png", alt: "Chart", width: 400, height: 200 } },
      screenshot: { dataUrl: crop, title: "Selected element", url: snapshot.url },
    },
  }, { conversationId: "screenshot-priority", history: [] });

  const request = JSON.parse(requestBody) as { input: Array<{ content: Array<Record<string, unknown>> }> };
  const image = request.input[0]?.content.find((item) => item.type === "input_image");
  assert.equal(image?.image_url, crop);
});

test("Responses API provider chains turns by conversation", async () => {
  const bodies: Array<Record<string, unknown>> = [];
  let call = 0;
  const provider = new OpenAIResponsesProvider({
    apiKey: "test-key",
    model: "test-model",
    fetchImpl: (async (_input, init) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      call += 1;
      return new Response(JSON.stringify({ id: `response-${call}`, output_text: '{"kind":"answer","content":"ok"}' }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch,
  });

  await provider.run("First turn", snapshot, { conversationId: "conversation-1", history: [] });
  await provider.run("Second turn", snapshot, { conversationId: "conversation-1", history: [] });
  await provider.run("Separate chat", snapshot, { conversationId: "conversation-2", history: [] });

  assert.equal(bodies[0]?.previous_response_id, undefined);
  assert.equal(bodies[1]?.previous_response_id, "response-1");
  assert.equal(bodies[2]?.previous_response_id, undefined);
});

test("Responses API provider reset starts a fresh conversation chain", async () => {
  const bodies: Array<Record<string, unknown>> = [];
  let call = 0;
  const provider = new OpenAIResponsesProvider({
    apiKey: "test-key",
    fetchImpl: (async (_input, init) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      call += 1;
      return new Response(JSON.stringify({ id: `response-${call}`, output_text: '{"kind":"answer","content":"ok"}' }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch,
  });

  await provider.run("First turn", snapshot, { conversationId: "conversation-reset", history: [] });
  provider.reset("conversation-reset");
  await provider.run("Fresh turn", snapshot, { conversationId: "conversation-reset", history: [] });

  assert.equal(bodies[0]?.previous_response_id, undefined);
  assert.equal(bodies[1]?.previous_response_id, undefined);
});

test("Responses output and conversation history parsing is bounded", () => {
  assert.equal(extractResponsesText({ output: [{ content: [{ type: "output_text", text: "hello" }] }] }), "hello");
  const prompt = createAgentPrompt("continue", snapshot, [], [{ id: "1", role: "user", content: "prior", createdAt: new Date().toISOString() }]);
  assert.match(prompt, /Recent conversation:\nuser: prior/u);
  assert.doesNotMatch(prompt, /"elements":/u);
  assert.match(prompt, /simplifiedDom/u);
});
