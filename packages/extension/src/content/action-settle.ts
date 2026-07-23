import type { BrowserActionStep } from "@auto-page-agent/shared";

export function getActionSettlePolicy(action: BrowserActionStep["action"]): { maxWaitMs: number; quietMs: number } {
  if (action === "fill" || action === "focus") return { maxWaitMs: 160, quietMs: 80 };
  if (action === "select") return { maxWaitMs: 900, quietMs: 180 };
  if (action === "scroll") return { maxWaitMs: 700, quietMs: 160 };
  return { maxWaitMs: 1_800, quietMs: 250 };
}
