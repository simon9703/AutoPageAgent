import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import readline from "node:readline";

type JsonRpcMessage = {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { message?: string };
};

export class CodexAppServerClient {
  #process: ChildProcessWithoutNullStreams | null = null;
  #startPromise: Promise<void> | null = null;
  #initialized = false;
  #nextId = 1;
  #pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  #notifications = new Set<(message: JsonRpcMessage) => void>();

  async request<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    await this.#ensureStarted();
    return this.#requestInternal<T>(method, params);
  }

  #requestInternal<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const id = this.#nextId++;
    return new Promise<T>((resolve, reject) => {
      this.#pending.set(id, { resolve: (value) => resolve(value as T), reject });
      this.#write({ id, method, params });
    });
  }

  onNotification(handler: (message: JsonRpcMessage) => void) {
    this.#notifications.add(handler);
    return () => { this.#notifications.delete(handler); };
  }

  async #ensureStarted() {
    if (this.#initialized) return;
    if (!this.#startPromise) this.#startPromise = this.#start().finally(() => { this.#startPromise = null; });
    await this.#startPromise;
  }

  async #start() {
    const command = process.env.CODEX_PATH || "codex";
    const child = spawn(command, ["app-server", "--listen", "stdio://"], {
      stdio: ["pipe", "pipe", "pipe"],
      env: sanitizedEnvironment(process.env),
    });
    this.#process = child;
    child.stderr.on("data", (chunk) => process.stderr.write(`[codex] ${String(chunk)}`));
    child.on("exit", (code) => this.#failAll(new Error(`codex app-server exited with code ${code ?? "unknown"}`)));
    child.on("error", (error) => this.#failAll(error));
    readline.createInterface({ input: child.stdout }).on("line", (line) => this.#handleLine(line));
    await new Promise<void>((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    });
    try {
      await this.#requestInternal("initialize", {
        clientInfo: { name: "auto-page-agent", title: "Auto Page Agent", version: "0.2.0" },
        capabilities: {},
      });
      this.#write({ method: "initialized", params: {} });
      this.#initialized = true;
    } catch (error) {
      child.kill();
      const startupError = error instanceof Error ? error : new Error(String(error));
      this.#failAll(startupError);
      throw startupError;
    }
  }

  #write(message: JsonRpcMessage) {
    if (!this.#process?.stdin.writable) throw new Error("Codex app-server stdin is unavailable.");
    this.#process.stdin.write(`${JSON.stringify(message)}\n`);
  }

  #handleLine(line: string) {
    if (!line.trim()) return;
    let message: JsonRpcMessage;
    try { message = JSON.parse(line) as JsonRpcMessage; } catch { return; }
    if (typeof message.id === "number" && this.#pending.has(message.id)) {
      const pending = this.#pending.get(message.id)!;
      this.#pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message || "Codex request failed."));
      else pending.resolve(message.result);
      return;
    }
    if (message.method) for (const handler of this.#notifications) handler(message);
  }

  #failAll(error: Error) {
    for (const pending of this.#pending.values()) pending.reject(error);
    this.#pending.clear();
    this.#process = null;
    this.#initialized = false;
  }
}

export function sanitizedEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env = { ...source };
  for (const key of Object.keys(env)) {
    if (["OPENAI_API_KEY", "CODEX_API_KEY", "OPENAI_API_KEY_FILE", "CODEX_API_KEY_FILE"].includes(key.toUpperCase())) delete env[key];
  }
  return env;
}
