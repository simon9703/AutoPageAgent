import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { AutomationSkillDraft, ConfiguredAutomationSkill, PageSkillSummary, RecordedActionKind, RecordedBrowserAction, SavedAutomationSkill, SkillSelection } from "@auto-page-agent/shared";

interface LoadedWorkflow {
  schemaVersion?: number;
  enabled?: boolean;
  startUrl?: string;
  pagePatterns?: string[];
  steps?: Array<Partial<RecordedBrowserAction> & { value?: string }>;
}

export interface LoadedSkill {
  name: string;
  slug: string;
  description: string;
  body: string;
  workflow?: LoadedWorkflow;
}

export async function loadSkills(root = resolve(process.cwd(), "skills")): Promise<LoadedSkill[]> {
  let folders: string[];
  try { folders = await readdir(root); } catch { return []; }
  const skills: LoadedSkill[] = [];
  for (const folder of folders) {
    try {
      const body = await readFile(resolve(root, folder, "SKILL.md"), "utf8");
      const frontmatter = /^---\s*\n([\s\S]*?)\n---/u.exec(body)?.[1] ?? "";
      const name = /^name:\s*(.+)$/mu.exec(frontmatter)?.[1]?.trim() || folder;
      const description = /^description:\s*(.+)$/mu.exec(frontmatter)?.[1]?.trim() || "";
      let workflowText = "";
      let workflow: LoadedWorkflow | undefined;
      try {
        workflowText = (await readFile(resolve(root, folder, "workflow.json"), "utf8")).slice(0, 128_000);
        workflow = JSON.parse(workflowText) as LoadedWorkflow;
      } catch { /* Hand-written Skills do not require a workflow file. */ }
      skills.push({ name, slug: folder, description, body: workflowText ? `${body}\n\nRecorded workflow configuration:\n${workflowText}` : body, workflow });
    } catch { /* Ignore folders without a readable SKILL.md. */ }
  }
  return skills;
}

export function selectSkills(task: string, skills: LoadedSkill[], pageUrl?: string): LoadedSkill[] {
  const selected = selectSkillContext(task, skills, pageUrl);
  const slugs = new Set(selected.map((item) => item.slug));
  return skills.filter((skill) => slugs.has(skill.slug));
}

export function selectSkillContext(task: string, skills: LoadedSkill[], pageUrl?: string): SkillSelection[] {
  const eligible = pageUrl ? skills.filter((skill) => skillMatchesPage(skill, pageUrl)) : skills.filter((skill) => skill.workflow?.enabled !== false);
  const normalizedTask = normalizeSearchText(task);
  const taskTokens = tokenize(normalizedTask);
  const ranked = eligible.map((skill) => {
    const searchable = normalizeSearchText(`${skill.name} ${skill.description}`);
    const skillTokens = tokenize(searchable);
    const tokenHits = skillTokens.filter((token) => taskTokens.some((candidate) => candidate.includes(token) || token.includes(candidate))).length;
    const phraseHit = normalizedTask.includes(normalizeSearchText(skill.name));
    const pageScoped = Boolean(skill.workflow?.startUrl);
    const score = tokenHits * 2 + (phraseHit ? 6 : 0) + (pageScoped ? 3 : 0);
    return { skill, score, tokenHits, pageScoped };
  }).sort((a, b) => b.score - a.score || Number(b.pageScoped) - Number(a.pageScoped));
  let matched = ranked.filter((item) => item.score > (item.pageScoped ? 2 : 0)).slice(0, 3);
  if (!matched.length) matched = ranked.filter((item) => item.skill.slug === "analyze-page").slice(0, 1);
  return matched.map(({ skill, score, tokenHits, pageScoped }) => ({
    name: skill.name,
    slug: skill.slug,
    description: skill.description,
    body: skill.body.slice(0, 24_000),
    score,
    scope: pageScoped ? "page" : "global",
    reason: pageScoped
      ? `Matched the current page${tokenHits ? ` and ${tokenHits} task keyword(s)` : ""}.`
      : `Matched ${Math.max(1, tokenHits)} task keyword(s).`,
  }));
}

