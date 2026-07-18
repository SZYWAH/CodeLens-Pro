export type AppHealth = {
  version: string;
  app_home: string;
  storage_dir: string;
  logs_dir: string;
  database_path: string;
  database_ok: boolean;
  database_message: string;
  llm_enabled: boolean;
  llm_configured: boolean;
};

export type Settings = {
  enable_llm: boolean;
  api_base: string;
  model: string;
  api_key_set: boolean;
  llm_state: LlmState;
};

export type LlmState = "disabled" | "missing_key" | "configured";

export type SettingsUpdate = {
  enable_llm: boolean;
  api_base: string;
  model: string;
  api_key?: string;
  clear_api_key: boolean;
};

export type ModelProfile = {
  id: string;
  name: string;
  api_base: string;
  model: string;
  note: string;
  is_default: boolean;
  created_at: string;
  updated_at: string;
};

export type ModelProfileInput = {
  id?: string | null;
  name: string;
  api_base: string;
  model: string;
  note: string;
  is_default: boolean;
};

export type ReportMetrics = {
  total_lines: number;
  non_empty_lines: number;
  comment_lines: number;
  complexity_score: number;
  risk_count: number;
  suggestion_count: number;
};

export type ReportFile = {
  id: string;
  report_id: string;
  path: string;
  language: string;
  code_excerpt: string;
  metrics: ReportMetrics;
  risks: string[];
};

export type ReportDetail = {
  id: string;
  title: string;
  language: string;
  code_excerpt: string;
  summary: string;
  full_report: string;
  analysis_source: string;
  report_type: string;
  risk_level: string;
  file_count: number;
  metadata_json: string;
  risks: string[];
  suggestions: string[];
  metrics: ReportMetrics;
  files: ReportFile[];
  created_at: string;
};

export type ReportSummary = {
  id: string;
  title: string;
  language: string;
  review_focus?: string;
  summary: string;
  analysis_source: string;
  report_type: string;
  risk_level: string;
  file_count: number;
  created_at: string;
  risk_count: number;
};

export type ProjectFileInput = {
  path: string;
  content: string;
  language?: string;
};

export type ProjectImportResult = {
  project_name: string;
  root_path?: string | null;
  files: ProjectFileInput[];
  skipped: string[];
};

export type ProjectAnalyzeRequest = {
  project_name: string;
  workspace_id?: string | null;
  title?: string;
  files: ProjectFileInput[];
  use_llm?: boolean;
  retry_report_id?: string | null;
};

export type AnalysisRequest = {
  title?: string;
  source_label?: string;
  code: string;
  language?: string;
  mode_group?: string;
  mode?: string;
  mode_label?: string;
  use_llm?: boolean;
  retry_report_id?: string | null;
};

export type DiffAnalyzeRequest = {
  title?: string;
  language?: string;
  before_label: string;
  before_code: string;
  after_label: string;
  after_code: string;
  use_llm?: boolean;
  retry_report_id?: string | null;
};

export type AnalysisResponse = {
  report: ReportDetail;
  warnings: string[];
};

export type ChatMessageItem = {
  id: string;
  session_id: string;
  role: string;
  content: string;
  created_at: string;
};

export type ChatSessionSummary = {
  id: string;
  title: string;
  context_report_id?: string | null;
  created_at: string;
  updated_at: string;
  message_count: number;
};

export type ChatSessionDetail = {
  id: string;
  title: string;
  context_report_id?: string | null;
  messages: ChatMessageItem[];
  created_at: string;
  updated_at: string;
};

export type ChatStreamRequest = {
  session_id?: string | null;
  message: string;
  context_report_id?: string | null;
  context_kind?: string | null;
  context_id?: string | null;
};

export type LlmTestRequest = {
  api_base: string;
  model: string;
  api_key?: string;
};

export type LlmTestResult = {
  ok: boolean;
  message: string;
  api_base: string;
  model: string;
  latency_ms: number;
  error_code?: string | null;
};

export type AiTaskKind =
  | "single_review"
  | "project_review"
  | "workspace_review"
  | "diff_review"
  | "chat"
  | "card_material";

export type AiTaskPhase = "accepted" | "connecting" | "streaming" | "fallback" | "saving";

export type AiTaskErrorCode =
  | "configuration"
  | "unauthorized"
  | "rate_limited"
  | "timeout"
  | "network"
  | "protocol"
  | "cancelled"
  | "internal";

