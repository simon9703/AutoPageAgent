import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("busy conversations expose a real agent cancellation path", async () => {
  const sidePanel = await readFile(new URL("../src/sidepanel/controller.tsx", import.meta.url), "utf8");
  const background = await readFile(new URL("../src/background.ts", import.meta.url), "utf8");
  const sharedProtocol = await readFile(new URL("../../shared/src/protocol.ts", import.meta.url), "utf8");

  assert.match(sidePanel, /type: "ui\.agent\.stop"/u);
  assert.match(sidePanel, /aria-label=\{t\("action\.stopAgent"\)\}/u);
  assert.match(sidePanel, /if \(stopRequestedRef\.current \|\| !isCurrentScope\(scope\)\) return;/u);
  assert.doesNotMatch(sidePanel, /setBusy\(false\);\s*setNotice\(response\.ok \? "Agent stopped\."/u);
  assert.match(sidePanel, /disabled=\{busy\}[\s\S]+aria-label=\{t\("action\.new"\)\}/u);
  assert.match(background, /type === "ui\.agent\.stop"/u);
  assert.match(background, /type: "agent\.cancel"/u);
  assert.match(background, /assertAgentRunActive\(run\)/u);
  assert.match(background, /type: "ui\.agent\.event"[\s\S]+conversationId,[\s\S]+targetTabId,[\s\S]+windowId,[\s\S]+event/u);
  assert.match(sidePanel, /value\.conversationId === conversationIdRef\.current/u);
  assert.match(sharedProtocol, /type: "agent\.cancel"/u);
  assert.match(sharedProtocol, /type: "agent\.cancel\.result"/u);
});

test("conversation output keeps plans and runtime metadata out of assistant messages", async () => {
  const sidePanel = [
    await readFile(new URL("../src/sidepanel/controller.tsx", import.meta.url), "utf8"),
    await readFile(new URL("../src/sidepanel/components.tsx", import.meta.url), "utf8"),
  ].join("\n");

  assert.doesNotMatch(sidePanel, /appendMessage\("assistant", response\.decision\.summary\);\s*setNotice\("Action ready/u);
  assert.doesNotMatch(sidePanel, /Completed in \$\{response\.steps/u);
  assert.match(sidePanel, /completedConversationMessage\(response\.answer, t\("notice\.taskCompletedMessage"\)\)/u);
  assert.match(sidePanel, /pendingUserTaskRef\.current = task/u);
  assert.match(sidePanel, /<ChoiceCard[\s\S]+onConfirm=\{\(option\) => void submitTask\(undefined, option\)\}/u);
  assert.match(sidePanel, /choice\.recommendedOption === option/u);
  assert.match(sidePanel, /t\("action\.start"\)/u);
});

test("page tools and compact run controls share the composer", async () => {
  const sidePanel = [
    await readFile(new URL("../src/sidepanel/controller.tsx", import.meta.url), "utf8"),
    await readFile(new URL("../src/sidepanel/components.tsx", import.meta.url), "utf8"),
  ].join("\n");
  const stylesheet = await readFile(new URL("../src/sidepanel.css", import.meta.url), "utf8");

  assert.doesNotMatch(sidePanel, /<nav[^>]+aria-label=\{t\("prompt\.tips"\)\}/u);
  assert.match(sidePanel, /<div[^>]+aria-label=\{t\("prompt\.tips"\)\}/u);
  for (const key of ["selectElement", "selectImageArea", "captureViewport", "openSkills"]) {
    assert.match(sidePanel, new RegExp(`label=\\{t\\("action\\.${key}"\\)\\}`, "u"));
  }
  assert.match(sidePanel, /label=\{recording \? t\("action\.stopRecording"\) : t\("action\.recordWorkflow"\)\}/u);
  assert.match(sidePanel, /h-8 w-8[^>]+aria-label=\{t\("action\.stopAgent"\)\}/u);
  assert.match(sidePanel, /h-8 w-8[^>]+aria-label=\{t\("action\.send"\)\}/u);
  assert.match(stylesheet, /\.composer \.composer-input:focus-visible \{ outline: none;/u);
});

test("header keeps New primary and switches visible tabs without rebinding the conversation", async () => {
  const sidePanel = [
    await readFile(new URL("../src/sidepanel/controller.tsx", import.meta.url), "utf8"),
    await readFile(new URL("../src/sidepanel/components.tsx", import.meta.url), "utf8"),
  ].join("\n");

  assert.match(sidePanel, /<Button size="sm"[\s\S]+?aria-label=\{t\("action\.new"\)\}>/u);
  assert.match(sidePanel, /<Plus size=\{14\} \/>[\s\S]+t\("action\.new"\)[\s\S]+<\/Button>/u);
  assert.match(sidePanel, /aria-label=\{t\("tab\.switch"\)\}/u);
  assert.match(sidePanel, /onChoose=\{\(tab\) => void activateTab\(tab\.tabId\)\}/u);
  assert.match(sidePanel, /type: "ui\.tab\.activate", targetTabId/u);
  assert.match(sidePanel, /t\("tab\.bound"\)/u);
  assert.doesNotMatch(sidePanel, /queuedTarget/u);
  assert.doesNotMatch(sidePanel, /bg-emerald-500/u);
  assert.doesNotMatch(sidePanel, /refreshHealth/u);
});

test("message sending waits for native bridge connection and Codex login", async () => {
  const sidePanel = [
    await readFile(new URL("../src/sidepanel/controller.tsx", import.meta.url), "utf8"),
    await readFile(new URL("../src/sidepanel/components.tsx", import.meta.url), "utf8"),
  ].join("\n");
  const background = await readFile(new URL("../src/background.ts", import.meta.url), "utf8");
  const transport = await readFile(new URL("../src/background/bridge-client.ts", import.meta.url), "utf8");
  const manifest = await readFile(new URL("../manifest.json", import.meta.url), "utf8");

  assert.match(transport, /chrome\.runtime\.connectNative\(NATIVE_HOST_NAME\)/u);
  assert.doesNotMatch(transport, /new WebSocket/u);
  assert.match(background, /type === "ui\.bridge\.reconnect"/u);
  assert.match(sidePanel, /t\("action\.reconnect"\)/u);
  assert.match(sidePanel, /connection\.phase !== "ready"[\s\S]+t\("notice\.reconnectBeforeSend"\)/u);
  assert.match(sidePanel, /disabled=\{!prompt\.trim\(\) \|\| connection\.phase !== "ready"\}/u);
  assert.match(manifest, /"nativeMessaging"/u);
});

test("side panel entry stays separate from controller and presentation components", async () => {
  const entry = await readFile(new URL("../src/sidepanel/App.tsx", import.meta.url), "utf8");

  assert.match(entry, /<SidePanelController \/>/u);
  assert.doesNotMatch(entry, /chrome\.runtime/u);
  assert.doesNotMatch(entry, /useState/u);
});
