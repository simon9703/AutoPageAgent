import type { ElementSelectionGeometry } from "@auto-page-agent/shared";
import { calculateScreenshotCrop } from "./screenshot-crop.js";
import { activateTargetTab, getTargetTab } from "./tabs.js";

export const MAX_SCREENSHOT_DATA_URL_LENGTH = 2_000_000;
const MAX_SCREENSHOT_BYTES = 1_400_000;
const MAX_SCREENSHOT_DIMENSION = 1_600;

export async function captureScreenshot(targetTabId: number) {
  const tab = await getTargetTab(targetTabId);
  await activateTargetTab(tab.id);
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "jpeg", quality: 82 });
  if (dataUrl.length > MAX_SCREENSHOT_DATA_URL_LENGTH) {
    throw new Error("The viewport screenshot is too large. Reduce the window size or display scale and try again.");
  }
  return { ok: true, dataUrl, url: tab.url, title: tab.title, capturedAt: new Date().toISOString() };
}

export async function captureSelectedElement(
  tab: chrome.tabs.Tab,
  geometry: ElementSelectionGeometry | undefined,
  tagName: string,
) {
  if (!geometry) throw new Error("The selected element did not provide capture coordinates.");
  const [activeTab] = await chrome.tabs.query({ active: true, windowId: tab.windowId });
  if (activeTab?.id !== tab.id) throw new Error("The selected tab must remain visible while it is captured.");

  const viewportDataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "jpeg", quality: 90 });
  const response = await fetch(viewportDataUrl);
  const bitmap = await createImageBitmap(await response.blob());
  try {
    const crop = calculateScreenshotCrop(geometry, bitmap.width, bitmap.height);
    const dataUrl = await encodeCroppedJpeg(bitmap, crop.source);
    return {
      dataUrl,
      url: tab.url ?? "",
      title: `Selected <${tagName}>`,
    };
  } finally {
    bitmap.close();
  }
}

async function encodeCroppedJpeg(
  bitmap: ImageBitmap,
  source: { x: number; y: number; width: number; height: number },
) {
  let outputScale = Math.min(1, MAX_SCREENSHOT_DIMENSION / Math.max(source.width, source.height));
  let quality = 0.82;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const width = Math.max(1, Math.round(source.width * outputScale));
    const height = Math.max(1, Math.round(source.height * outputScale));
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas is unavailable for the selected-element capture.");
    context.drawImage(bitmap, source.x, source.y, source.width, source.height, 0, 0, width, height);
    const blob = await canvas.convertToBlob({ type: "image/jpeg", quality });
    if (blob.size <= MAX_SCREENSHOT_BYTES) return blobToDataUrl(blob);
    outputScale *= Math.min(0.82, Math.sqrt(MAX_SCREENSHOT_BYTES / blob.size) * 0.92);
    quality = Math.max(0.5, quality - 0.08);
  }
  throw new Error("The selected element screenshot is too large. Select a smaller visible area.");
}

async function blobToDataUrl(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return `data:${blob.type};base64,${btoa(binary)}`;
}
