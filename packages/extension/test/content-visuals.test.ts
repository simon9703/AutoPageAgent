import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("manifest injects the isolated browser-agent visual stylesheet", async () => {
  const manifest = JSON.parse(await readFile(new URL("../manifest.json", import.meta.url), "utf8")) as {
    version?: string;
    content_scripts?: Array<{ css?: string[] }>;
  };
  const extensionPackage = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  ) as { version?: string };
  const stylesheet = await readFile(new URL("../src/content.css", import.meta.url), "utf8");
  const contentScript = await readFile(new URL("../src/content.ts", import.meta.url), "utf8");

  assert.equal(manifest.version, extensionPackage.version);
  assert.ok(manifest.content_scripts?.some((entry) => entry.css?.includes("content.css")));
  assert.match(stylesheet, /html > \.auto-page-agent-element-outline\.selected/u);
  assert.match(contentScript, /attachShadow\(\{ mode: "closed" \}\)/u);
  assert.match(contentScript, /document\.createElement\("auto-page-agent-frame"\)/u);
  assert.match(contentScript, /pointerEvents: "none"/u);
  assert.match(contentScript, /background: "transparent"/u);
  assert.doesNotMatch(contentScript, /agentFrame\.innerHTML/u);
  assert.doesNotMatch(stylesheet, /auto-page-agent-viewport-frame::before/u);
  assert.doesNotMatch(stylesheet, /mask-composite/u);
  assert.match(stylesheet, /background: transparent !important/u);
  for (const edge of ["top", "right", "bottom", "left"]) assert.match(contentScript, new RegExp(`class="edge ${edge}"`, "u"));
  assert.match(stylesheet, /html > \.auto-page-agent-pointer\.visible/u);
  assert.match(stylesheet, /\.auto-page-agent-pointer-label/u);
});
