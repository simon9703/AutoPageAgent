import type { AgentEvent, ClientMessage, ServerMessage } from "@auto-page-agent/shared";

const NATIVE_HOST_NAME = "com.auto_page_agent.bridge";
const REQUEST_TIMEOUT_MS = 75_000;

type PendingRequest = {
  resolve: (response: ServerMessage) => void;
  reject: (error: Error) => void;
  onEvent?: (event: AgentEvent) => void;
  timeout: ReturnType<typeof setTimeout>;
};

let port: chrome.runtime.Port | null = null;
const pending = new Map<string, PendingRequest>();

export async function requestBridge(
  message: ClientMessage,
  onEvent?: (event: AgentEvent) => void,
): Promise<ServerMessage> {
  const nativePort = connect();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(message.id);
      reject(new Error("The local bridge did not respond in time."));
    }, REQUEST_TIMEOUT_MS);
    pending.set(message.id, { resolve, reject, onEvent, timeout });
    try {
      nativePort.postMessage(message);
    } catch (error) {
      clearTimeout(timeout);
      pending.delete(message.id);
      reject(new Error(friendlyConnectionError(error instanceof Error ? error.message : String(error))));
    }
  });
}

export function reconnectBridge(): void {
  const current = port;
  port = null;
  current?.disconnect();
}

function connect(): chrome.runtime.Port {
  if (port) return port;
  let nativePort: chrome.runtime.Port;
  try {
    nativePort = chrome.runtime.connectNative(NATIVE_HOST_NAME);
  } catch (error) {
    throw new Error(friendlyConnectionError(error instanceof Error ? error.message : String(error)));
  }
  port = nativePort;
  nativePort.onMessage.addListener(handleMessage);
  nativePort.onDisconnect.addListener(() => {
    if (port !== nativePort) return;
    const reason = friendlyConnectionError(chrome.runtime.lastError?.message ?? "Native host disconnected.");
    const error = new Error(reason);
    for (const request of pending.values()) {
      clearTimeout(request.timeout);
      request.reject(error);
    }
    pending.clear();
    port = null;
    void chrome.runtime.sendMessage({ type: "ui.bridge.disconnected", error: reason }).catch(() => undefined);
  });
  return nativePort;
}

function handleMessage(raw: unknown): void {
  const response = raw as ServerMessage;
  if (!response || typeof response.id !== "string" || typeof response.type !== "string") return;
  const request = pending.get(response.id);
  if (!request) return;
  if (response.type === "agent.event") {
    request.onEvent?.(response.event);
    return;
  }
  clearTimeout(request.timeout);
  pending.delete(response.id);
  request.resolve(response);
}

function friendlyConnectionError(message: string): string {
  const normalized = message.toLowerCase();
  if (
    normalized.includes("native messaging host not found")
    || normalized.includes("host name is not registered")
    || normalized.includes("specified native messaging host")
  ) {
    return "Local bridge is not registered. Run npm run bridge once, reload the extension, then reconnect.";
  }
  if (normalized.includes("access to the specified native messaging host is forbidden")) {
    return "This extension is not allowed by the registered local bridge. Run npm run bridge again, reload the extension, then reconnect.";
  }
  if (normalized.includes("native host has exited") || normalized.includes("disconnected")) {
    return "The local bridge disconnected. Reconnect to let Chrome start it again.";
  }
  return message || "Cannot connect to the local bridge.";
}