export type AiTaskError = {
  code: AiTaskErrorCode;
  message: string;
  retryable: boolean;
};

export type AiStreamEvent<T> = {
  request_id: string;
  task: AiTaskKind;
  event: "phase" | "chunk" | "done" | "error";
  phase?: AiTaskPhase;
  sequence: number;
  chunk?: string;
  result?: T;
  error?: AiTaskError;
};

export type AiTaskRunOptions = {
  onChunk?: (chunk: string) => void;
  onPhase?: (phase: AiTaskPhase) => void;
  onRequestId?: (requestId: string) => void;
  signal?: AbortSignal;
};

export type WorkspaceSummary = {
  id: string;
  name: string;
  root_path: string;
  file_count: number;
  total_lines: number;
  language_summary: string;
  created_at: string;
  updated_at: string;
};

export type WorkspaceFile = {
  id: string;
  workspace_id: string;
  path: string;
  language: string;
  content_hash: string;
  content: string;
  metrics: ReportMetrics;
  updated_at: string;
};

export type WorkspaceDetail = {
  summary: WorkspaceSummary;
  files: WorkspaceFile[];
  skipped: string[];
};

export type LanguageStat = {
  language: string;
  file_count: number;
  total_lines: number;
};

export type WorkspaceFileHotspot = {
  path: string;
  language: string;
  total_lines: number;
  complexity_score: number;
  risk_count: number;
};

export type CodeSymbol = {
  id: string;
  workspace_id: string;
  file_path: string;
  name: string;
  kind: string;
  line: number;
  signature: string;
};

export type FileDependency = {
  id: string;
  workspace_id: string;
  source_path: string;
  target: string;
  kind: string;
  line: number;
};

export type CodeMap = {
  workspace_id: string;
  languages: LanguageStat[];
  hotspot_files: WorkspaceFileHotspot[];
  symbols: CodeSymbol[];
  dependencies: FileDependency[];
};

export type Finding = {
  id: string;
  workspace_id: string;
  report_id?: string | null;
  file_path: string;
  severity: string;
  category: string;
  title: string;
  detail: string;
  line_start?: number | null;
  line_end?: number | null;
  suggestion: string;
  status: string;
  created_at: string;
  updated_at: string;
};

export type LearningCard = {
  id: string;
  finding_id?: string | null;
  workspace_id?: string | null;
  title: string;
  content: string;
  tags: string[];
  status: string;
  created_at: string;
  updated_at: string;
};

export type LearningCardCreate = {
  finding_id?: string | null;
  workspace_id?: string | null;
  title: string;
  content: string;
  tags: string[];
};

export type CardMaterial = {
  id: string;
  card_id: string;
  title: string;
  content: string;
  source: string;
  created_at: string;
};

export type DailySummary = {
  date: string;
  report_count: number;
  chat_message_count: number;
  finding_count: number;
  card_count: number;
  agent_task_count: number;
  activity_count: number;
  highlights: string[];
};

export type DailyLog = {
  id: string;
  date: string;
  title: string;
  content: string;
  created_at: string;
  updated_at: string;
};

export type ProjectGuideItem = {
  title: string;
  detail: string;
  path?: string | null;
};

export type ProjectGuide = {
  workspace_id: string;
  title: string;
  summary: string;
  architecture: ProjectGuideItem[];
  reading_order: ProjectGuideItem[];
  key_files: ProjectGuideItem[];
  generated_at: string;
};

export type AgentPlanRequest = {
  context_kind: string;
  context_id: string;
  goal?: string | null;
  selected_file_paths: string[];
};

export type AgentStep = {
  id: string;
  task_id: string;
  position: number;
  title: string;
  detail: string;
  risk: string;
  suggested_patch: string;
  status: string;
};

export type AgentTask = {
  id: string;
  context_kind: string;
  context_id: string;
  title: string;
  summary: string;
  status: string;
  selected_file_paths: string[];
  apply_summary: string;
  created_at: string;
  updated_at: string;
  steps: AgentStep[];
  operations: AgentFileOperation[];
};

export type AgentFileOperation = {
  id: string;
  task_id: string;
  path: string;
  operation: string;
  title: string;
  preview: string;
  replacement: string;
  status: string;
  confirmed: boolean;
  backup_path?: string | null;
  applied_at?: string | null;
  error?: string | null;
};

export type AgentApplyRequest = {
  task_id: string;
  operation_ids: string[];
  confirm: boolean;
};

