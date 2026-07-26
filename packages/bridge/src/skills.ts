import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AutomationSkillDraft, ConfiguredAutomationSkill, EditableAutomationSkill, SavedAutomationSkill, SkillCatalogItem, SkillExportBundle } from "@auto-page-agent/shared";
import type { LoadedSkill, LoadedWorkflow } from "./skills/model.js";
import { getPagePatterns, normalizePagePatterns, safeParseHttpUrl } from "./skills/page-patterns.js";
import { isEditableStep, parameterizeWorkflow, renderSkillMarkdown } from "./skills/workflow.js";
import { bumpPatchVersion, cleanSingleLine, compareVersions, normalizeCategory, normalizeVersion, pathExists, toSkillSlug, validateSkillSlug } from "./skills/utils.js";
import { getDataSubdirectory } from "./data-paths.js";

export type { LoadedSkill } from "./skills/model.js";
export { renderSkillMarkdown } from "./skills/workflow.js";
export { listSkillsForPage, selectSkillContext, selectSkills, skillMatchesPage } from "./skills/selection.js";

const REGISTRY_SCHEMA_VERSION = 1;

export function getSkillStoragePath(): string {
  return getDataSubdirectory("skills");
}

function getMarketplaceRoot(): string {
  const repositorySkills = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../../skills");
  return resolve(process.env.AUTO_PAGE_AGENT_BUNDLED_SKILLS || repositorySkills);
}

async function ensureSkillRegistry(): Promise<string> {
  const root = getSkillStoragePath();
  const dataRoot = resolve(root, "..");
  const statePath = resolve(dataRoot, "registry.json");
  await mkdir(root, { recursive: true });
  try {
    const state = JSON.parse(await readFile(statePath, "utf8")) as { schemaVersion?: number };
    if (state.schemaVersion === REGISTRY_SCHEMA_VERSION) return root;
  } catch { /* First V3 run: migrate the existing repository Skills into durable user storage. */ }
  const marketplaceRoot = getMarketplaceRoot();
  if (marketplaceRoot !== root) {
    let folders: string[] = [];
    try { folders = await readdir(marketplaceRoot); } catch { /* An empty registry is still valid. */ }
    for (const folder of folders) {
      const target = resolve(root, folder);
      if (await pathExists(target)) continue;
      await cp(resolve(marketplaceRoot, folder), target, { recursive: true, errorOnExist: false });
    }
  }
  await writeFile(statePath, `${JSON.stringify({ schemaVersion: REGISTRY_SCHEMA_VERSION, initializedAt: new Date().toISOString() }, null, 2)}\n`, "utf8");
  return root;
}

export async function loadSkills(root?: string): Promise<LoadedSkill[]> {
  const actualRoot = root ?? await ensureSkillRegistry();
  let folders: string[];
  try { folders = await readdir(actualRoot); } catch { return []; }
  const skills: LoadedSkill[] = [];
  for (const folder of folders) {
    try {
      const skillPath = resolve(actualRoot, folder, "SKILL.md");
      const body = await readFile(skillPath, "utf8");
      const frontmatter = /^---\s*\n([\s\S]*?)\n---/u.exec(body)?.[1] ?? "";
      const name = /^name:\s*(.+)$/mu.exec(frontmatter)?.[1]?.trim() || folder;
      const description = /^description:\s*(.+)$/mu.exec(frontmatter)?.[1]?.trim() || "";
      const category = normalizeCategory(/^category:\s*(.+)$/mu.exec(frontmatter)?.[1]?.trim());
      const version = normalizeVersion(/^version:\s*(.+)$/mu.exec(frontmatter)?.[1]?.trim());
      let workflowText = "";
      let workflow: LoadedWorkflow | undefined;
      try {
        workflowText = (await readFile(resolve(actualRoot, folder, "workflow.json"), "utf8")).slice(0, 128_000);
        workflow = JSON.parse(workflowText) as LoadedWorkflow;
      } catch { /* Hand-written Skills do not require a workflow file. */ }
      const updatedAt = (await stat(skillPath)).mtime.toISOString();
      skills.push({ name, slug: folder, description, body: workflowText ? `${body}\n\nRecorded workflow configuration:\n${workflowText}` : body, workflow, category, version, updatedAt });
    } catch { /* Ignore folders without a readable SKILL.md. */ }
  }
  return skills;
}

