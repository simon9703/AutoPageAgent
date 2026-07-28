import type {
  PageSnapshot,
  ScreenshotVisualMark,
  ViewportRect,
} from "@auto-page-agent/shared";

export interface ScreenshotMarkGeometry extends ScreenshotVisualMark {
  rect: ViewportRect;
}

const MAX_VISUAL_MARKS = 80;
const CONTAINER_ROLES = new Set(["dialog", "listbox", "menu"]);

export function selectScreenshotMarks(
  snapshot: PageSnapshot,
  limit = MAX_VISUAL_MARKS,
): ScreenshotMarkGeometry[] {
  const { viewportWidth, viewportHeight } = snapshot.pageInfo;
  if (viewportWidth <= 0 || viewportHeight <= 0 || limit <= 0) return [];

  return snapshot.elements.flatMap((element, position) => {
    if (
      !element.inViewport
      || element.occluded
      || element.disabled
      || element.sensitive
      || CONTAINER_ROLES.has(element.role)
    ) return [];
    const rect = clipToViewport(element.viewportRect, viewportWidth, viewportHeight);
    if (!rect || rect.width < 2 || rect.height < 2) return [];
    return [{
      index: position + 1,
      ref: element.ref,
      rect,
    }];
  }).slice(0, limit);
}

function clipToViewport(
  rect: ViewportRect,
  viewportWidth: number,
  viewportHeight: number,
): ViewportRect | undefined {
  if (![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)) return undefined;
  const left = Math.max(0, rect.x);
  const top = Math.max(0, rect.y);
  const right = Math.min(viewportWidth, rect.x + rect.width);
  const bottom = Math.min(viewportHeight, rect.y + rect.height);
  if (right <= left || bottom <= top) return undefined;
  return { x: left, y: top, width: right - left, height: bottom - top };
}
