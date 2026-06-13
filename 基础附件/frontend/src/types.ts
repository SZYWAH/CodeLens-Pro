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

export type ChatMessage = {
  id?: number | null;
  session_id?: string;
  role: "user" | "assistant";
  content: string;
  created_at?: string;
};

export type ChatSessionListItem = {
  id: string;
  title: string;
  context_type: "general" | "report" | string;
  report_id?: string | null;
  report_title?: string | null;
  created_at: string;
  updated_at: string;
};

export type ChatSessionDetail = ChatSessionListItem & {
  messages: ChatMessage[];
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
    report_input_tokens: number;
    report_output_tokens: number;
    chat_tokens: number;
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
