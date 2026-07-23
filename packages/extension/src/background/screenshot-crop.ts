import type { ElementSelectionGeometry, ViewportRect } from "@auto-page-agent/shared";

export interface ScreenshotCropRegion {
  source: ViewportRect;
  visibleCssRect: ViewportRect;
  scaleX: number;
  scaleY: number;
}

export function calculateScreenshotCrop(
  geometry: ElementSelectionGeometry,
  screenshotWidth: number,
  screenshotHeight: number,
): ScreenshotCropRegion {
  const { rect, viewportWidth, viewportHeight } = geometry;
  if (![rect.x, rect.y, rect.width, rect.height, viewportWidth, viewportHeight, screenshotWidth, screenshotHeight].every(Number.isFinite)) {
    throw new Error("The selected element has invalid crop coordinates.");
  }
  if (viewportWidth <= 0 || viewportHeight <= 0 || screenshotWidth <= 0 || screenshotHeight <= 0 || rect.width <= 0 || rect.height <= 0) {
    throw new Error("The selected element has no visible area to capture.");
  }

  const left = clamp(rect.x, 0, viewportWidth);
  const top = clamp(rect.y, 0, viewportHeight);
  const right = clamp(rect.x + rect.width, 0, viewportWidth);
  const bottom = clamp(rect.y + rect.height, 0, viewportHeight);
  if (right <= left || bottom <= top) throw new Error("The selected element is outside the visible viewport.");

  const scaleX = screenshotWidth / viewportWidth;
  const scaleY = screenshotHeight / viewportHeight;
  const sourceLeft = clamp(Math.floor(left * scaleX), 0, screenshotWidth - 1);
  const sourceTop = clamp(Math.floor(top * scaleY), 0, screenshotHeight - 1);
  const sourceRight = clamp(Math.ceil(right * scaleX), sourceLeft + 1, screenshotWidth);
  const sourceBottom = clamp(Math.ceil(bottom * scaleY), sourceTop + 1, screenshotHeight);

  return {
    source: { x: sourceLeft, y: sourceTop, width: sourceRight - sourceLeft, height: sourceBottom - sourceTop },
    visibleCssRect: { x: left, y: top, width: right - left, height: bottom - top },
    scaleX,
    scaleY,
  };
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}
