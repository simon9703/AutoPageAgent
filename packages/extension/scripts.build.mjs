import { build } from "esbuild";
import { execFile } from "node:child_process";
import { cp, mkdir } from "node:fs/promises";
import { promisify } from "node:util";

const exec = promisify(execFile);

await mkdir("dist", { recursive: true });
await Promise.all([
  build({ entryPoints: ["src/background.ts"], outfile: "dist/background.js", bundle: true, format: "esm", platform: "browser" }),
  build({ entryPoints: ["src/content.ts"], outfile: "dist/content.js", bundle: true, format: "iife", platform: "browser" }),
  build({ entryPoints: ["src/sidepanel.tsx"], outfile: "dist/sidepanel.js", bundle: true, format: "esm", platform: "browser", jsx: "automatic" }),
  exec(process.execPath, ["../../node_modules/tailwindcss/lib/cli.js", "-i", "src/sidepanel.css", "-o", "dist/sidepanel.css", "--minify"]),
]);
await Promise.all([
  cp("manifest.json", "dist/manifest.json"),
  cp("src/sidepanel.html", "dist/sidepanel.html"),
  cp("assets", "dist/assets", { recursive: true }),
]);
