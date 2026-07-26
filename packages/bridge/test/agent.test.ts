import assert from "node:assert/strict";
import test from "node:test";
import type { PageSnapshot } from "@auto-page-agent/shared";
import { completionEvidenceMatchesSnapshot, createAgentPrompt, extractJson, extractResponsesText, normalizeDecision, OpenAIResponsesProvider, readResponsesStream } from "../src/agent.js";

const snapshot = {
  snapshotId: "snapshot-1", url: "https://example.com", title: "Example", language: "en", selectedText: "", headings: [], mainText: "", simplifiedDom: "[1]<button>Save</button>",
  pageInfo: { viewportWidth: 1000, viewportHeight: 800, pageWidth: 1000, pageHeight: 800, scrollX: 0, scrollY: 0, pixelsAbove: 0, pixelsBelow: 0 },
  elements: [{
    ref: "element-1",
    tagName: "button",
    role: "button",
    label: "Save",
    text: "Save",
    selector: "button",
    disabled: false,
    sensitive: false,
    contentEditable: false,
    fingerprint: "save-button-1",
    inViewport: true,
    occluded: false,
    readonly: false,
    viewportRect: { x: 0, y: 0, width: 10, height: 10 },
  }],
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

test("readonly combobox can be clicked but cannot be filled or selected", () => {
  const comboboxSnapshot = {
    ...snapshot,
    elements: [{
      ...snapshot.elements[0],
      tagName: "input",
      role: "combobox",
      label: "Site",
      text: "",
      readonly: true,
      controls: "site-list",
    }],
  };
  assert.equal(normalizeDecision({
    kind: "action_plan",
    steps: [{ action: "click", targetRef: "element-1" }],
  }, comboboxSnapshot).kind, "action_plan");
  for (const action of ["fill", "select"] as const) {
    assert.equal(normalizeDecision({
      kind: "action_plan",
      steps: [{ action, targetRef: "element-1", value: "global" }],
    }, comboboxSnapshot).kind, "blocked");
  }
});

test("readonly ordinary input remains observable but cannot be filled", () => {
  const readonlyInput = {
    ...snapshot,
    elements: [{
      ...snapshot.elements[0],
      tagName: "input",
      role: "textbox",
      label: "Generated id",
      text: "",
      readonly: true,
    }],
  };
  assert.equal(normalizeDecision({
    kind: "action_plan",
    steps: [{ action: "click", targetRef: "element-1" }],
  }, readonlyInput).kind, "action_plan");
  assert.equal(normalizeDecision({
    kind: "action_plan",
    steps: [{ action: "fill", targetRef: "element-1", value: "replacement" }],
  }, readonlyInput).kind, "blocked");
});

test("custom combobox rejects fill/select while native select remains supported", () => {
  const customCombobox = {
    ...snapshot,
    elements: [{
      ...snapshot.elements[0],
      tagName: "input",
      role: "combobox",
      label: "Project",
      text: "",
    }],
  };
  assert.equal(normalizeDecision({
    kind: "action_plan",
    steps: [{ action: "fill", targetRef: "element-1", value: "cloud" }],
  }, customCombobox).kind, "blocked");
  assert.equal(normalizeDecision({
    kind: "action_plan",
    steps: [{ action: "select", targetRef: "element-1", value: "cloud" }],
  }, customCombobox).kind, "blocked");

  const nativeSelect = {
    ...snapshot,
    elements: [{
      ...snapshot.elements[0],
      tagName: "select",
      role: "combobox",
      label: "Project",
      text: "",
    }],
  };
  assert.equal(normalizeDecision({
    kind: "action_plan",
    steps: [{ action: "select", targetRef: "element-1", value: "cloud" }],
  }, nativeSelect).kind, "action_plan");
});

test("normalizeDecision rejects invented element refs", () => {
  const result = normalizeDecision({ kind: "action_plan", steps: [{ action: "click", targetRef: "element-99" }] }, snapshot);
  assert.equal(result.kind, "blocked");
});

test("normalizeDecision requires evidence before completing a browser task", () => {
  assert.deepEqual(normalizeDecision({ kind: "complete", summary: "Done" }, snapshot), {
    kind: "blocked",
    reason: "The agent claimed completion without current page evidence.",
    recoverable: true,
    code: "completion_evidence_missing",
    unmatchedEvidence: [],
  });
  assert.deepEqual(
    normalizeDecision({ kind: "complete", summary: "The save control is visible", evidence: ["Save"] }, snapshot),
    { kind: "complete", summary: "The save control is visible", evidence: ["Save"] },
  );
  assert.deepEqual(normalizeDecision(
    { kind: "complete", summary: "BTC details opened", evidence: ["BTC details", "Save"] },
    snapshot,
  ), {
    kind: "blocked",
    reason: "The agent claimed completion with evidence that is not present in the current page snapshot.",
    recoverable: true,
    code: "completion_evidence_missing",
    unmatchedEvidence: ["BTC details"],
  });
});

test("completion evidence must be copied from the latest snapshot", () => {
  assert.equal(completionEvidenceMatchesSnapshot("https://example.com", snapshot), true);
  assert.equal(completionEvidenceMatchesSnapshot("Save", snapshot), true);
  assert.equal(completionEvidenceMatchesSnapshot("Payment succeeded", snapshot), false);
  assert.equal(completionEvidenceMatchesSnapshot("global", {
    ...snapshot,
    elements: [{ ...snapshot.elements[0], displayValue: "global", selectedValues: ["global"] }],
  }), true);
});

test("unselected popup option text is not completion evidence", () => {
  const optionSnapshot = {
    ...snapshot,
    mainText: "cloud kucoin-cloud-mining-rn",
    simplifiedDom: '[1]<div role="option">kucoin-cloud-mining-rn</div>',
    elements: [{
      ...snapshot.elements[0],
      role: "option",
      label: "kucoin-cloud-mining-rn",
      text: "kucoin-cloud-mining-rn",
      selected: false,
    }],
  };
  assert.equal(completionEvidenceMatchesSnapshot("kucoin-cloud-mining-rn", optionSnapshot), false);
  assert.equal(completionEvidenceMatchesSnapshot("kucoin-cloud-mining-rn", {
    ...optionSnapshot,
    elements: [{ ...optionSnapshot.elements[0], selected: true }],
  }), true);
  assert.equal(completionEvidenceMatchesSnapshot("Deployment succeeded", {
    ...optionSnapshot,
    mainText: "Deployment succeeded",
    simplifiedDom: "<EMPTY>",
  }), true);
});

test("normalizeDecision keeps blocked and needs-user states distinct from answers", () => {
  assert.deepEqual(
    normalizeDecision({ kind: "blocked", reason: "Login required", recoverable: false }, snapshot),
    { kind: "blocked", reason: "Login required", recoverable: false },
  );
  assert.deepEqual(
    normalizeDecision({
      kind: "needs_user",
      question: "Which account?",
      options: ["Personal", "Business", "Personal", ""],
      recommendedOption: "Business",
    }, snapshot),
    {
      kind: "needs_user",
      question: "Which account?",
      options: ["Personal", "Business"],
      recommendedOption: "Business",
    },
  );
  assert.deepEqual(
    normalizeDecision({ kind: "needs_user", question: "Which account?", options: ["Personal"], recommendedOption: "Unknown" }, snapshot),
    { kind: "needs_user", question: "Which account?", options: ["Personal"] },
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

test("planner keeps all safe steps and attaches trusted target fingerprints", () => {
  const result = normalizeDecision({ kind: "action_plan", steps: [
    { action: "focus", targetRef: "element-1" },
    { action: "click", targetRef: "element-1" },
  ] }, snapshot);
  assert.equal(result.kind, "action_plan");
  if (result.kind === "action_plan") {
    assert.equal(result.steps.length, 2);
    assert.deepEqual(result.steps.map((step) => step.targetFingerprint), [
      "save-button-1",
      "save-button-1",
    ]);
  }
});

test("planner rejects oversized or partially invalid plans instead of truncating them", () => {
  const oversized = normalizeDecision({
    kind: "action_plan",
    steps: Array.from({ length: 9 }, () => ({ action: "click", targetRef: "element-1" })),
  }, snapshot);
  assert.equal(oversized.kind, "blocked");
  if (oversized.kind === "blocked") assert.match(oversized.reason, /8-action task budget/u);

  const partiallyInvalid = normalizeDecision({
    kind: "action_plan",
    steps: [
      { action: "click", targetRef: "element-1" },
      { action: "click", targetRef: "invented-ref" },
    ],
  }, snapshot);
  assert.equal(partiallyInvalid.kind, "blocked");
  if (partiallyInvalid.kind === "blocked") assert.match(partiallyInvalid.reason, /without partial execution/u);
});

test("submit on a button is normalized to a click", () => {
  const result = normalizeDecision({
    kind: "action_plan",
    steps: [{ action: "submit", targetRef: "element-1", reason: "Top Up 100 USDT" }],
  }, snapshot);
  assert.equal(result.kind, "action_plan");
  if (result.kind === "action_plan") assert.equal(result.steps[0]?.action, "click");
});

test("agent prompt authorizes the requested test flow while preserving runtime boundaries", () => {
  const prompt = createAgentPrompt("Submit the test order", snapshot, []);
  assert.match(prompt, /user-authorized automation test/u);
  assert.match(prompt, /fill amounts, submit test orders/u);
  assert.match(prompt, /Do not refuse merely because/u);
  assert.match(prompt, /runtime confirmation card is the user's confirmation/u);
  assert.match(prompt, /latest-snapshot validation/u);
  assert.match(prompt, /Readonly and custom role=combobox controls cannot use fill or select/u);
  assert.match(prompt, /Click the combobox to expand it/u);
  assert.match(prompt, /fresh snapshot/u);
  assert.match(prompt, /Use select only for a native select element/u);
  assert.match(prompt, /Use click for buttons and button-like controls/u);
  assert.match(prompt, /Use submit only when targetRef is the native form element itself/u);
  assert.match(prompt, /final combobox value or selected label\/tag/u);
  assert.match(prompt, /complete ordered action sequence/u);
  assert.match(prompt, /one confirmation card/u);
  assert.match(prompt, /completionEvidenceFailure/u);
  assert.match(prompt, /never repeat unsupported completion evidence/u);
  assert.match(prompt, /"options":\["\.\.\."\]/u);
});

test("completion evidence recovery tells the agent to verify instead of repeating completion", () => {
  const prompt = createAgentPrompt("Top up the test account", snapshot, ["FULL SKILL BODY"], [], {
    runId: "run-1",
    iteration: 3,
    maxSteps: 8,
    timeoutMs: 90_000,
    startedAt: Date.now(),
    completionEvidenceFailure: {
      reason: "Completion evidence was not found.",
      unmatchedEvidence: ["Top up succeeded"],
    },
  });

  assert.match(prompt, /"completionEvidenceFailure":\{"reason":"Completion evidence was not found\."/u);
  assert.match(prompt, /"unmatchedEvidence":\["Top up succeeded"\]/u);
  assert.match(prompt, /take one safe action to find or reveal a verifiable result/u);
  assert.match(prompt, /Continue the existing current-page browser task/u);
  assert.doesNotMatch(prompt, /FULL SKILL BODY/u);
});

test("Responses SSE collects internal JSON without exposing protocol fragments as timeline events", async () => {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({ start(controller) {
    controller.enqueue(encoder.encode('event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"{\\"kind\\":\\"answer\\","}\n\n'));
    controller.enqueue(encoder.encode('event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"\\"content\\":\\"ok\\"}"}\n\n'));
    controller.enqueue(encoder.encode('event: response.completed\ndata: {"type":"response.completed","response":{"id":"resp-1"}}\n\n'));
    controller.close();
  } });
  const streamed = await readResponsesStream(new Response(body, { headers: { "content-type": "text/event-stream" } }));
  assert.equal(streamed.text, '{"kind":"answer","content":"ok"}');
  assert.equal(streamed.responseId, "resp-1");
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

test("reobserve prompts invalidate old refs and expose only the fresh snapshot", () => {
  const prompt = createAgentPrompt("continue", snapshot, [], [], {
    runId: "run-1",
    iteration: 1,
    maxSteps: 8,
    timeoutMs: 90_000,
    startedAt: Date.now(),
    reobserve: {
      reason: "page_url_changed",
      summary: "The stale action was discarded.",
      actionMayHaveExecuted: false,
    },
  });

  assert.match(prompt, /"reobserve":\{"reason":"page_url_changed"/u);
  assert.match(prompt, /previous snapshot and refs are invalid/u);
  assert.match(prompt, new RegExp(`"snapshotId":"${snapshot.snapshotId}"`, "u"));
});
