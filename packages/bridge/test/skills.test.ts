import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { AutomationSkillDraft } from "@auto-page-agent/shared";
import { configureAutomationSkill, deleteAutomationSkill, exportAutomationSkill, importAutomationSkill, listSkillsForPage, loadSkills, saveAutomationSkill, selectSkillContext, selectSkills } from "../src/skills.js";
import { summarizeSkill } from "../src/skills/summarize.js";

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

test("recorded Skills remain available across routes, domains, and deployment environments", async () => {
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
    assert.deepEqual(unrelated.map((skill) => skill.name), ["analyze-page", "Release draft"]);
    const anotherEnvironment = listSkillsForPage("https://test.example.net/releases/new", loaded);
    assert.deepEqual(anotherEnvironment.map((skill) => skill.name), ["analyze-page", "Release draft"]);
    const selected = selectSkills("release draft", loaded, "https://other.example/releases/new");
    assert.deepEqual(selected.map((skill) => skill.name), ["Release draft"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("legacy path patterns affect recommendation metadata while enabled state remains an execution gate", async () => {
  const root = await mkdtemp(join(tmpdir(), "auto-page-agent-skills-"));
  try {
    const saved = await saveAutomationSkill({
      name: "Edit release",
      description: "Edit one release.",
      startUrl: "https://example.com/releases/1/edit",
      createdAt: new Date().toISOString(),
      requiresConfirmation: true,
      steps: [{ id: "1", action: "click", url: "https://example.com/releases/1/edit", selector: "#preview", sensitive: false, timestamp: 1 }],
    }, root);
    await configureAutomationSkill(saved.slug, { pagePatterns: ["https://example.com/releases/*/edit"] }, root);
    let loaded = await loadSkills(root);
    assert.equal(listSkillsForPage("https://example.com/releases/42/edit", loaded)[0]!.match, "wildcard");
    assert.equal(listSkillsForPage("https://example.com/releases/42/view", loaded)[0]!.name, "Edit release");
    assert.equal(selectSkills("edit release", loaded, "https://test.example.net/releases/42/edit")[0]!.name, "Edit release");
    await configureAutomationSkill(saved.slug, { enabled: false }, root);
    loaded = await loadSkills(root);
    const visible = listSkillsForPage("https://another.example/releases/42/view", loaded);
    assert.equal(visible[0]!.enabled, false);
    assert.equal(selectSkills("edit release", loaded, "https://example.com/releases/42/edit").length, 0);
    await assert.rejects(() => configureAutomationSkill(saved.slug, { pagePatterns: ["https://*.example.com/**"] }, root), /fixed http\(s\) origin/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("V2 Skill selection prefers page-scoped matches and explains why", () => {
  const selected = selectSkillContext("create release draft", [
    { name: "Release draft", slug: "release", description: "Create release draft", body: "release", workflow: { enabled: true, startUrl: "https://example.com/releases/new", steps: [] } },
    { name: "Analyze page", slug: "analyze-page", description: "Analyze any page", body: "analyze" },
  ], "https://example.com/releases/new");
  assert.equal(selected[0]?.slug, "release");
  assert.equal(selected[0]?.scope, "page");
  assert.match(selected[0]?.reason ?? "", /current page/u);
});

test("V3 Skill save requires an explicit update and increments its version", async () => {
  const root = await mkdtemp(join(tmpdir(), "auto-page-agent-skills-"));
  const draft: AutomationSkillDraft = {
    name: "Daily report",
    description: "Fill a daily report draft.",
    startUrl: "https://work.example.com/report",
    createdAt: new Date().toISOString(),
    requiresConfirmation: true,
    steps: [{ id: "1", action: "fill", url: "https://work.example.com/report", selector: "#summary", label: "Summary", value: "Done", sensitive: false, timestamp: 1 }],
  };
  try {
    const created = await saveAutomationSkill(draft, root);
    assert.equal(created.operation, "created");
    assert.equal(created.version, "1.0.0");
    await assert.rejects(() => saveAutomationSkill(draft, root), /already exists/u);
    const updated = await saveAutomationSkill({ ...draft, description: "Updated report workflow." }, root, created.slug);
    assert.equal(updated.operation, "updated");
    assert.equal(updated.version, "1.0.1");
    const markdown = await readFile(join(root, created.slug, "SKILL.md"), "utf8");
    assert.match(markdown, /version: 1\.0\.1/u);
    assert.match(markdown, /Updated report workflow/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Skills can be exported, imported, and deleted without overwriting an existing Skill", async () => {
  const sourceRoot = await mkdtemp(join(tmpdir(), "auto-page-agent-export-"));
  const targetRoot = await mkdtemp(join(tmpdir(), "auto-page-agent-import-"));
  try {
    const created = await saveAutomationSkill({
      name: "Release helper",
      description: "Prepare a release.",
      startUrl: "https://example.com/releases/new",
      createdAt: new Date().toISOString(),
      requiresConfirmation: true,
      instructions: "Open the release form and verify the preview.",
      steps: [{ id: "1", action: "click", url: "https://example.com/releases/new", selector: "#preview", sensitive: false, timestamp: 1 }],
    }, sourceRoot);
    const exported = await exportAutomationSkill(created.slug, sourceRoot);
    assert.equal(exported.bundle.format, "auto-page-agent-skill");
    assert.match(exported.bundle.skill.instructions, /verify the preview/u);
    const imported = await importAutomationSkill(exported.bundle, targetRoot);
    assert.equal(imported.name, "Release helper");
    await assert.rejects(() => importAutomationSkill(exported.bundle, targetRoot), /already exists/u);
    assert.equal(await deleteAutomationSkill(imported.slug, targetRoot), imported.slug);
    assert.equal((await loadSkills(targetRoot)).length, 0);
  } finally {
    await Promise.all([
      rm(sourceRoot, { recursive: true, force: true }),
      rm(targetRoot, { recursive: true, force: true }),
    ]);
  }
});

test("conversation summary creates editable Skill instructions and retains recorded steps", () => {
  const result = summarizeSkill({
    pageUrl: "https://example.com/releases/new",
    pageTitle: "Create release",
    messages: [
      { id: "1", role: "user", content: "创建一个测试发布单", createdAt: new Date().toISOString() },
      { id: "2", role: "assistant", content: "测试发布单已完成。", createdAt: new Date().toISOString() },
    ],
    actions: [{ id: "a", action: "click", url: "https://example.com/releases/new", selector: "#create", label: "Create", sensitive: false, timestamp: 1 }],
    operationNotes: ["点击：Create", "验证：已显示成功提示"],
  });
  assert.equal(result.name, "Create release Skill");
  assert.equal(result.steps.length, 1);
  assert.match(result.instructions, /创建一个测试发布单/u);
  assert.match(result.instructions, /已显示成功提示/u);
});

test("hand-written Skills without workflow.json remain portable", async () => {
  const sourceRoot = await mkdtemp(join(tmpdir(), "auto-page-agent-handwritten-"));
  const targetRoot = await mkdtemp(join(tmpdir(), "auto-page-agent-handwritten-import-"));
  try {
    const folder = join(sourceRoot, "page-helper");
    await mkdir(folder);
    await writeFile(join(folder, "SKILL.md"), "---\nname: Page helper\ndescription: Explain a page.\ncategory: page\nversion: 1.2.0\n---\n\n# Page helper\n\nInspect the current page and explain its visible state.\n", "utf8");
    const exported = await exportAutomationSkill("page-helper", sourceRoot);
    const imported = await importAutomationSkill(exported.bundle, targetRoot);
    assert.equal(imported.workflowPath, undefined);
    const markdown = await readFile(join(targetRoot, imported.slug, "SKILL.md"), "utf8");
    assert.match(markdown, /Inspect the current page/u);
  } finally {
    await Promise.all([
      rm(sourceRoot, { recursive: true, force: true }),
      rm(targetRoot, { recursive: true, force: true }),
    ]);
  }
});
