import type { PageSnapshot } from "@auto-page-agent/shared";
import { isNearViewport, isVisible } from "./dom.js";

const LARGE_VISUAL_VIEWPORT_RATIO = 0.12;

export function collectVisualSignals(): NonNullable<PageSnapshot["visualSignals"]> {
  const viewportArea = Math.max(1, window.innerWidth * window.innerHeight);
  const surfaces = Array.from(document.querySelectorAll("img,canvas,video"))
    .filter((element) => isVisible(element) && isNearViewport(element, 0));
  return {
    imageCount: surfaces.filter((element) => element instanceof HTMLImageElement).length,
    largeImageCount: surfaces.filter((element) => {
      if (!(element instanceof HTMLImageElement)) return false;
      const rect = element.getBoundingClientRect();
      return rect.width * rect.height >= viewportArea * LARGE_VISUAL_VIEWPORT_RATIO;
    }).length,
    canvasCount: surfaces.filter((element) => element instanceof HTMLCanvasElement).length,
    videoCount: surfaces.filter((element) => element instanceof HTMLVideoElement).length,
  };
}
