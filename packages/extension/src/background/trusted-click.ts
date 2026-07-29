export interface TrustedClickPoint {
  x: number;
  y: number;
}

interface DebuggerTarget {
  tabId: number;
}

interface DebuggerApi {
  attach(target: DebuggerTarget, requiredVersion: string): Promise<void>;
  detach(target: DebuggerTarget): Promise<void>;
  sendCommand(target: DebuggerTarget, method: string, commandParams?: object): Promise<unknown>;
}

const MAX_VIEWPORT_COORDINATE = 100_000;

export function validateTrustedClickPoint(point: TrustedClickPoint): TrustedClickPoint {
  if (
    !Number.isFinite(point.x)
    || !Number.isFinite(point.y)
    || point.x < 0
    || point.y < 0
    || point.x > MAX_VIEWPORT_COORDINATE
    || point.y > MAX_VIEWPORT_COORDINATE
  ) {
    throw new Error("The computed dismiss point is outside the valid viewport coordinate range.");
  }
  return { x: Math.round(point.x), y: Math.round(point.y) };
}

export async function dispatchTrustedViewportClick(
  tabId: number,
  point: TrustedClickPoint,
  debuggerApi: DebuggerApi = chrome.debugger,
  wait: (milliseconds: number) => Promise<void> = (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds)),
): Promise<void> {
  if (!Number.isInteger(tabId) || tabId < 0) throw new Error("The target tab is unavailable.");
  const target = { tabId };
  const resolved = validateTrustedClickPoint(point);
  let attached = false;
  try {
    await debuggerApi.attach(target, "1.3");
    attached = true;
    await debuggerApi.sendCommand(target, "Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: resolved.x,
      y: resolved.y,
      button: "none",
      buttons: 0,
      pointerType: "mouse",
    });
    await debuggerApi.sendCommand(target, "Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: resolved.x,
      y: resolved.y,
      button: "left",
      buttons: 1,
      clickCount: 1,
      pointerType: "mouse",
    });
    await wait(40);
    await debuggerApi.sendCommand(target, "Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: resolved.x,
      y: resolved.y,
      button: "left",
      buttons: 0,
      clickCount: 1,
      pointerType: "mouse",
    });
  } finally {
    if (attached) await debuggerApi.detach(target).catch(() => undefined);
  }
}

export async function dispatchTrustedEscape(
  tabId: number,
  debuggerApi: DebuggerApi = chrome.debugger,
): Promise<void> {
  if (!Number.isInteger(tabId) || tabId < 0) throw new Error("The target tab is unavailable.");
  const target = { tabId };
  let attached = false;
  try {
    await debuggerApi.attach(target, "1.3");
    attached = true;
    const keyParams = {
      key: "Escape",
      code: "Escape",
      windowsVirtualKeyCode: 27,
      nativeVirtualKeyCode: 27,
    };
    await debuggerApi.sendCommand(target, "Input.dispatchKeyEvent", {
      type: "rawKeyDown",
      ...keyParams,
    });
    await debuggerApi.sendCommand(target, "Input.dispatchKeyEvent", {
      type: "keyUp",
      ...keyParams,
    });
  } finally {
    if (attached) await debuggerApi.detach(target).catch(() => undefined);
  }
}
