import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const contentSource = await readFile(new URL("../src/content/recording.ts", import.meta.url), "utf8");
const backgroundSource = await readFile(new URL("../src/background/recording.ts", import.meta.url), "utf8");
const sidePanelSource = await readFile(new URL("../src/sidepanel/controller.tsx", import.meta.url), "utf8");

test("recording captures live form input, element scroll, navigation, and bounded screenshots", () => {
  assert.match(contentSource, /addEventListener\("input"/u);
  assert.match(contentSource, /addEventListener\("scroll"[\s\S]*capture:\s*true/u);
  assert.match(contentSource, /checked:\s*target\.checked/u);
  assert.match(backgroundSource, /action:\s*"navigate"/u);
  assert.match(backgroundSource, /screenshots\.length\s*>=\s*12/u);
  assert.match(backgroundSource, /captureRecordingFrame/u);
});

test("side panel exposes Skill import, selection, management, and conversation summary", () => {
  for (const messageType of ["ui.skill.import", "ui.skill.export", "ui.skill.delete", "ui.skill.summarize"]) {
    assert.match(sidePanelSource, new RegExp(messageType.replaceAll(".", "\\."), "u"));
  }
  assert.match(sidePanelSource, /selectedSkillSlug/u);
  assert.match(sidePanelSource, /action\.summarizeSkill/u);
});
