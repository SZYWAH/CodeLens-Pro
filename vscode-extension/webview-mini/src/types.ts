export type HealthResponse = {
  backend: string;
  mysql_ok: boolean;
  mysql_message: string;
  llm_key_configured: boolean;
};

export type ReportMode = {
  id: string;
  label: string;
};

export type SettingsResponse = {
  models: Record<string, string>;
  default_model: string;
  default_model_label: string;
  languages: Record<string, string>;
  default_language_label: string;
  base_url: string;
  llm_key_configured: boolean;
  mysql_ok: boolean;
  mysql_message: string;
  report_modes: Record<string, ReportMode[]>;
};

export type StaticMetrics = {
  lines: number;
  functions: {
    count: number;
    names: string[];
    classes?: string[];
    error?: string;
  };
  secrets_risk: Array<{ type: string; match: string }>;
};

export type ReportListItem = {
  id: string;
  title: string;
  report_type: string;
  mode: string;
  language_label: string;
  language_code: string;
  model: string;
  created_at: string;
};

export type ReportDetail = ReportListItem & {
  code_content?: string | null;
  code_a?: string | null;
  code_b?: string | null;
  content: string;
  metrics?: StaticMetrics | null;
  chat_session_id?: string | null;
};

export type FileAttention = "low" | "normal" | "high";

export type EditorFilePayload = {
  code: string;
  languageId?: string;
  fileName?: string;
  filePath?: string;
  attention?: FileAttention;
};

export type EditorPayload = {
  code: string;
  languageId?: string;
  languageLabel?: string;
  languageCode?: string;
  fileName?: string;
  filePath?: string;
  sourceType?: "current" | "selection" | "pickedFiles" | "recentFiles" | "workspaceFiles" | "workspaceRules" | "autoWorkspace";
  files?: EditorFilePayload[];
};

export type VsCodeInboundMessage =
  | { type: "codelens.setApiBase"; apiBase: string }
  | { type: "codelens.openPage"; page: "workbench" | "diff" | "chat" | "history" | "settings" }
  | ({ type: "codelens.openWorkbench" } & EditorPayload)
  | { type: "codelens.recentFilesMenu"; files: EditorPayload[] }
  | { type: "codelens.agentPlanApplied"; planId?: string | null; sessionId?: string | null; status: "applied" | "failed" | "rejected"; message: string }
  | { type: "codelens.theme"; theme: "dark" | "light" };

export type AgentOperationType = "create" | "update" | "delete" | "rename";

export type AgentOperation = {
  type: AgentOperationType;
  path: string;
  new_path?: string | null;
  content?: string | null;
  reason?: string | null;
};

export type AgentPlan = {
  id?: string;
  session_id?: string | null;
  plan_id?: string | null;
  title?: string | null;
  summary: string;
  assumptions: string[];
  warnings: string[];
  operations: AgentOperation[];
  status?: "pending" | "applied" | "failed" | "rejected" | string;
  source?: "web" | "plugin" | string;
  instruction?: string;
  apply_result?: string | null;
  created_at?: string;
  updated_at?: string;
};

export type AgentPlanRequest = {
  instruction: string;
  session_id?: string | null;
  task_id?: string | null;
  agent_action?: "chat" | "plan";
  defer_to_plugin?: boolean;
  code_context: string;
  language_code: string;
  language_label: string;
  file_name?: string;
  file_path?: string;
  report_context?: string | null;
  files?: EditorFilePayload[];
  model?: string | null;
  source?: "web" | "plugin";
  workspace_root?: string | null;
};

export type AgentApplyResultRequest = {
  status: "applied" | "failed" | "rejected";
  message: string;
};

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

export type ChatSessionListItem = {
  id: string;
  title: string;
  context_type: string;
  report_id?: string | null;
  report_title?: string | null;
  created_at: string;
  updated_at: string;
};

export type ChatSessionDetail = ChatSessionListItem & {
  messages: Array<ChatMessage & {
    id?: number | null;
    session_id: string;
    created_at: string;
  }>;
  agent_plans?: AgentPlan[];
};

export type AnalyticsDatum = {
  label?: string;
  date?: string;
  value?: number;
  reports?: number;
  chats?: number;
  total?: number;
};

export type AnalyticsResponse = {
  totals: Record<string, number>;
  tool_usage: AnalyticsDatum[];
  report_type_counts: AnalyticsDatum[];
  report_mode_counts: AnalyticsDatum[];
  chat_type_counts: AnalyticsDatum[];
  daily_activity: AnalyticsDatum[];
  token_usage: {
    estimated: boolean;
    method?: string;
    tokenizer_available?: boolean;
    tokenizer_source?: string;
    total_tokens: number;
    items: AnalyticsDatum[];
  };
  api_balance: {
    available: boolean;
    key_configured: boolean;
    status: string;
    detail: string;
    currency?: string;
    total_balance?: number;
    raw?: unknown;
  };
};
