import type { PageSkillSummary, RecordedActionKind, SkillSelection } from "@auto-page-agent/shared";
import type { LoadedSkill } from "./model.js";
import {
  getPagePatterns,
  isSimplePrefixPattern,
  matchesPagePattern,
  normalizedPathPrefix,
  safeParseHttpUrl,
} from "./page-patterns.js";

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
    typeof action === "string" && ["click", "fill", "select", "scroll", "submit", "navigate"].includes(action),
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

function normalizeSearchText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/gu, " ").trim();
}

function tokenize(value: string): string[] {
  const words = value.split(/\s+/u).filter((token) => token.length > 1);
  const chinese = Array.from(value.matchAll(/[\u4e00-\u9fff]{2,}/gu), (match) => match[0]!);
  return Array.from(new Set([...words, ...chinese])).slice(0, 80);
}
