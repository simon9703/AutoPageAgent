import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { AutomationSkillDraft } from "@auto-page-agent/shared";
import { loadSkills, saveAutomationSkill } from "../src/skills.js";

test("recorded Skills parameterize values and never persist sensitive input", async () => {
  const root = await mkdtemp(join(tmpdir(), "auto-page-agent-skills-"));
  const draft: AutomationSkillDraft = {
    name: "Create release draft",
    description: "Fill a release form but stop before publishing.",
    startUrl: "https://example.com/releases/new#form",
    createdAt: "2026-07-22T00:00:00.000Z",
    requiresConfirmation: true,
    steps: [
      { id: "1", action: "fill", url: "https://example.com/releases/new", selector: "#title", label: "Release title", value: "v1.2.3", sensitive: false, timestamp: 1 },
      { id: "2", action: "fill", url: "https://example.com/releases/new", selector: "#token", label: "Token", value: undefined, sensitive: true, timestamp: 2 },
      { id: "3", action: "click", url: "https://example.com/releases/new", selector: "#preview", label: "Preview", sensitive: false, timestamp: 3 },
    ],
  };
  try {
    const saved = await saveAutomationSkill(draft, root);
    const workflow = await readFile(join(root, saved.slug, "workflow.json"), "utf8");
    assert.match(workflow, /\{\{release_title\}\}/u);
    assert.doesNotMatch(workflow, /v1\.2\.3|secret|token-value/u);
    assert.equal(saved.variableNames.includes("release_title"), true);
    const loaded = await loadSkills(root);
    assert.match(loaded[0]!.body, /Recorded workflow configuration/u);
    assert.match(loaded[0]!.body, /#preview/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("recorded Skills reject non-http start URLs", async () => {
  const root = await mkdtemp(join(tmpdir(), "auto-page-agent-skills-"));
  try {
    await assert.rejects(() => saveAutomationSkill({
      name: "Unsafe",
      description: "Unsafe URL",
      startUrl: "file:///tmp/test",
      createdAt: new Date().toISOString(),
      requiresConfirmation: true,
      steps: [{ id: "1", action: "click", url: "file:///tmp/test", selector: "button", sensitive: false, timestamp: 1 }],
    }, root), /http\(s\)/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
