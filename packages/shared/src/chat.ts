export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  attachments?: ChatMessageAttachment[];
}

export type ChatMessageAttachment =
  | {
      kind: "element";
      tagName: string;
      label: string;
      pageUrl: string;
      captured: boolean;
    }
  | {
      kind: "screenshot";
      title: string;
      pageUrl: string;
    };