export async function listSkillCatalog(): Promise<{ installed: SkillCatalogItem[]; marketplace: SkillCatalogItem[]; storagePath: string }> {
  const storagePath = await ensureSkillRegistry();
  const [installedSkills, marketplaceSkills] = await Promise.all([loadSkills(storagePath), loadSkills(getMarketplaceRoot())]);
  const installedBySlug = new Map(installedSkills.map((skill) => [skill.slug, skill]));
  const marketplaceSlugs = new Set(marketplaceSkills.map((skill) => skill.slug));
  const installed = installedSkills.map((skill) => toCatalogItem(skill, true, marketplaceSlugs.has(skill.slug) ? "marketplace" : "custom", false));
  const marketplace = marketplaceSkills.map((skill) => {
    const current = installedBySlug.get(skill.slug);
    return toCatalogItem(skill, Boolean(current), "marketplace", Boolean(current && compareVersions(skill.version, current.version) > 0));
  });
  return {
    installed: installed.sort(catalogSort),
    marketplace: marketplace.sort(catalogSort),
    storagePath,
  };
}

export async function installMarketplaceSkill(slug: string): Promise<SkillCatalogItem> {
  const safeSlug = validateSkillSlug(slug);
  const marketplaceRoot = getMarketplaceRoot();
  const template = (await loadSkills(marketplaceRoot)).find((skill) => skill.slug === safeSlug);
  if (!template) throw new Error("Marketplace Skill was not found.");
  const root = await ensureSkillRegistry();
  const target = resolve(root, safeSlug);
  if (await pathExists(target)) {
    const installed = (await loadSkills(root)).find((skill) => skill.slug === safeSlug)!;
    if (compareVersions(template.version, installed.version) <= 0) return toCatalogItem(installed, true, "marketplace", false);
  }
  await cp(resolve(marketplaceRoot, safeSlug), target, { recursive: true, force: true });
  const installed = (await loadSkills(root)).find((skill) => skill.slug === safeSlug);
  if (!installed) throw new Error("Marketplace Skill installation failed.");
  return toCatalogItem(installed, true, "marketplace", false);
}

export async function getEditableSkill(slug: string, root?: string): Promise<EditableAutomationSkill> {
  const safeSlug = validateSkillSlug(slug);
  const skill = (await loadSkills(root)).find((item) => item.slug === safeSlug);
  if (!skill) throw new Error("Skill was not found.");
  const steps = Array.isArray(skill.workflow?.steps)
    ? skill.workflow.steps.filter(isEditableStep).map((step, index) => ({
      id: cleanSingleLine(step.id || `${index + 1}`, 100),
      action: step.action,
      url: typeof step.url === "string" ? step.url : skill.workflow!.startUrl!,
      selector: typeof step.selector === "string" ? step.selector : undefined,
      label: typeof step.label === "string" ? step.label : undefined,
      value: typeof step.value === "string" ? step.value : undefined,
      sensitive: Boolean(step.sensitive),
      timestamp: Number(step.timestamp) || index + 1,
      scrollX: Number(step.scrollX) || undefined,
      scrollY: Number(step.scrollY) || undefined,
      checked: typeof step.checked === "boolean" ? step.checked : undefined,
    }))
    : [];
  return {
    name: skill.name,
    slug: skill.slug,
    description: skill.description,
    category: skill.category,
    version: skill.version,
    startUrl: skill.workflow?.startUrl,
    enabled: skill.workflow?.enabled !== false,
    pagePatterns: skill.workflow ? getPagePatterns(skill.workflow) : [],
    steps,
    instructions: skill.workflow?.instructions ?? extractInstructions(skill.body),
  };
}