export type AgentApplyResult = {
  task: AgentTask;
  applied_count: number;
  backup_dir: string;
  messages: string[];
};

export type WorkspaceBridgeFile = {
  path: string;
  language: string;
  total_lines: number;
  complexity_score: number;
  risk_count: number;
  selected: boolean;
};

export type WorkspaceBridgeStatus = {
  connected: boolean;
  status: string;
  workspace_id?: string | null;
  workspace_name: string;
  workspace_root: string;
  candidate_files: WorkspaceBridgeFile[];
  selected_file_paths: string[];
  heartbeat_at: string;
  updated_at: string;
  plugin_version: string;
  message: string;
};

export type WorkspaceBridgeManifestResult = {
  export_dir: string;
  manifest_path: string;
  readme_path: string;
  current_dir: string;
  current_manifest_path: string;
  current_readme_path: string;
  generated_at: string;
  workspace_id?: string | null;
  workspace_name: string;
  selected_file_count: number;
  candidate_file_count: number;
};

export type WorkspaceBridgeInboxRequest = {
  id: string;
  source: string;
  workspace_id?: string | null;
  context_kind: string;
  context_id: string;
  goal: string;
  selected_file_paths: string[];
  created_at: string;
  file_path: string;
  status: string;
  error?: string | null;
};

export type WorkspaceBridgeInboxApplyResult = {
  request: WorkspaceBridgeInboxRequest;
  task: AgentTask;
};

export type LearningCardCandidate = {
  id: string;
  source_kind: string;
  source_id: string;
  workspace_id?: string | null;
  report_id?: string | null;
  finding_id?: string | null;
  title: string;
  content: string;
  tags: string[];
  difficulty: string;
  status: string;
  dedupe_key: string;
  created_at: string;
};

export type LearningCalendarItem = {
  date: string;
  has_log: boolean;
  activity_count: number;
  report_count: number;
  card_count: number;
  agent_task_count: number;
};

export type LearningCenterData = {
  today: DailySummary;
  calendar: LearningCalendarItem[];
  review_cards: LearningCard[];
  recent_agent_tasks: AgentTask[];
};

export type ActivityEvent = {
  id: string;
  event_type: string;
  title: string;
  detail: string;
  entity_kind?: string | null;
  entity_id?: string | null;
  created_at: string;
};

export type ActivityDay = {
  date: string;
  count: number;
};

export type ActivitySummary = {
  report_count: number;
  chat_count: number;
  card_count: number;
  workspace_count: number;
  finding_count: number;
  agent_task_count: number;
  recent_events: ActivityEvent[];
  daily_counts: ActivityDay[];
};

export type ActivityNode = {
  id: string;
  label: string;
  group: string;
  weight: number;
};

export type ActivityLink = {
  source: string;
  target: string;
  weight: number;
};

export type ActivityGalaxyData = {
  nodes: ActivityNode[];
  links: ActivityLink[];
};

export type ActivityStarRoute = {
  page?: string | null;
  target_id?: string | null;
  session_id?: string | null;
  plan_id?: string | null;
  context_type?: string | null;
};

export type ActivityStarItem = {
  id: string;
  kind: string;
  kind_label: string;
  title: string;
  subtitle: string;
  status: string;
  target_id: string;
  created_at: string;
  route?: ActivityStarRoute | null;
  weight: number;
};

export type ActivityConstellationData = {
  items: ActivityStarItem[];
  code_line_count: number;
};

export type TraceabilityCounts = {
  workspaces: number;
  reports: number;
  findings: number;
  cards: number;
  chats: number;
  daily_logs: number;
  agent_tasks: number;
  activity_events: number;
};

export type TraceabilityNode = {
  id: string;
  kind: string;
  title: string;
  subtitle: string;
  status: string;
  weight: number;
};

export type TraceabilityLink = {
  source: string;
  target: string;
  label: string;
  weight: number;
};

export type TraceabilitySnapshot = {
  scope_kind: string;
  scope_id?: string | null;
  title: string;
  counts: TraceabilityCounts;
  nodes: TraceabilityNode[];
  links: TraceabilityLink[];
  gaps: string[];
  next_actions: string[];
  generated_at: string;
};

export type ProductArchiveResult = {
  export_dir: string;
  index_path: string;
  manifest_path: string;
  generated_at: string;
  counts: TraceabilityCounts;
};

export type ProductArchiveImportResult = {
  source_path: string;
  backup_path: string;
  imported_at: string;
  counts: TraceabilityCounts;
  warnings: string[];
};