function normalizeSearchText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/gu, " ").trim();
}

function tokenize(value: string): string[] {
  const words = value.split(/\s+/u).filter((token) => token.length > 1);
  const chinese = Array.from(value.matchAll(/[\u4e00-\u9fff]{2,}/gu), (match) => match[0]!);
  return Array.from(new Set([...words, ...chinese])).slice(0, 80);
}

export function listSkillsForPage(pageUrl: string, skills: LoadedSkill[]): PageSkillSummary[] {
  const page = safeParseHttpUrl(pageUrl);
  if (!page) return [];
  return skills
    .filter((skill) => skillMatchesPage(skill, page.href, true))
    .map((skill) => summarizeSkill(skill, page))
    .sort((a, b) => Number(b.scope === "page") - Number(a.scope === "page") || a.name.localeCompare(b.name));
}

export function skillMatchesPage(skill: LoadedSkill, pageUrl: string, includeDisabled = false): boolean {
  if (skill.workflow?.enabled === false && !includeDisabled) return false;
  if (!skill.workflow?.startUrl) return true;
  const page = safeParseHttpUrl(pageUrl);
  if (!page) return false;
  return getPagePatterns(skill.workflow).some((pattern) => matchesPagePattern(page, pattern));
}

function summarizeSkill(skill: LoadedSkill, page: URL): PageSkillSummary {
  const start = skill.workflow?.startUrl ? safeParseHttpUrl(skill.workflow.startUrl) : undefined;
  const pagePatterns = skill.workflow ? getPagePatterns(skill.workflow) : [];
  const steps = Array.isArray(skill.workflow?.steps) ? skill.workflow.steps : [];
  const actions = Array.from(new Set(steps.map((step) => step.action).filter((action): action is RecordedActionKind =>
    typeof action === "string" && ["click", "fill", "select", "scroll", "submit"].includes(action),
  )));
  const variableNames = Array.from(new Set(steps.flatMap((step) => typeof step.value === "string"
    ? Array.from(step.value.matchAll(/\{\{([a-z0-9_]+)\}\}/giu), (match) => match[1]!)
    : [])));
  const prefix = start ? normalizedPathPrefix(start.pathname) : undefined;
  return {
    name: skill.name,
    slug: skill.slug,
    description: skill.description,
    enabled: skill.workflow?.enabled !== false,
    configurable: Boolean(skill.workflow),
    scope: start ? "page" : "global",
    match: !start ? "global" : pagePatterns.every(isSimplePrefixPattern) ? prefix === "/" ? "origin" : "path-prefix" : "wildcard",
    ...(start ? { pagePattern: pagePatterns[0] } : {}),
    pagePatterns,
    stepCount: steps.length,
    actions,
    variableNames,
  };
}

export async function configureAutomationSkill(
  slug: string,
  changes: { enabled?: boolean; pagePatterns?: string[] },
  root = resolve(process.cwd(), "skills"),
): Promise<ConfiguredAutomationSkill> {
  const safeSlug = validateSkillSlug(slug);
  const path = resolve(root, safeSlug, "workflow.json");
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
  root = resolve(process.cwd(), "skills"),
): Promise<SavedAutomationSkill> {
  const name = cleanSingleLine(draft.name, 80);
  const description = cleanSingleLine(draft.description, 240);
  if (!name) throw new Error("Skill name is required.");
  if (!draft.steps.length) throw new Error("Record at least one browser action before saving a Skill.");
  if (draft.steps.length > 100) throw new Error("A recorded Skill can contain at most 100 steps.");
  const slug = toSkillSlug(name);
  const folder = resolve(root, slug);
  const workflow = parameterizeWorkflow({ ...draft, name, description });
  await mkdir(folder, { recursive: true });
  await Promise.all([
    writeFile(resolve(folder, "SKILL.md"), renderSkillMarkdown({ ...draft, name, description }, workflow.variableNames), "utf8"),
    writeFile(resolve(folder, "workflow.json"), `${JSON.stringify(workflow.document, null, 2)}\n`, "utf8"),
  ]);
  return {
    name,
    slug,
    skillPath: `skills/${slug}/SKILL.md`,
    workflowPath: `skills/${slug}/workflow.json`,
    variableNames: workflow.variableNames,
  };
}