export async function configureAutomationSkill(
  slug: string,
  changes: { enabled?: boolean; pagePatterns?: string[] },
  root?: string,
): Promise<ConfiguredAutomationSkill> {
  const actualRoot = root ?? await ensureSkillRegistry();
  const safeSlug = validateSkillSlug(slug);
  const path = resolve(actualRoot, safeSlug, "workflow.json");
  let workflow: LoadedWorkflow;
  try { workflow = JSON.parse((await readFile(path, "utf8")).slice(0, 128_000)) as LoadedWorkflow; }
  catch { throw new Error("Only recorded Skills with workflow.json can be configured."); }
  if (!workflow.startUrl || !safeParseHttpUrl(workflow.startUrl)) throw new Error("Skill workflow has no valid start URL.");
  if (typeof changes.enabled === "boolean") workflow.enabled = changes.enabled;
  if (changes.pagePatterns) workflow.pagePatterns = normalizePagePatterns(changes.pagePatterns);
  workflow.schemaVersion = Math.max(2, Number(workflow.schemaVersion) || 1);
  await writeFile(path, `${JSON.stringify(workflow, null, 2)}\n`, "utf8");
  return { slug: safeSlug, enabled: workflow.enabled !== false, pagePatterns: getPagePatterns(workflow) };
}

export async function saveAutomationSkill(
  draft: AutomationSkillDraft,
  root?: string,
  existingSlug?: string,
): Promise<SavedAutomationSkill> {
  const actualRoot = root ?? await ensureSkillRegistry();
  const name = cleanSingleLine(draft.name, 80);
  const description = cleanSingleLine(draft.description, 240);
  if (!name) throw new Error("Skill name is required.");
  const instructions = draft.instructions?.trim().slice(0, 20_000) ?? "";
  if (!draft.steps.length && !instructions) throw new Error("Record at least one browser action or add Skill instructions before saving.");
  if (draft.steps.length > 100) throw new Error("A recorded Skill can contain at most 100 steps.");
  const slug = existingSlug ? validateSkillSlug(existingSlug) : toSkillSlug(name);
  const folder = resolve(actualRoot, slug);
  const exists = await pathExists(folder);
  if (existingSlug && !exists) throw new Error("The Skill selected for update no longer exists.");
  if (!existingSlug && exists) throw new Error("A Skill with this name already exists. Choose Update Skill or use another name.");
  const current = exists ? (await loadSkills(actualRoot)).find((skill) => skill.slug === slug) : undefined;
  const version = current ? bumpPatchVersion(current.version) : "1.0.0";
  const workflow = parameterizeWorkflow({ ...draft, name, description });
  await mkdir(folder, { recursive: true });
  await Promise.all([
    writeFile(resolve(folder, "SKILL.md"), renderSkillMarkdown({ ...draft, name, description }, workflow.variableNames, { category: current?.category ?? "custom", version }), "utf8"),
    writeFile(resolve(folder, "workflow.json"), `${JSON.stringify(workflow.document, null, 2)}\n`, "utf8"),
  ]);
  return {
    name,
    slug,
    skillPath: `skills/${slug}/SKILL.md`,
    workflowPath: `skills/${slug}/workflow.json`,
    variableNames: workflow.variableNames,
    operation: existingSlug ? "updated" : "created",
    version,
  };
}

export async function deleteAutomationSkill(slug: string, root?: string): Promise<string> {
  const actualRoot = root ?? await ensureSkillRegistry();
  const safeSlug = validateSkillSlug(slug);
  const folder = resolve(actualRoot, safeSlug);
  if (!await pathExists(folder)) throw new Error("Skill was not found.");
  await rm(folder, { recursive: true, force: false });
  return safeSlug;
}

export async function exportAutomationSkill(slug: string, root?: string): Promise<{ filename: string; bundle: SkillExportBundle }> {
  const actualRoot = root ?? await ensureSkillRegistry();
  const safeSlug = validateSkillSlug(slug);
  const skill = (await loadSkills(actualRoot)).find((item) => item.slug === safeSlug);
  if (!skill) throw new Error("Skill was not found.");
  return {
    filename: `${safeSlug}.auto-page-agent-skill.json`,
    bundle: {
      format: "auto-page-agent-skill",
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      skill: {
        name: skill.name,
        description: skill.description,
        category: skill.category,
        version: skill.version,
        instructions: skill.workflow
          ? skill.workflow.instructions ?? extractInstructions(skill.body)
          : stripFrontmatter(skill.body),
        ...(skill.workflow ? { workflow: skill.workflow as Record<string, unknown> } : {}),
      },
    },
  };
}

