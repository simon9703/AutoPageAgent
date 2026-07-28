import type { PageSnapshot, ScreenshotVisualMark } from "@auto-page-agent/shared";

const SPARSE_PAGE_TEXT_LENGTH = 500;

export function hasVisualContext(snapshot: PageSnapshot): boolean {
  return Boolean(
    snapshot.context?.screenshot?.dataUrl
    || snapshot.context?.selectedElement?.image?.src,
  );
}

export function canCaptureAutomaticScreenshot(snapshot: PageSnapshot): boolean {
  return !hasVisualContext(snapshot)
    && !snapshot.elements.some((element) => element.sensitive);
}

export function shouldCaptureInitialVisualContext(snapshot: PageSnapshot): boolean {
  if (!canCaptureAutomaticScreenshot(snapshot)) return false;
  const signals = snapshot.visualSignals;
  if (!signals) return false;
  if (signals.canvasCount > 0 || signals.videoCount > 0) return true;
  return signals.largeImageCount > 0 && normalizedTextLength(snapshot) < SPARSE_PAGE_TEXT_LENGTH;
}

export function attachViewportScreenshot(
  snapshot: PageSnapshot,
  screenshot: {
    dataUrl: string;
    title?: string;
    url?: string;
    visualMarks?: ScreenshotVisualMark[];
  },
): PageSnapshot {
  return {
    ...snapshot,
    context: {
      ...snapshot.context,
      screenshot: {
        dataUrl: screenshot.dataUrl,
        title: screenshot.title ?? "Current viewport",
        url: screenshot.url ?? snapshot.url,
        ...(screenshot.visualMarks?.length ? { visualMarks: screenshot.visualMarks } : {}),
      },
    },
  };
}

function normalizedTextLength(snapshot: PageSnapshot): number {
  return `${snapshot.title} ${snapshot.headings.map((heading) => heading.text).join(" ")} ${snapshot.mainText}`
    .replace(/\s+/gu, " ")
    .trim()
    .length;
}
