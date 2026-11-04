export interface ServerConfig {
  id: string;
  name: string;
  apiBase: string;
  local: boolean;
  apiKey?: string;
}

export interface ConversationIdentity {
  conversationId: string;
  conversationUrl: string;
}

export interface TerminalInfo {
  id: string;
  shell: string;
  busy: boolean;
  inputAllowed: boolean;
}

export interface TerminalEvent {
  sequence: number;
  data: string;
  encoding: "utf-8" | "base64";
}

export interface TerminalLiveOutput {
  sessionId: string;
  events: TerminalEvent[];
  busy: boolean;
  inputAllowed: boolean;
  closed: boolean;
}

export interface ContinuousState {
  enabled: boolean;
  status: "active" | "idle" | "pending";
}

export interface ControlStatus {
  conversationId: string;
  bound: boolean;
  continuousInteraction: ContinuousState;
  mcpUsage: { enabled: boolean };
  serverNowMs: number;
}

export interface ActivityItem {
  id?: string;
  sequence?: number;
  type: string;
  title?: string;
  description?: string;
  payload?: any;
  status?: "pending" | "running" | "completed" | "failed";
  timestamp?: number;
}

export interface PlanQuestion {
  id: string;
  question: string;
  options?: string[];
  multiSelect?: boolean;
}

// Background to Content & UI Messages
export type ExtensionMessage =
  | { type: "server-status"; serverName: string; state: "connected" | "connecting" | "offline"; message?: string }
  | { type: "activity-page"; conversationId: string; items: ActivityItem[] }
  | { type: "terminals-list"; conversationId: string; terminals: TerminalInfo[] }
  | { type: "plan-show"; conversationId: string; plan: PlanQuestion }
  | { type: "folder-picked"; path: string | null };
