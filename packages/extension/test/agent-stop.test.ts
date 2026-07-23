import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("busy conversations expose a real agent cancellation path", async () => {
  const sidePanel = await readFile(new URL("../src/sidepanel/controller.tsx", import.meta.url), "utf8");
  const background = await readFile(new URL("../src/background.ts", import.meta.url), "utf8");
  const shared = await readFile(new URL("../../shared/src/index.ts", import.meta.url), "utf8");

  assert.match(sidePanel, /type: "ui\.agent\.stop"/u);
  assert.match(sidePanel, /aria-label="Stop agent"/u);
  assert.match(background, /type === "ui\.agent\.stop"/u);
  assert.match(background, /type: "agent\.cancel"/u);
  assert.match(background, /assertAgentRunActive\(run\)/u);
  assert.match(shared, /type: "agent\.cancel"/u);
  assert.match(shared, /type: "agent\.cancel\.result"/u);
});

test("page tools and compact run controls share the composer", async () => {
  const sidePanel = [
    await readFile(new URL("../src/sidepanel/controller.tsx", import.meta.url), "utf8"),
    await readFile(new URL("../src/sidepanel/components.tsx", import.meta.url), "utf8"),
  ].join("\n");
  const stylesheet = await readFile(new URL("../src/sidepanel.css", import.meta.url), "utf8");

  assert.doesNotMatch(sidePanel, /<nav[^>]+aria-label="Page tools"/u);
  assert.match(sidePanel, /<div[^>]+aria-label="Page tools"/u);
  for (const label of ["Select element", "Select image area", "Capture viewport", "Open Skills"]) {
    assert.match(sidePanel, new RegExp(`label="${label}"`, "u"));
  }
  assert.match(sidePanel, /label=\{recording \? "Stop recording" : "Record workflow"\}/u);
  assert.match(sidePanel, /h-8 w-8[^>]+aria-label="Stop agent"/u);
  assert.match(sidePanel, /h-8 w-8[^>]+aria-label="Send"/u);
  assert.match(stylesheet, /\.composer \.composer-input:focus-visible \{ outline: none;/u);
});

test("header uses the shared primary New action without a page-forward shortcut", async () => {
  const sidePanel = await readFile(new URL("../src/sidepanel/controller.tsx", import.meta.url), "utf8");

  assert.match(sidePanel, /<Button size="sm"[\s\S]+?aria-label="New conversation">/u);
  assert.match(sidePanel, /<Plus size=\{14\} \/>[\s\S]+New[\s\S]+<\/Button>/u);
  assert.doesNotMatch(sidePanel, /ExternalLink/u);
  assert.doesNotMatch(sidePanel, /aria-label="Switch to target page"/u);
});

test("side panel entry stays separate from controller and presentation components", async () => {
  const entry = await readFile(new URL("../src/sidepanel/App.tsx", import.meta.url), "utf8");

  assert.match(entry, /<SidePanelController \/>/u);
  assert.doesNotMatch(entry, /chrome\.runtime/u);
  assert.doesNotMatch(entry, /useState/u);
});
