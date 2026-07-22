import { build } from "esbuild";
import { cp, mkdir } from "node:fs/promises";

await mkdir("dist", { recursive: true });
await Promise.all([
  build({ entryPoints: ["src/background.ts"], outfile: "dist/background.js", bundle: true, format: "esm", platform: "browser" }),
  build({ entryPoints: ["src/content.ts"], outfile: "dist/content.js", bundle: true, format: "iife", platform: "browser" }),
  build({ entryPoints: ["src/sidepanel.ts"], outfile: "dist/sidepanel.js", bundle: true, format: "esm", platform: "browser" })
]);
await Promise.all([
  cp("manifest.json", "dist/manifest.json"),
  cp("src/sidepanel.html", "dist/sidepanel.html"),
  cp("src/sidepanel.css", "dist/sidepanel.css")
]);
