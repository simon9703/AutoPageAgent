import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const MAX_IMAGE_BYTES = 1_500_000;
const DATA_IMAGE_PATTERN = /^data:image\/(jpeg|png|webp|gif);base64,([a-z0-9+/=\s]+)$/iu;

export type CodexImageInput =
  | { type: "image"; url: string }
  | { type: "localImage"; path: string };

export interface PreparedCodexImage {
  item?: CodexImageInput;
  cleanup: () => Promise<void>;
}

export async function prepareCodexImageInput(source?: string): Promise<PreparedCodexImage> {
  if (!source) return emptyImage();
  if (/^https?:\/\//iu.test(source)) {
    return { item: { type: "image", url: source }, cleanup: async () => undefined };
  }
  const match = DATA_IMAGE_PATTERN.exec(source);
  if (!match) return emptyImage();
  const bytes = Buffer.from(match[2]!.replace(/\s+/gu, ""), "base64");
  if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) return emptyImage();
  const directory = await mkdtemp(join(tmpdir(), "auto-page-agent-image-"));
  const extension = match[1]!.toLowerCase() === "jpeg" ? "jpg" : match[1]!.toLowerCase();
  const path = join(directory, `viewport.${extension}`);
  try {
    await writeFile(path, bytes, { mode: 0o600 });
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
  return {
    item: { type: "localImage", path },
    cleanup: async () => {
      await rm(directory, { recursive: true, force: true });
    },
  };
}

function emptyImage(): PreparedCodexImage {
  return { cleanup: async () => undefined };
}
