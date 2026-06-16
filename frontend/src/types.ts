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

export type LLMKeyStatusResponse = {
  configured: boolean;
  source: "user" | "env" | "none" | string;
  masked_key: string;
  updated_at?: string | null;
  base_url: string;
};

export type LLMKeyTestResponse = {
  ok: boolean;
  status: string;
  detail: string;
  key_status?: LLMKeyStatusResponse | null;
  balance?: {
    currency?: string;
    total_balance?: number;
  } | null;
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

export type ReportOutlineItem = {
  id: string;
  text: string;
  level: 1 | 2 | 3 | number;
};

export type ChatMessage = {
  id?: number | null;
  session_id?: string;
  role: "user" | "assistant";
  content: string;
  created_at?: string;
};

export type AgentOperation = {
  type: "create" | "update" | "delete" | "rename";
  path: string;
  new_path?: string | null;
  content?: string | null;
  reason?: string | null;
};

export type AgentContextMode = "manual" | "ai_auto" | "hybrid";
export type AgentIntent = "auto" | "chat" | "plan";

export type AgentPlan = {
  id?: string;
  session_id?: string | null;
  plan_id?: string | null;
  title?: string | null;
  instruction?: string;
  summary: string;
  assumptions: string[];
  warnings: string[];
  operations: AgentOperation[];
  selected_file_paths?: string[];
  context_mode?: AgentContextMode;
  status?: "pending" | "planned" | "waiting_confirm" | "confirmed" | "applied" | "failed" | "rejected" | string;
  source?: "web" | "plugin" | string;
  apply_result?: string | null;
  created_at?: string;
  updated_at?: string;
};

export type AgentConfirmRequest = {
  action: "apply" | "reject";
  message?: string;
};

export type AgentPlanRequest = {
  instruction: string;
  session_id?: string | null;
  task_id?: string | null;
  agent_action?: "chat" | "plan";
  defer_to_plugin?: boolean;
  code_context?: string;
  language_code?: string;
  language_label?: string;
  file_name?: string;
  file_path?: string;
  report_context?: string | null;
  files?: Array<{ code: string; languageId?: string; fileName?: string; filePath?: string }>;
  selected_file_paths?: string[];
  context_mode?: AgentContextMode;
  model?: string | null;
  source?: "web" | "plugin";
  workspace_root?: string | null;
};

export type AgentChatStreamRequest = {
  message: string;
  session_id?: string | null;
  code_context?: string;
  report_context?: string | null;
  files?: Array<{ code: string; languageId?: string; fileName?: string; filePath?: string }>;
  selected_file_paths?: string[];
  context_mode?: AgentContextMode;
  model?: string | null;
  source?: "web" | "plugin";
  workspace_root?: string | null;
};

export type AgentMessageStreamRequest = AgentChatStreamRequest & {
  intent?: AgentIntent;
};

export type ChatSessionListItem = {
  id: string;
  title: string;
  context_type: "general" | "report" | "agent" | string;
  report_id?: string | null;
  report_title?: string | null;
  created_at: string;
  updated_at: string;
};

export type ChatSessionDetail = ChatSessionListItem & {
  messages: ChatMessage[];
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
    refreshed_at?: string;
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

export type AnalyticsSummary = {
  reports: number;
  single_reports: number;
  diff_reports: number;
  chat_sessions: number;
  agent_tasks: number;
  code_lines: number;
  security_risks: number;
  total_tokens: number;
};

export type ActivityItem = {
  id: string;
  kind: "report" | "chat" | "agent" | string;
  title: string;
  subtitle: string;
  status: string;
  target_id: string;
  created_at: string;
  route?: {
    page?: "report" | "chat" | "agent" | string;
    target_id?: string;
    session_id?: string;
    plan_id?: string;
    report_type?: string;
    context_type?: string;
  };
};

export type ActivityStarItem = ActivityItem & {
  weight?: number;
  kind_label?: string;
};

export type WorkspaceTreeNode = {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: WorkspaceTreeNode[];
  truncated?: boolean;
};

export type ProjectStructureNode = {
  name: string;
  path: string;
  type: "file" | "directory";
  description?: string;
  children?: ProjectStructureNode[];
  truncated?: boolean;
};

export type WorkspaceSnapshot = {
  workspace_name: string;
  workspace_root: string;
  status: "connected" | "no_workspace" | "disconnected" | string;
  tree?: WorkspaceTreeNode | null;
  node_count: number;
  truncated: boolean;
  plugin_version?: string | null;
  connected: boolean;
  stale: boolean;
  updated_at?: string | null;
};

export type BootstrapResponse = {
  health: HealthResponse;
  settings: SettingsResponse;
  analytics_summary: AnalyticsSummary;
  recent_reports: ReportListItem[];
  recent_chats: ChatSessionListItem[];
  recent_agent_tasks: AgentPlan[];
};

export type DailyWorkLogCalendarItem = {
  date: string;
  weekday: string;
  has_activity: boolean;
  has_log: boolean;
  activity_score: number;
  title?: string | null;
  summary?: string | null;
  generated_at?: string | null;
  stats: Record<string, number>;
};

export type DailyWorkLogItem = {
  id?: string | null;
  date: string;
  title: string;
  content_markdown: string;
  source_stats: Record<string, number>;
  source_refs: Array<{ type: string; id: string; title: string }>;
  model?: string | null;
  generated_at?: string | null;
  updated_at?: string | null;
  has_activity: boolean;
  has_log: boolean;
};

export type LearningCardStatus = "new" | "reviewing" | "mastered" | "bookmarked" | string;

export type LearningResourceLink = {
  title: string;
  url: string;
  description?: string;
};

export type LearningCardItem = {
  id: string;
  title: string;
  explanation: string;
  language_label: string;
  difficulty: string;
  tags: string[];
  source_type: string;
  source_id?: string | null;
  code_excerpt?: string | null;
  detail_markdown?: string | null;
  notes?: string | null;
  resource_links: LearningResourceLink[];
  status: LearningCardStatus;
  last_reviewed_at?: string | null;
  created_at: string;
  updated_at: string;
};

export type LearningCardCreateRequest = {
  title: string;
  explanation: string;
  language_label?: string;
  difficulty?: string;
  tags?: string[];
  source_type?: string;
  source_id?: string | null;
  code_excerpt?: string | null;
  detail_markdown?: string | null;
  notes?: string | null;
  resource_links?: LearningResourceLink[];
  status?: LearningCardStatus;
};

export type LearningCardCandidate = {
  title: string;
  explanation: string;
  language_label: string;
  difficulty: string;
  tags: string[];
  source_type: string;
  source_id?: string | null;
  code_excerpt?: string | null;
  detail_markdown?: string | null;
  resource_links: LearningResourceLink[];
  source_reason?: string | null;
  confidence?: number | null;
};

export type LearningCardMaterialItem = {
  card_id: string;
  content_markdown: string;
  source_links: LearningResourceLink[];
  model?: string | null;
  generated_at?: string | null;
  updated_at?: string | null;
  cached: boolean;
};

export type LearningCardGenerateResponse = {
  created: number;
  skipped: number;
  cards: LearningCardItem[];
  candidates: LearningCardCandidate[];
};

export type LearningCardBulkCreateResponse = {
  created: number;
  skipped: number;
  cards: LearningCardItem[];
};

export type LearningCardTagSuggestion = {
  id: string;
  action: "merge" | "add" | "remove" | "rename" | string;
  title: string;
  reason: string;
  card_ids: string[];
  from_tags: string[];
  to_tags: string[];
};

export type LearningCardTagSuggestionResponse = {
  suggestions: LearningCardTagSuggestion[];
};

export type LearningCardApplyTagSuggestionsResponse = {
  updated: number;
  cards: LearningCardItem[];
};

export type LearningCenterResponse = {
  stats: Record<string, number>;
  route_steps: Array<{ title: string; description: string; status: string; source: string }>;
  weak_points: Array<{ title: string; count: number; hint: string }>;
  recent_learning: ActivityItem[];
  next_actions: Array<{ title: string; description: string; page: string }>;
};

export type ProjectGuideResponse = {
  workspace: {
    name: string;
    root: string;
    status: string;
    node_count: number;
    file_count: number;
    directory_count: number;
    connected: boolean;
  };
  entry_candidates: Array<{ path: string; name: string; reason: string }>;
  core_areas: Array<{ name: string; file_count: number; description: string }>;
  read_order: Array<{ step: number; title: string; paths: string[] }>;
  project_structure?: ProjectStructureNode | null;
  knowledge_points: string[];
  notes: string[];
};

export type LearningReviewResponse = {
  period: "week" | "month" | "all" | string;
  summary: string;
  stats: Record<string, number>;
  focus_areas: Array<{ title: string; count: number; summary: string }>;
  recurring_topics: AnalyticsDatum[];
  timeline: ActivityItem[];
  recommendations: Array<{ title: string; description: string }>;
};
