import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { access, chmod, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HOST_NAME = "com.auto_page_agent.bridge";
const SUPPORTED_BROWSERS = new Set(["chrome", "chrome-beta", "chrome-dev", "chrome-canary", "chromium"]);
const scriptDir = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDir, "..");
const extensionIdArgument = process.argv.slice(2).find((argument) => !argument.startsWith("--"));
const browserArgument = process.argv.find((argument) => argument.startsWith("--browser="));
const browsers = new Set((browserArgument?.slice("--browser=".length) || "chrome").split(",").map((value) => value.trim()).filter(Boolean));

for (const browser of browsers) {
  if (!SUPPORTED_BROWSERS.has(browser)) throw new Error(`Unsupported browser: ${browser}`);
}

const extensionManifestPath = resolve(repositoryRoot, "packages/extension/manifest.json");
const extensionManifest = JSON.parse(await readFile(extensionManifestPath, "utf8"));
const derivedExtensionId = deriveExtensionId(extensionManifest.key);
const extensionId = extensionIdArgument || derivedExtensionId;
if (!/^[a-p]{32}$/u.test(extensionId)) {
  throw new Error("Pass the 32-character extension ID, or keep the extension manifest key so it can be derived.");
}

const currentPlatform = platform();
const installRoot = resolveInstallRoot(currentPlatform);
const hostInstallDir = resolve(installRoot, "native-host");
const launcherPath = resolve(hostInstallDir, currentPlatform === "win32" ? "run-bridge.cmd" : "run-bridge");
const manifestTargets = resolveManifestTargets(currentPlatform, browsers);

await assertExists(resolve(repositoryRoot, "packages/bridge/dist/index.js"), "Run npm run build before installing the bridge.");
await assertExists(resolve(repositoryRoot, "packages/shared/dist/index.js"), "Run npm run build before installing the bridge.");

await rm(hostInstallDir, { recursive: true, force: true });
await mkdir(resolve(hostInstallDir, "bridge"), { recursive: true });
await mkdir(resolve(hostInstallDir, "node_modules/@auto-page-agent/shared"), { recursive: true });
await cp(resolve(repositoryRoot, "packages/bridge/dist"), resolve(hostInstallDir, "bridge/dist"), { recursive: true });
await cp(resolve(repositoryRoot, "packages/shared/dist"), resolve(hostInstallDir, "node_modules/@auto-page-agent/shared/dist"), { recursive: true });
await cp(resolve(repositoryRoot, "skills"), resolve(hostInstallDir, "skills"), { recursive: true });
await writeFile(resolve(hostInstallDir, "package.json"), `${JSON.stringify({ type: "module" }, null, 2)}\n`);
await writeFile(
  resolve(hostInstallDir, "node_modules/@auto-page-agent/shared/package.json"),
  `${JSON.stringify({ name: "@auto-page-agent/shared", type: "module", main: "dist/index.js" }, null, 2)}\n`,
);
await copyIfPresent(resolve(repositoryRoot, "auto-page-agent.config.json"), resolve(hostInstallDir, "auto-page-agent.config.json"));
await writeLauncher(currentPlatform, launcherPath, hostInstallDir);