export function renderSkillMarkdown(draft: AutomationSkillDraft, variableNames: string[]): string {
  const description = cleanSingleLine(draft.description || `Replay the recorded ${draft.name} browser workflow.`, 240);
  return [
    "---",
    `name: ${cleanSingleLine(draft.name, 80)}`,
    `description: ${description}`,
    "---",
    "",
    `# ${cleanSingleLine(draft.name, 80)}`,
    "",
    "Use this Skill only when the active page matches the configured start URL. Inspect the page again if a selector is missing.",
    "",
    "## Safety",
    "",
    "- Ask for confirmation before replaying the workflow.",
    "- Never fill password, payment, token, OTP, file, or credential fields.",
    "- Stop before an irreversible, destructive, purchase, or final-submit action unless the user explicitly confirms it.",
    "- Treat `workflow.json` selectors as hints and revalidate targets against the current page.",
    "",
    "## Inputs",
    "",
    ...(variableNames.length ? variableNames.map((name) => `- \`${name}\`: value requested from the user at run time.`) : ["- No recorded text inputs."]),
    "",
    "## Workflow",
    "",
    "Read `workflow.json`, resolve its variables, create a constrained browser action plan, and show the plan for confirmation before execution.",
    "",
    "<!-- TODO(i18n): Add localized labels and locale matching only when i18n support is enabled. -->",
    "",
  ].join("\n");
}

function parameterizeWorkflow(draft: AutomationSkillDraft) {
  const variableNames: string[] = [];
  let fieldIndex = 0;
  const steps = draft.steps.map((step) => {
    const clean = sanitizeRecordedStep(step);
    if ((clean.action === "fill" || clean.action === "select") && !clean.sensitive) {
      fieldIndex += 1;
      const variable = uniqueVariableName(clean.label, fieldIndex, variableNames);
      variableNames.push(variable);
      return { ...clean, value: `{{${variable}}}` };
    }
    return { ...clean, value: undefined };
  });
  return {
    variableNames,
    document: {
      schemaVersion: 2,
      name: draft.name,
      description: draft.description,
      startUrl: safeHttpUrl(draft.startUrl),
      enabled: true,
      pagePatterns: [defaultPagePattern(safeHttpUrl(draft.startUrl))],
      createdAt: draft.createdAt,
      requiresConfirmation: true,
      steps,
    },
  };
}

function sanitizeRecordedStep(step: RecordedBrowserAction): RecordedBrowserAction {
  if (!["click", "fill", "select", "scroll", "submit"].includes(step.action)) throw new Error("Recorded Skill contains an unsupported action.");
  const url = safeHttpUrl(step.url);
  const selector = step.selector ? cleanSingleLine(step.selector, 500) : undefined;
  if (step.action !== "scroll" && !selector) throw new Error(`Recorded ${step.action} step is missing a selector.`);
  return {
    id: cleanSingleLine(step.id, 100) || crypto.randomUUID(),
    action: step.action,
    url,
    selector,
    label: step.label ? cleanSingleLine(step.label, 160) : undefined,
    sensitive: Boolean(step.sensitive),
    timestamp: Number.isFinite(step.timestamp) ? step.timestamp : Date.now(),
    ...(step.action === "scroll" ? { scrollX: finiteCoordinate(step.scrollX), scrollY: finiteCoordinate(step.scrollY) } : {}),
  };
}

function safeHttpUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Skill URLs must use http(s).");
  url.hash = "";
  return url.toString();
}

function safeParseHttpUrl(value: string): URL | undefined {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url : undefined;
  } catch { return undefined; }
}

function getPagePatterns(workflow: LoadedWorkflow): string[] {
  if (Array.isArray(workflow.pagePatterns) && workflow.pagePatterns.length) {
    try { return normalizePagePatterns(workflow.pagePatterns); } catch { return []; }
  }
  return workflow.startUrl ? [defaultPagePattern(workflow.startUrl)] : [];
}

