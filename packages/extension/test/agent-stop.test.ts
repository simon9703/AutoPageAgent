import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("busy conversations expose a real agent cancellation path", async () => {
  const sidePanel = await readFile(new URL("../src/sidepanel/App.tsx", import.meta.url), "utf8");
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
