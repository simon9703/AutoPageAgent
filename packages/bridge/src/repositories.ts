import { spawn } from "node:child_process";
import { readFile, realpath, stat } from "node:fs/promises";
import { basename, isAbsolute, relative, resolve } from "node:path";
import type { ApiRequestSnapshot, InspectedElement, RepositoryAnalysis, RepositoryEvidence, RepositoryEvidenceKind } from "@auto-page-agent/shared";

export interface RepositoryRoot {
  name: string;
  path: string;
}

interface RepositoryConfigFile {
  repositories?: Array<{ name?: string; path?: string }>;
}

export async function loadRepositoryRoots(cwd = process.cwd()): Promise<RepositoryRoot[]> {
  const configured = await readConfig(resolve(cwd, "auto-page-agent.config.json"));
  const environment = (process.env.AUTO_PAGE_AGENT_REPOS ?? "")
    .split(process.platform === "win32" ? ";" : ":")
    .map((path) => path.trim())
    .filter(Boolean)
    .map((path) => ({ path, name: undefined }));
  const candidates = [...(configured.repositories ?? []), ...environment];
  const roots: RepositoryRoot[] = [];
  for (const candidate of candidates) {
    if (!candidate.path || !isAbsolute(candidate.path)) continue;
    try {
      const path = await realpath(candidate.path);
      if (!(await stat(path)).isDirectory() || roots.some((root) => root.path === path)) continue;
      roots.push({ name: candidate.name?.trim() || basename(path), path });
    } catch { /* Invalid roots are omitted and reported by the empty-repository warning. */ }
  }
  return roots.slice(0, 10);
}

export class LocalRepositoryProvider {
  constructor(readonly roots: RepositoryRoot[]) {}

  async analyze(element: InspectedElement, apiRequests: ApiRequestSnapshot[] = []): Promise<RepositoryAnalysis> {
    const terms = createRepositoryQueryTerms(element, apiRequests);
    const warnings: string[] = [];
    if (!this.roots.length) warnings.push("No local repositories are configured. Add auto-page-agent.config.json or AUTO_PAGE_AGENT_REPOS.");
    if (!terms.length) warnings.push("The selected element did not contain specific searchable evidence.");
    const evidence: RepositoryEvidence[] = await resolveDirectSourceEvidence(this.roots, element);
    for (const term of terms.slice(0, 8)) {
      for (const root of this.roots) {
        const matches = await searchWithRipgrep(root, term.value).catch((error) => {
          if (!warnings.includes(error.message)) warnings.push(error.message);
          return [];
        });
        for (const match of matches) {
          evidence.push({
            kind: classifyEvidence(match.preview, match.path, term.source),
            repository: root.name,
            path: match.path,
            line: match.line,
            preview: match.preview,
            matchedTerm: term.value,
            confidence: term.confidence,
          });
        }
      }
    }
    evidence.push(...await enrichApiEvidence(this.roots, evidence));
    return {
      queryTerms: terms.map((term) => term.value),
      repositories: this.roots.map((root) => root.name),
      evidence: dedupeEvidence(evidence).sort(compareEvidence).slice(0, 40),
      warnings,
    };
  }
}