function defaultPagePattern(value: string): string {
  const url = safeParseHttpUrl(value);
  if (!url) throw new Error("Skill start URL must use http(s).");
  const prefix = normalizedPathPrefix(url.pathname);
  return `${url.origin}${prefix === "/" ? "" : prefix}/**`;
}

function normalizePagePatterns(values: string[]): string[] {
  const unique = Array.from(new Set(values.map((value) => cleanSingleLine(value, 500)).filter(Boolean)));
  if (!unique.length) throw new Error("At least one page pattern is required.");
  if (unique.length > 20) throw new Error("A Skill can have at most 20 page patterns.");
  return unique.map((pattern) => {
    if (/[?#]/u.test(pattern)) throw new Error("Page patterns cannot contain query strings or fragments.");
    const match = /^(https?):\/\/([^/*]+)(\/.*)?$/iu.exec(pattern);
    if (!match || match[2]!.includes("@")) throw new Error("Page patterns require a fixed http(s) origin; wildcards are allowed only in the path.");
    const probe = safeParseHttpUrl(`${match[1]}://${match[2]}/`);
    if (!probe) throw new Error("Page pattern origin is invalid.");
    const path = match[3] || "/**";
    if (!path.startsWith("/") || /[^\p{L}\p{N}\-._~!$&'()+,;=:@/%*]/u.test(path)) throw new Error("Page pattern path contains unsupported characters.");
    return `${probe.origin}${path}`;
  });
}

function matchesPagePattern(page: URL, pattern: string): boolean {
  const match = /^(https?:\/\/[^/]+)(\/.*)$/iu.exec(pattern);
  if (!match || page.origin !== match[1]) return false;
  const pathPattern = match[2]!;
  if (pathPattern === "/**") return true;
  if (pathPattern.endsWith("/**") && !pathPattern.slice(0, -3).includes("*")) {
    const base = normalizedPathPrefix(pathPattern.slice(0, -3));
    return page.pathname === base || page.pathname.startsWith(`${base}/`);
  }
  const escaped = pathPattern.replace(/[.+?^${}()|[\]\\]/gu, "\\$&").replace(/\*\*/gu, "\0").replace(/\*/gu, "[^/]*").replace(/\0/gu, ".*");
  return new RegExp(`^${escaped}$`, "u").test(page.pathname);
}

function isSimplePrefixPattern(pattern: string): boolean {
  return pattern.endsWith("/**") && !pattern.slice(0, -3).includes("*");
}

function validateSkillSlug(value: string): string {
  const slug = cleanSingleLine(value, 64);
  if (!/^[a-z0-9\u4e00-\u9fff](?:[a-z0-9\u4e00-\u9fff-]*[a-z0-9\u4e00-\u9fff])?$/u.test(slug)) throw new Error("Invalid Skill identifier.");
  return slug;
}

function normalizedPathPrefix(value: string): string {
  const normalized = value.replace(/\/+$/gu, "") || "/";
  return normalized.startsWith("/") ? normalized : `/${normalized}`;
}

function finiteCoordinate(value: number | undefined): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(Number(value), 10_000_000)) : 0;
}

function uniqueVariableName(label: string | undefined, index: number, existing: string[]): string {
  const base = (label || `field_${index}`).toLowerCase().replace(/[^a-z0-9]+/gu, "_").replace(/^_+|_+$/gu, "").slice(0, 40) || `field_${index}`;
  let candidate = base;
  let suffix = 2;
  while (existing.includes(candidate)) candidate = `${base}_${suffix++}`;
  return candidate;
}

function toSkillSlug(value: string): string {
  const slug = value.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/gu, "-").replace(/^-+|-+$/gu, "").slice(0, 64);
  if (!slug || slug === "." || slug === "..") throw new Error("Skill name must contain letters or numbers.");
  return slug;
}

function cleanSingleLine(value: string, max: number): string {
  return value.replace(/[\r\n\0]+/gu, " ").replace(/\s+/gu, " ").trim().slice(0, max);
}
