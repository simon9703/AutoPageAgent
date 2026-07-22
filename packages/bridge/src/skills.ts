import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

export interface LoadedSkill {
  name: string;
  description: string;
  body: string;
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
      skills.push({ name, description, body });
    } catch { /* Ignore folders without a readable SKILL.md. */ }
  }
  return skills;
}

export function selectSkills(task: string, skills: LoadedSkill[]): LoadedSkill[] {
  const normalized = task.toLowerCase();
  const scored = skills.map((skill) => ({
    skill,
    score: `${skill.name} ${skill.description}`.toLowerCase().split(/[^a-z0-9\u4e00-\u9fff]+/u).filter((token) => token.length > 1 && normalized.includes(token)).length,
  }));
  const matched = scored.filter((item) => item.score > 0).sort((a, b) => b.score - a.score).slice(0, 2).map((item) => item.skill);
  return matched.length ? matched : skills.filter((skill) => skill.name === "analyze-page").slice(0, 1);
}
