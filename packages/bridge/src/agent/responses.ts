export const responsesDecisionSchema = {
  type: "object",
  properties: {
    kind: { type: "string", enum: ["answer", "action_plan", "complete", "blocked", "needs_user"] },
    content: { type: "string" },
    summary: { type: "string" },
    evidence: { type: "array", items: { type: "string" } },
    reason: { type: "string" },
    recoverable: { type: "boolean" },
    question: { type: "string" },
    snapshotId: { type: "string" },
    requiresConfirmation: { type: "boolean" },
    confidence: { type: "number" },
    steps: { type: "array", items: { type: "object", additionalProperties: true } },
  },
  required: ["kind"],
  additionalProperties: true,
} as const;

export function extractResponsesText(value: unknown): string {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  if (typeof record.output_text === "string") return record.output_text;
  if (!Array.isArray(record.output)) return "";
  return record.output.flatMap((item) => {
    const output = item && typeof item === "object" ? item as Record<string, unknown> : {};
    if (!Array.isArray(output.content)) return [];
    return output.content.flatMap((part) => {
      const content = part && typeof part === "object" ? part as Record<string, unknown> : {};
      return typeof content.text === "string" ? [content.text] : [];
    });
  }).join("\n").trim();
}

export async function readResponsesStream(response: Response): Promise<{ text: string; responseId?: string }> {
  if (!response.headers.get("content-type")?.includes("text/event-stream")) {
    const payload = await response.json() as Record<string, unknown>;
    return { text: extractResponsesText(payload), ...(typeof payload.id === "string" ? { responseId: payload.id } : {}) };
  }
  if (!response.body) throw new Error("OpenAI Responses API returned no stream body.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let responseId: string | undefined;
  const consume = (frame: string) => {
    const data = frame.split(/\r?\n/u).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
    if (!data || data === "[DONE]") return;
    let event: Record<string, unknown>;
    try { event = JSON.parse(data) as Record<string, unknown>; } catch { return; }
    if (event.type === "response.output_text.delta" && typeof event.delta === "string") text += event.delta;
    const completed = event.response && typeof event.response === "object" ? event.response as Record<string, unknown> : undefined;
    if (completed) {
      if (typeof completed.id === "string") responseId = completed.id;
      if (!text) text = extractResponsesText(completed);
    }
  };
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const frames = buffer.split(/\r?\n\r?\n/u);
    buffer = frames.pop() ?? "";
    frames.forEach(consume);
    if (done) break;
  }
  if (buffer.trim()) consume(buffer);
  return { text, ...(responseId ? { responseId } : {}) };
}

export function readResponsesError(value: Record<string, unknown>): string {
  const error = value.error && typeof value.error === "object" ? value.error as Record<string, unknown> : {};
  return typeof error.message === "string" ? error.message : "";
}
