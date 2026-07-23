export type AgentEventType =
  | "action"
  | "verify"
  | "complete"
  | "error";

export interface AgentEventBase {
  id: string;
  type: AgentEventType;
  timestamp: string;
}

export interface ActionEvent extends AgentEventBase {
  type: "action";
  action: string;
  targetRef?: string;
  status: "pending" | "running" | "success" | "failed";
  step?: number;
  detail?: string;
}

export interface VerifyEvent extends AgentEventBase {
  type: "verify";
  success: boolean;
  summary: string;
  changedRefs?: string[];
  changes?: string[];
  step?: number;
}

export interface CompleteEvent extends AgentEventBase {
  type: "complete";
  summary: string;
}

export interface ErrorEvent extends AgentEventBase {
  type: "error";
  error: string;
  recoverable?: boolean;
}

export type AgentEvent =
  | ActionEvent
  | VerifyEvent
  | CompleteEvent
  | ErrorEvent;

export function createAgentEventId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
