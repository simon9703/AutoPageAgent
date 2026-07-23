import type { ChatMessage } from "@auto-page-agent/shared";

const PENDING_AGENT_RUN_KEY = "pendingAgentRun";

export interface PendingAgentRun {
  task: string;
  conversationId: string;
  history: ChatMessage[];
  snapshotId: string;
  tabId: number;
  windowId: number;
  pageUrl: string;
}

export interface SessionStorageArea {
  get(keys: string | string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}

export class PendingAgentRunStore {
  private memory: PendingAgentRun | null = null;
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(private readonly storage: SessionStorageArea) {}

  async save(run: PendingAgentRun): Promise<void> {
    await this.mutate(async () => {
      this.memory = run;
      await this.storage.set({ [PENDING_AGENT_RUN_KEY]: run });
    });
  }

  async loadForPlan(snapshotId: string): Promise<PendingAgentRun> {
    if (this.memory?.snapshotId === snapshotId) return this.memory;

    await this.mutationQueue;
    const stored = await this.storage.get(PENDING_AGENT_RUN_KEY);
    const restored = parsePendingAgentRun(stored[PENDING_AGENT_RUN_KEY]);
    if (!restored) throw new Error("The original agent task expired. Run the task again.");
    if (restored.snapshotId !== snapshotId) {
      throw new Error("This action plan is stale. Run the task again.");
    }
    this.memory = restored;
    return restored;
  }

  async clearForSnapshot(snapshotId: string): Promise<void> {
    await this.mutate(async () => {
      if (this.memory?.snapshotId === snapshotId) this.memory = null;
      const stored = await this.storage.get(PENDING_AGENT_RUN_KEY);
      const current = parsePendingAgentRun(stored[PENDING_AGENT_RUN_KEY]);
      if (current?.snapshotId === snapshotId) {
        await this.storage.remove(PENDING_AGENT_RUN_KEY);
      }
    });
  }

  async clearForConversation(conversationId: string): Promise<void> {
    await this.mutate(async () => {
      if (this.memory?.conversationId === conversationId) this.memory = null;
      const stored = await this.storage.get(PENDING_AGENT_RUN_KEY);
      const current = parsePendingAgentRun(stored[PENDING_AGENT_RUN_KEY]);
      if (current?.conversationId === conversationId) {
        await this.storage.remove(PENDING_AGENT_RUN_KEY);
      }
    });
  }

  private async mutate(operation: () => Promise<void>): Promise<void> {
    const next = this.mutationQueue.then(operation, operation);
    this.mutationQueue = next.catch(() => undefined);
    await next;
  }
}

function parsePendingAgentRun(value: unknown): PendingAgentRun | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<PendingAgentRun>;
  if (
    typeof candidate.task !== "string"
    || typeof candidate.conversationId !== "string"
    || typeof candidate.snapshotId !== "string"
    || typeof candidate.tabId !== "number"
    || !Number.isInteger(candidate.tabId)
    || candidate.tabId < 0
    || typeof candidate.windowId !== "number"
    || !Number.isInteger(candidate.windowId)
    || candidate.windowId < 0
    || typeof candidate.pageUrl !== "string"
    || !/^https?:\/\//u.test(candidate.pageUrl)
    || !Array.isArray(candidate.history)
  ) return null;
  return {
    task: candidate.task,
    conversationId: candidate.conversationId,
    snapshotId: candidate.snapshotId,
    tabId: candidate.tabId,
    windowId: candidate.windowId,
    pageUrl: candidate.pageUrl,
    history: candidate.history,
  };
}
