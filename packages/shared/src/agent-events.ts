export type AgentEventType =
  | "observe"
  | "thinking"
  | "plan"
  | "action"
  | "verify"
  | "complete"
  | "error";

export interface AgentEventBase {
  id: string;
  type: AgentEventType;
  timestamp: string;
}

export interface ObserveEvent extends AgentEventBase {
  type: "observe";
  snapshotId: string;
  summary?: string;
}

export interface ThinkingEvent extends AgentEventBase {
  type: "thinking";
  content: string;
}

export interface PlanEvent extends AgentEventBase {
  type: "plan";
  summary: string;
  stepCount: number;
}

export interface ActionEvent extends AgentEventBase {
  type: "action";
  action: string;
  targetRef?: string;
  status: "pending" | "running" | "success" | "failed";
}

export interface VerifyEvent extends AgentEventBase {
  type: "verify";
  success: boolean;
  summary: string;
  changedRefs?: string[];
}

export interface CompleteEvent extends AgentEventBase {
  type: "complete";
  summary: string;
}

export interface ErrorEvent extends AgentEventBase {
  type: "error";
  error: string;
}

export type AgentEvent =
  | ObserveEvent
  | ThinkingEvent
  | PlanEvent
  | ActionEvent
  | VerifyEvent
  | CompleteEvent
  | ErrorEvent;

export function createAgentEventId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
