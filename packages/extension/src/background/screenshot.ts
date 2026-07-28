import type { ElementSelectionGeometry, PageSnapshot } from "@auto-page-agent/shared";
import { BACKGROUND_FEATURE_FLAGS } from "./feature-flags.js";
import { calculateScreenshotCrop } from "./screenshot-crop.js";
import { selectScreenshotMarks, type ScreenshotMarkGeometry } from "./screenshot-marks.js";
import { activateTargetTab, getTargetTab, sendPageMessage } from "./tabs.js";

export const MAX_SCREENSHOT_DATA_URL_LENGTH = 2_000_000;
const MAX_SCREENSHOT_BYTES = 1_400_000;
const MAX_SCREENSHOT_DIMENSION = 1_600;

export async function captureScreenshot(targetTabId: number) {
  const tab = await getTargetTab(targetTabId);
  await activateTargetTab(tab.id);
  return captureVisibleViewport(tab);
}

export async function captureAutomaticScreenshot(targetTabId: number, snapshot: PageSnapshot) {
  const tab = await getTargetTab(targetTabId);
  const [activeTab] = await chrome.tabs.query({ active: true, windowId: tab.windowId });
  if (activeTab?.id !== tab.id) return undefined;
  if (!await isSnapshotCurrent(tab.id, snapshot)) return undefined;
  const screenshot = BACKGROUND_FEATURE_FLAGS.automaticScreenshotVisualMarks
    ? await captureMarkedViewport(tab, snapshot)
    : await captureVisibleViewport(tab);
  const [stillActiveTab] = await chrome.tabs.query({ active: true, windowId: tab.windowId });
  if (stillActiveTab?.id !== tab.id || !await isSnapshotCurrent(tab.id, snapshot)) return undefined;
  return screenshot;
}

async function isSnapshotCurrent(tabId: number, snapshot: PageSnapshot) {
  const response = await sendPageMessage<{ valid?: boolean }>(tabId, {
    type: "page.snapshot.validate",
    snapshotId: snapshot.snapshotId,
    url: snapshot.url,
    domVersion: snapshot.domVersion,
  }).catch(() => undefined);
  return response?.valid === true;
}

async function captureVisibleViewport(tab: chrome.tabs.Tab) {
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "jpeg", quality: 82 });
  if (dataUrl.length > MAX_SCREENSHOT_DATA_URL_LENGTH) {
    throw new Error("The viewport screenshot is too large. Reduce the window size or display scale and try again.");
  }
  return { ok: true, dataUrl, url: tab.url, title: tab.title, capturedAt: new Date().toISOString() };
}

async function captureMarkedViewport(tab: chrome.tabs.Tab, snapshot: PageSnapshot) {
  const viewportDataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "jpeg", quality: 82 });
  const response = await fetch(viewportDataUrl);
  const bitmap = await createImageBitmap(await response.blob());
  try {
    const marks = selectScreenshotMarks(snapshot);
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas is unavailable for the visual screenshot.");
    context.drawImage(bitmap, 0, 0);
    drawScreenshotMarks(
      context,
      marks,
      bitmap.width / snapshot.pageInfo.viewportWidth,
      bitmap.height / snapshot.pageInfo.viewportHeight,
    );
    const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.82 });
    const dataUrl = await blobToDataUrl(blob);
    if (dataUrl.length > MAX_SCREENSHOT_DATA_URL_LENGTH) {
      throw new Error("The marked viewport screenshot is too large. Reduce the window size or display scale and try again.");
    }
    return {
      ok: true,
      dataUrl,
      url: tab.url,
      title: tab.title,
      capturedAt: new Date().toISOString(),
      visualMarks: marks.map(({ index, ref }) => ({ index, ref })),
    };
  } finally {
    bitmap.close();
  }
}

function drawScreenshotMarks(
  context: OffscreenCanvasRenderingContext2D,
  marks: ScreenshotMarkGeometry[],
  scaleX: number,
  scaleY: number,
) {
  const scale = Math.max(1, Math.min(scaleX, scaleY));
  const fontSize = Math.max(12, Math.round(12 * scale));
  const paddingX = Math.max(4, Math.round(4 * scale));
  const paddingY = Math.max(2, Math.round(2 * scale));
  const lineWidth = Math.max(2, Math.round(2 * scale));
  context.font = `700 ${fontSize}px sans-serif`;
  context.textBaseline = "top";
  context.lineWidth = lineWidth;

  for (const mark of marks) {
    const x = mark.rect.x * scaleX;
    const y = mark.rect.y * scaleY;
    const width = mark.rect.width * scaleX;
    const height = mark.rect.height * scaleY;
    const label = String(mark.index);
    const labelWidth = Math.ceil(context.measureText(label).width) + paddingX * 2;
    const labelHeight = fontSize + paddingY * 2;
    const labelX = Math.min(Math.max(0, x), Math.max(0, context.canvas.width - labelWidth));
    const labelY = y >= labelHeight
      ? y - labelHeight
      : Math.min(Math.max(0, y), Math.max(0, context.canvas.height - labelHeight));

    context.strokeStyle = "#ef4444";
    context.strokeRect(x + lineWidth / 2, y + lineWidth / 2, Math.max(0, width - lineWidth), Math.max(0, height - lineWidth));
    context.fillStyle = "#ef4444";
    context.fillRect(labelX, labelY, labelWidth, labelHeight);
    context.fillStyle = "#ffffff";
    context.fillText(label, labelX + paddingX, labelY + paddingY);
  }
}

export async function captureRecordingScreenshot(targetTabId: number) {
  const tab = await getTargetTab(targetTabId);
  const [activeTab] = await chrome.tabs.query({ active: true, windowId: tab.windowId });
  if (activeTab?.id !== tab.id) return undefined;
  const viewportDataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "jpeg", quality: 52 });
  const response = await fetch(viewportDataUrl);
  const bitmap = await createImageBitmap(await response.blob());
  try {
    const scale = Math.min(1, 720 / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext("2d");
    if (!context) return undefined;
    context.drawImage(bitmap, 0, 0, width, height);
    const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.5 });
    if (blob.size > 220_000) return undefined;
    return {
      dataUrl: await blobToDataUrl(blob),
      url: tab.url ?? "",
      title: tab.title ?? "",
    };
  } finally {
    bitmap.close();
  }
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
