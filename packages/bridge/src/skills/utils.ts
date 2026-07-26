import { access } from "node:fs/promises";
import type { SkillCategory } from "@auto-page-agent/shared";

export function validateSkillSlug(value: string): string {
  const slug = cleanSingleLine(value, 64);
  if (!/^[a-z0-9\u4e00-\u9fff](?:[a-z0-9\u4e00-\u9fff-]*[a-z0-9\u4e00-\u9fff])?$/u.test(slug)) throw new Error("Invalid Skill identifier.");
  return slug;
}

export function finiteCoordinate(value: number | undefined): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(Number(value), 10_000_000)) : 0;
}

export function uniqueVariableName(label: string | undefined, index: number, existing: string[]): string {
  const base = (label || `field_${index}`).toLowerCase().replace(/[^a-z0-9]+/gu, "_").replace(/^_+|_+$/gu, "").slice(0, 40) || `field_${index}`;
  let candidate = base;
  let suffix = 2;
  while (existing.includes(candidate)) candidate = `${base}_${suffix++}`;
  return candidate;
}

export function toSkillSlug(value: string): string {
  const slug = value.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/gu, "-").replace(/^-+|-+$/gu, "").slice(0, 64);
  if (!slug || slug === "." || slug === "..") throw new Error("Skill name must contain letters or numbers.");
  return slug;
}

export function cleanSingleLine(value: string, max: number): string {
  return value.replace(/[\r\n\0]+/gu, " ").replace(/\s+/gu, " ").trim().slice(0, max);
}

export function normalizeCategory(value: string | undefined): SkillCategory {
  return value === "productivity" || value === "release" || value === "translation" || value === "page" || value === "custom" ? value : "custom";
}

export function normalizeVersion(value: string | undefined): string {
  return /^\d+\.\d+\.\d+$/u.test(value ?? "") ? value! : "1.0.0";
}

export function compareVersions(left: string, right: string): number {
  const a = normalizeVersion(left).split(".").map(Number);
  const b = normalizeVersion(right).split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index]! - b[index]!;
  }
  return 0;
}

export function bumpPatchVersion(value: string): string {
  const [major, minor, patch] = normalizeVersion(value).split(".").map(Number);
  return `${major}.${minor}.${patch + 1}`;
}

export async function pathExists(path: string): Promise<boolean> {
  try { await access(path); return true; } catch { return false; }
}