export async function importAutomationSkill(bundle: SkillExportBundle, root?: string): Promise<SavedAutomationSkill> {
  if (!bundle || bundle.format !== "auto-page-agent-skill" || bundle.schemaVersion !== 1 || !bundle.skill) {
    throw new Error("Unsupported Skill file.");
  }
  const workflow = bundle.skill.workflow;
  const actualRoot = root ?? await ensureSkillRegistry();
  if (!workflow) {
    const name = cleanSingleLine(bundle.skill.name, 80);
    const description = cleanSingleLine(bundle.skill.description, 240);
    const instructions = String(bundle.skill.instructions ?? "").trim().slice(0, 20_000);
    if (!name || !instructions) throw new Error("Imported Skill must include a name and instructions.");
    const slug = toSkillSlug(name);
    const folder = resolve(actualRoot, slug);
    if (await pathExists(folder)) throw new Error("A Skill with this name already exists. Delete it first or import a renamed copy.");
    const version = normalizeVersion(bundle.skill.version);
    await mkdir(folder, { recursive: true });
    await writeFile(resolve(folder, "SKILL.md"), [
      "---",
      `name: ${name}`,
      `description: ${description}`,
      `category: ${normalizeCategory(bundle.skill.category)}`,
      `version: ${version}`,
      "---",
      "",
      instructions,
      "",
    ].join("\n"), "utf8");
    return {
      name,
      slug,
      skillPath: `skills/${slug}/SKILL.md`,
      variableNames: [],
      operation: "created",
      version,
    };
  }
  const rawSteps = workflow && Array.isArray(workflow.steps) ? workflow.steps : [];
  const steps = rawSteps.filter(isEditableStep).map((step, index) => ({
    id: cleanSingleLine(step.id || `${index + 1}`, 100),
    action: step.action,
    url: typeof step.url === "string" ? step.url : String(workflow?.startUrl ?? ""),
    selector: typeof step.selector === "string" ? step.selector : undefined,
    label: typeof step.label === "string" ? step.label : undefined,
    value: typeof step.value === "string" && !step.value.includes("{{") ? step.value : undefined,
    sensitive: Boolean(step.sensitive),
    timestamp: Number(step.timestamp) || index + 1,
    scrollX: Number(step.scrollX) || undefined,
    scrollY: Number(step.scrollY) || undefined,
    checked: typeof step.checked === "boolean" ? step.checked : undefined,
  }));
  return saveAutomationSkill({
    name: cleanSingleLine(bundle.skill.name, 80),
    description: cleanSingleLine(bundle.skill.description, 240),
    startUrl: typeof workflow?.startUrl === "string" ? workflow.startUrl : inferStartUrl(steps),
    createdAt: new Date().toISOString(),
    requiresConfirmation: true,
    steps,
    instructions: String(bundle.skill.instructions ?? "").slice(0, 20_000),
  }, actualRoot);
}


function toCatalogItem(skill: LoadedSkill, installed: boolean, source: "marketplace" | "custom", updateAvailable: boolean): SkillCatalogItem {
  const pagePatterns = skill.workflow ? getPagePatterns(skill.workflow) : [];
  const steps = Array.isArray(skill.workflow?.steps) ? skill.workflow.steps : [];
  return {
    name: skill.name,
    slug: skill.slug,
    description: skill.description,
    category: skill.category,
    version: skill.version,
    installed,
    updateAvailable,
    source,
    scope: skill.workflow?.startUrl ? "page" : "global",
    pagePatterns,
    stepCount: steps.length,
    variableNames: Array.from(new Set(steps.flatMap((step) => typeof step.value === "string"
      ? Array.from(step.value.matchAll(/\{\{([a-z0-9_]+)\}\}/giu), (match) => match[1]!)
      : []))),
    updatedAt: skill.updatedAt,
  };
}

function catalogSort(left: SkillCatalogItem, right: SkillCatalogItem): number {
  return left.category.localeCompare(right.category) || left.name.localeCompare(right.name);
}

function extractInstructions(body: string): string {
  return /^## Instructions\s*\n+([\s\S]*?)(?=\n## |\nUse this Skill|\s*$)/mu.exec(body)?.[1]?.trim() ?? "";
}

function stripFrontmatter(body: string): string {
  return body.replace(/^---\s*\n[\s\S]*?\n---\s*/u, "").trim().slice(0, 20_000);
}

function inferStartUrl(steps: Array<{ url: string }>): string {
  const first = steps.find((step) => /^https?:\/\//iu.test(step.url));
  if (!first) throw new Error("Imported Skill must include a valid start URL.");
  return first.url;
}
