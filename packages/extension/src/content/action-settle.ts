import type { BrowserActionStep } from "@auto-page-agent/shared";

export interface ActionSettlePolicy {
  maxWaitMs: number;
  quietMs: number;
  minWaitMs?: number;
  pollMs?: number;
  waitForOption?: boolean;
}

export interface DelayedActionObservationPolicy {
  maxWaitMs: number;
  quietMs: number;
  pollMs: number;
}

export function getActionSettlePolicy(
  action: BrowserActionStep["action"],
  options: { comboboxClick?: boolean } = {},
): ActionSettlePolicy {
  if (action === "click" && options.comboboxClick) {
    return { minWaitMs: 250, maxWaitMs: 1_200, quietMs: 150, pollMs: 90, waitForOption: true };
  }
  if (action === "fill" || action === "focus") return { maxWaitMs: 160, quietMs: 80 };
  if (action === "select") return { maxWaitMs: 900, quietMs: 180 };
  if (action === "dismiss") return { maxWaitMs: 900, quietMs: 180 };
  if (action === "scroll") return { maxWaitMs: 700, quietMs: 160 };
  return { maxWaitMs: 1_800, quietMs: 250 };
}

export function getDelayedActionObservationPolicy(
  action: BrowserActionStep["action"],
): DelayedActionObservationPolicy | undefined {
  if (action !== "click" && action !== "submit" && action !== "dismiss") return undefined;
  return { maxWaitMs: 2_500, quietMs: 250, pollMs: 100 };
}