for (const target of manifestTargets) {
  await mkdir(target.manifestDir, { recursive: true });
  const manifestPath = resolve(target.manifestDir, `${HOST_NAME}.json`);
  await writeFile(manifestPath, `${JSON.stringify({
    name: HOST_NAME,
    description: "Auto Page Agent local Codex bridge",
    path: launcherPath,
    type: "stdio",
    allowed_origins: [`chrome-extension://${extensionId}/`],
  }, null, 2)}\n`);
  if (target.registryKey) registerWindowsHost(target.registryKey, manifestPath);
  console.log(`Registered ${target.label}: ${manifestPath}`);
}

console.log(`Extension ID: ${extensionId}`);
console.log("The bridge is installed. Reload Auto Page Agent in Chrome and use Reconnect; no dev server is required.");

function deriveExtensionId(key) {
  if (typeof key !== "string" || !key.trim()) return "";
  const digest = createHash("sha256").update(Buffer.from(key, "base64")).digest("hex").slice(0, 32);
  return digest.replace(/[0-9a-f]/gu, (character) => String.fromCharCode(97 + Number.parseInt(character, 16)));
}

function resolveInstallRoot(platformFamily) {
  if (platformFamily === "darwin") return resolve(homedir(), "Library/Application Support/AutoPageAgent");
  if (platformFamily === "win32") return resolve(process.env.LOCALAPPDATA || resolve(homedir(), "AppData/Local"), "AutoPageAgent");
  return resolve(process.env.XDG_CONFIG_HOME || resolve(homedir(), ".config"), "auto-page-agent");
}

function resolveManifestTargets(platformFamily, selectedBrowsers) {
  if (platformFamily === "win32") {
    return [{
      label: "Chrome/Chromium (current user)",
      manifestDir: resolveInstallRoot(platformFamily),
      registryKey: `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST_NAME}`,
    }];
  }
  const home = homedir();
  const definitions = platformFamily === "darwin"
    ? {
        chrome: ["Google Chrome", "Library/Application Support/Google/Chrome/NativeMessagingHosts"],
        "chrome-beta": ["Google Chrome Beta", "Library/Application Support/Google/Chrome Beta/NativeMessagingHosts"],
        "chrome-dev": ["Google Chrome Dev", "Library/Application Support/Google/Chrome Dev/NativeMessagingHosts"],
        "chrome-canary": ["Google Chrome Canary", "Library/Application Support/Google/Chrome Canary/NativeMessagingHosts"],
        chromium: ["Chromium", "Library/Application Support/Chromium/NativeMessagingHosts"],
      }
    : {
        chrome: ["Google Chrome", ".config/google-chrome/NativeMessagingHosts"],
        "chrome-beta": ["Google Chrome Beta", ".config/google-chrome-beta/NativeMessagingHosts"],
        "chrome-dev": ["Google Chrome Dev", ".config/google-chrome-unstable/NativeMessagingHosts"],
        "chrome-canary": ["Google Chrome Canary", ".config/google-chrome-unstable/NativeMessagingHosts"],
        chromium: ["Chromium", ".config/chromium/NativeMessagingHosts"],
      };
  return [...selectedBrowsers].map((browser) => ({
    label: definitions[browser][0],
    manifestDir: resolve(home, definitions[browser][1]),
  }));
}

async function writeLauncher(platformFamily, path, hostDir) {
  const entry = resolve(hostDir, "bridge/dist/index.js");
  const skills = resolve(hostDir, "skills");
  const executablePath = process.env.PATH || "";
  if (platformFamily === "win32") {
    await writeFile(path, `@echo off\r\ncd /d "${hostDir}"\r\nset "PATH=${executablePath}"\r\nset "AUTO_PAGE_AGENT_BUNDLED_SKILLS=${skills}"\r\n"${process.execPath}" "${entry}"\r\n`);
    return;
  }
  await writeFile(path, `#!/bin/sh\ncd ${shellQuote(hostDir)} || exit 1\nexport PATH=${shellQuote(executablePath)}\nexport AUTO_PAGE_AGENT_BUNDLED_SKILLS=${shellQuote(skills)}\nexec ${shellQuote(process.execPath)} ${shellQuote(entry)}\n`);
  await chmod(path, 0o755);
}

function registerWindowsHost(registryKey, manifestPath) {
  for (const view of ["/reg:32", "/reg:64"]) {
    const result = spawnSync("reg", ["add", registryKey, "/ve", "/t", "REG_SZ", "/d", manifestPath, "/f", view], { encoding: "utf8" });
    if (result.status !== 0) throw new Error(result.stderr.trim() || `Failed to register ${registryKey} ${view}`);
  }
}

function shellQuote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

async function assertExists(path, message) {
  try { await access(path); } catch { throw new Error(message); }
}

async function copyIfPresent(source, destination) {
  try { await cp(source, destination); } catch { /* Optional local repository configuration. */ }
}
