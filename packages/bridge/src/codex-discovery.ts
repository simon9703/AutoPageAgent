import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { delimiter, isAbsolute, join } from "node:path";

export interface CodexCommandResolution {
  available: boolean;
  command?: string;
  configuredCommandInvalid: boolean;
}

export async function resolveCodexCommand(configured = process.env.CODEX_PATH ?? "", env: NodeJS.ProcessEnv = process.env): Promise<CodexCommandResolution> {
  const explicit = configured.trim();
  if (explicit) {
    const resolved = await resolveCandidate(explicit, env);
    return resolved
      ? { available: true, command: resolved, configuredCommandInvalid: false }
      : { available: false, configuredCommandInvalid: true };
  }
  const resolved = await resolveCandidate("codex", env);
  return resolved
    ? { available: true, command: resolved, configuredCommandInvalid: false }
    : { available: false, configuredCommandInvalid: false };
}

async function resolveCandidate(candidate: string, env: NodeJS.ProcessEnv): Promise<string | null> {
  if (isAbsolute(candidate) || candidate.includes("/") || candidate.includes("\\")) return await isExecutable(candidate) ? candidate : null;
  const extensions = process.platform === "win32"
    ? (env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").map((value) => value.toLowerCase())
    : [""];
  for (const folder of (env.PATH ?? "").split(delimiter).filter(Boolean)) {
    for (const extension of extensions) {
      const path = join(folder, process.platform === "win32" ? `${candidate}${extension}` : candidate);
      if (await isExecutable(path)) return path;
    }
  }
  return null;
}

async function isExecutable(path: string): Promise<boolean> {
  try {
    await access(path, process.platform === "win32" ? constants.F_OK : constants.X_OK);
    return true;
  } catch { return false; }
}