async function enrichApiEvidence(roots: RepositoryRoot[], primary: RepositoryEvidence[]): Promise<RepositoryEvidence[]> {
  const candidates = Array.from(new Set(primary.map((item) => `${item.repository}\0${item.path}`))).slice(0, 20);
  const result: RepositoryEvidence[] = [];
  for (const key of candidates) {
    const [repository, path] = key.split("\0");
    const root = roots.find((item) => item.name === repository);
    if (!root || !path) continue;
    try {
      const candidate = await realpath(resolve(root.path, path));
      if (relative(root.path, candidate).startsWith("..")) continue;
      const lines = (await readFile(candidate, "utf8")).split(/\r?\n/u);
      for (let index = 0; index < lines.length; index += 1) {
        const preview = lines[index]?.trim() ?? "";
        if (!/\b(?:fetch|axios|request|endpoint|useQuery|useMutation)\b|["'`]\/api\//iu.test(preview)) continue;
        result.push({ kind: "api", repository: root.name, path, line: index + 1, preview: preview.slice(0, 500), matchedTerm: "API usage near matched source", confidence: "medium" });
        if (result.length >= 20) return result;
      }
    } catch { /* Evidence enrichment is best-effort. */ }
  }
  return result;
}

async function resolveDirectSourceEvidence(roots: RepositoryRoot[], element: InspectedElement): Promise<RepositoryEvidence[]> {
  const sourceValue = element.source?.file?.trim();
  if (!sourceValue) return [];
  const match = /^(.*?)(?::(\d+)(?::\d+)?)?$/u.exec(sourceValue);
  const sourcePath = match?.[1]?.replace(/^[/\\]+/u, "");
  if (!sourcePath || sourcePath.includes("\0")) return [];
  const line = Number(match?.[2] ?? 1);
  const preferred = element.source?.repository
    ? roots.filter((root) => root.name.toLowerCase() === element.source?.repository?.toLowerCase())
    : roots;
  const candidates = preferred.length ? preferred : roots;
  const evidence: RepositoryEvidence[] = [];
  for (const root of candidates) {
    try {
      const candidate = await realpath(resolve(root.path, sourcePath));
      const relativePath = relative(root.path, candidate);
      if (relativePath.startsWith("..") || !(await stat(candidate)).isFile()) continue;
      const lines = (await readFile(candidate, "utf8")).split(/\r?\n/u);
      evidence.push({
        kind: "source",
        repository: root.name,
        path: relativePath,
        line: Math.max(1, Math.min(line, lines.length)),
        preview: String(lines[Math.max(0, line - 1)] ?? "Direct source metadata match").trim().slice(0, 500),
        matchedTerm: sourceValue,
        confidence: "high",
      });
    } catch { /* A source hint is evidence only when the file resolves inside a configured root. */ }
  }
  return evidence;
}

type QueryTerm = { value: string; confidence: RepositoryEvidence["confidence"]; source: "source" | "component" | "attribute" | "text" | "network" };

export function createRepositoryQueryTerms(element: InspectedElement, apiRequests: ApiRequestSnapshot[] = []): QueryTerm[] {
  // TODO(i18n): Prefer an explicit i18n key before visible text when the protocol exposes one.
  const raw: QueryTerm[] = [
    ...(element.source?.file ? [{ value: element.source.file, confidence: "high" as const, source: "source" as const }] : []),
    ...(element.source?.component ? [{ value: element.source.component, confidence: "high" as const, source: "component" as const }] : []),
    ...["data-field", "data-testid", "name", "id"].flatMap((name) => element.attributes[name]
      ? [{ value: element.attributes[name], confidence: "medium" as const, source: "attribute" as const }]
      : []),
    ...[element.label, element.placeholder, element.text].filter(Boolean).map((value) => ({ value: value!, confidence: "low" as const, source: "text" as const })),
    ...selectApiPathTerms(apiRequests).map((value) => ({ value, confidence: "low" as const, source: "network" as const })),
  ];
  const seen = new Set<string>();
  return raw
    .map((term) => ({ ...term, value: normalizeQueryTerm(term.value) }))
    .filter((term) => term.value.length >= 2 && term.value.length <= 120 && !isGenericTerm(term.value))
    .filter((term) => {
      const key = term.value.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

async function searchWithRipgrep(root: RepositoryRoot, term: string): Promise<Array<{ path: string; line: number; preview: string }>> {
  return new Promise((resolveSearch, reject) => {
    const child = spawn("rg", [
      "--json", "--fixed-strings", "--line-number", "--max-count", "8",
      "--glob", "!node_modules/**", "--glob", "!dist/**", "--glob", "!build/**", "--glob", "!coverage/**",
      "--glob", "!*.map", "--glob", "!package-lock.json", "--glob", "!pnpm-lock.yaml", "--glob", "!yarn.lock",
      term, root.path,
    ], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill(), 5_000);
    child.stdout.on("data", (chunk) => { if (stdout.length < 2_000_000) stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { if (stderr.length < 4_000) stderr += String(chunk); });
    child.on("error", () => { clearTimeout(timer); reject(new Error("Repository search requires ripgrep (rg) on PATH.")); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0 && code !== 1) return reject(new Error(`Repository search failed: ${stderr.trim() || `rg exited with ${code}`}`));
      resolveSearch(stdout.split(/\r?\n/u).flatMap((line) => parseRipgrepMatch(line, root.path)).slice(0, 8));
    });
  });
}

function parseRipgrepMatch(line: string, root: string): Array<{ path: string; line: number; preview: string }> {
  if (!line) return [];
  try {
    const event = JSON.parse(line) as { type?: string; data?: { path?: { text?: string }; line_number?: number; lines?: { text?: string } } };
    if (event.type !== "match" || !event.data?.path?.text || !event.data.line_number) return [];
    const path = relative(root, event.data.path.text);
    if (path.startsWith("..")) return [];
    return [{ path, line: event.data.line_number, preview: String(event.data.lines?.text ?? "").trim().slice(0, 500) }];
  } catch { return []; }
}

function classifyEvidence(preview: string, path: string, source: QueryTerm["source"]): RepositoryEvidenceKind {
  if (source === "network") return "api";
  if (source === "source" || /\.(?:tsx?|jsx?|vue|svelte)$/iu.test(path) && /component|render|return\s*\(/iu.test(preview)) return "source";
  if (/\b(?:fetch|axios|request|endpoint|api|query|mutation)\b|\/api\//iu.test(`${path} ${preview}`)) return "api";
  if (source === "component" || /\b(?:interface|type|class|function|const)\b/u.test(preview)) return "symbol";
  return "text";
}

function selectApiPathTerms(requests: ApiRequestSnapshot[]): string[] {
  const seen = new Set<string>();
  return [...requests]
    .sort((left, right) => right.duration - left.duration)
    .map((request) => request.pathname.replace(/\/\d+(?=\/|$)/gu, "/:id"))
    .filter((path) => path.length >= 4 && path.length <= 180)
    .filter((path) => {
      const key = path.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 8);
}

function dedupeEvidence(evidence: RepositoryEvidence[]): RepositoryEvidence[] {
  const seen = new Set<string>();
  return evidence.filter((item) => {
    const key = `${item.repository}:${item.path}:${item.line}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function compareEvidence(left: RepositoryEvidence, right: RepositoryEvidence): number {
  const score = { high: 3, medium: 2, low: 1 };
  return score[right.confidence] - score[left.confidence] || left.repository.localeCompare(right.repository) || left.path.localeCompare(right.path) || left.line - right.line;
}

function normalizeQueryTerm(value: string): string {
  return value.replace(/\s+/gu, " ").trim().replace(/^['"]|['"]$/gu, "");
}

function isGenericTerm(value: string): boolean {
  return /^(?:div|span|button|input|submit|click|true|false|undefined|null|确定|取消|提交|按钮)$/iu.test(value);
}

async function readConfig(path: string): Promise<RepositoryConfigFile> {
  try { return JSON.parse(await readFile(path, "utf8")) as RepositoryConfigFile; }
  catch { return {}; }
}
