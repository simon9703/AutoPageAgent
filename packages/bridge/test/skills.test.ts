import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { AutomationSkillDraft } from "@auto-page-agent/shared";
import { listSkillsForPage, loadSkills, saveAutomationSkill, selectSkills } from "../src/skills.js";

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

test("page Skill discovery matches origin and path prefix without leaking to unrelated pages", async () => {
  const root = await mkdtemp(join(tmpdir(), "auto-page-agent-skills-"));
  try {
    await saveAutomationSkill({
      name: "Release draft",
      description: "Prepare a release draft.",
      startUrl: "https://example.com/releases/new",
      createdAt: new Date().toISOString(),
      requiresConfirmation: true,
      steps: [{ id: "1", action: "click", url: "https://example.com/releases/new", selector: "#preview", label: "Preview", sensitive: false, timestamp: 1 }],
    }, root);
    const globalFolder = join(root, "analyze-page");
    await mkdir(globalFolder);
    await writeFile(join(globalFolder, "SKILL.md"), "---\nname: analyze-page\ndescription: Analyze any current page.\n---\n\n# Analyze\n", "utf8");
    const loaded = await loadSkills(root);
    const matching = listSkillsForPage("https://example.com/releases/new/advanced?draft=1", loaded);
    assert.deepEqual(matching.map((skill) => skill.name), ["Release draft", "analyze-page"]);
    assert.equal(matching[0]!.match, "path-prefix");
    assert.equal(matching[0]!.stepCount, 1);
    const unrelated = listSkillsForPage("https://example.com/settings", loaded);
    assert.deepEqual(unrelated.map((skill) => skill.name), ["analyze-page"]);
    const selected = selectSkills("release draft", loaded, "https://other.example/releases/new");
    assert.deepEqual(selected.map((skill) => skill.name), ["analyze-page"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
