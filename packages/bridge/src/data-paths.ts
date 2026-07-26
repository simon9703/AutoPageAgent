import { homedir, tmpdir } from "node:os";
import { resolve } from "node:path";

export function getDataRoot(): string {
  const testRoot = process.env.NODE_TEST_CONTEXT
    ? resolve(tmpdir(), "auto-page-agent-tests", String(process.pid))
    : "";
  return resolve(process.env.AUTO_PAGE_AGENT_DATA_DIR || testRoot || resolve(homedir(), ".auto-page-agent"));
}

export function getDataSubdirectory(name: "logs" | "skills"): string {
  return resolve(getDataRoot(), name);
}
