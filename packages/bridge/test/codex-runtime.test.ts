import assert from "node:assert/strict";
import test from "node:test";
import { resolveCodexCommand } from "../src/codex-discovery.js";
import { sanitizedEnvironment } from "../src/codex-app-server.js";

test("configured Codex executable is resolved explicitly", async () => {
  const result = await resolveCodexCommand(process.execPath, { PATH: "" });
  assert.equal(result.available, true);
  assert.equal(result.command, process.execPath);
});

test("invalid configured Codex executable is reported", async () => {
  const result = await resolveCodexCommand("/definitely/missing/codex", { PATH: "" });
  assert.equal(result.available, false);
  assert.equal(result.configuredCommandInvalid, true);
});

test("provider API keys are not inherited by Codex", () => {
  const env = sanitizedEnvironment({ PATH: "/bin", OPENAI_API_KEY: "secret", CODEX_API_KEY_FILE: "/secret" });
  assert.equal(env.PATH, "/bin");
  assert.equal(env.OPENAI_API_KEY, undefined);
  assert.equal(env.CODEX_API_KEY_FILE, undefined);
});
