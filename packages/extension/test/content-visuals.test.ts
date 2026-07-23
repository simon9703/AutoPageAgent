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

  assert.equal(manifest.version, extensionPackage.version);
  assert.ok(manifest.content_scripts?.some((entry) => entry.css?.includes("content.css")));
  assert.match(stylesheet, /html > \.auto-page-agent-element-outline\.selected/u);
  assert.match(stylesheet, /html > \.auto-page-agent-viewport-frame\.visible/u);
  assert.match(stylesheet, /html > \.auto-page-agent-viewport-frame::before/u);
  assert.match(stylesheet, /mask-composite: exclude !important/u);
  assert.match(stylesheet, /background: transparent !important/u);
  assert.match(stylesheet, /html > \.auto-page-agent-pointer\.visible/u);
  assert.match(stylesheet, /\.auto-page-agent-pointer-label/u);
});
