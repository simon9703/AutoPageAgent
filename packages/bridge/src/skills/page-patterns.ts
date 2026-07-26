import type { LoadedWorkflow } from "./model.js";
import { cleanSingleLine } from "./utils.js";

export function safeHttpUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Skill URLs must use http(s).");
  url.hash = "";
  return url.toString();
}

export function safeParseHttpUrl(value: string): URL | undefined {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url : undefined;
  } catch { return undefined; }
}

export function getPagePatterns(workflow: LoadedWorkflow): string[] {
  if (Array.isArray(workflow.pagePatterns) && workflow.pagePatterns.length) {
    try { return normalizePagePatterns(workflow.pagePatterns); } catch { return []; }
  }
  return workflow.startUrl ? [defaultPagePattern(workflow.startUrl)] : [];
}

export function defaultPagePattern(value: string): string {
  const url = safeParseHttpUrl(value);
  if (!url) throw new Error("Skill start URL must use http(s).");
  const prefix = normalizedPathPrefix(url.pathname);
  return `${url.origin}${prefix === "/" ? "" : prefix}/**`;
}

export function normalizePagePatterns(values: string[]): string[] {
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

export function matchesPagePattern(page: URL, pattern: string): boolean {
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

export function isSimplePrefixPattern(pattern: string): boolean {
  return pattern.endsWith("/**") && !pattern.slice(0, -3).includes("*");
}

export function normalizedPathPrefix(value: string): string {
  const normalized = value.replace(/\/+$/gu, "") || "/";
  return normalized.startsWith("/") ? normalized : `/${normalized}`;
}
