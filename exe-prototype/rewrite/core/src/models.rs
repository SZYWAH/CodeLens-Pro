use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppHealth {
    pub version: String,
    pub app_home: String,
    pub storage_dir: String,
    pub logs_dir: String,
    pub database_path: String,
    pub database_ok: bool,
    pub database_message: String,
    pub llm_enabled: bool,
    pub llm_configured: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Settings {
    pub enable_llm: bool,
    pub api_base: String,
    pub model: String,
    pub api_key_set: bool,
    pub llm_state: String,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            enable_llm: false,
            api_base: "https://api.deepseek.com/v1".to_string(),
            model: "deepseek-chat".to_string(),
            api_key_set: false,
            llm_state: "disabled".to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SettingsUpdate {
    pub enable_llm: bool,
    pub api_base: String,
    pub model: String,
    pub api_key: Option<String>,
    pub clear_api_key: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelProfile {
    pub id: String,
    pub name: String,
    pub api_base: String,
    pub model: String,
    pub note: String,
    pub is_default: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelProfileInput {
    pub id: Option<String>,
    pub name: String,
    pub api_base: String,
    pub model: String,
    pub note: String,
    pub is_default: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnalysisRequest {
    pub code: String,
    pub language: Option<String>,
    pub title: Option<String>,
    pub source_label: Option<String>,
    pub mode_group: Option<String>,
    pub mode: Option<String>,
    pub mode_label: Option<String>,
    pub use_llm: Option<bool>,
    #[serde(default)]
    pub retry_report_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnalysisResponse {
    pub report: ReportDetail,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReportMetrics {
    pub total_lines: usize,
    pub non_empty_lines: usize,
    pub comment_lines: usize,
    pub complexity_score: usize,
    pub risk_count: usize,
    pub suggestion_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReportFile {
    pub id: String,
    pub report_id: String,
    pub path: String,
    pub language: String,
    pub code_excerpt: String,
    pub metrics: ReportMetrics,
    pub risks: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReportDetail {
    pub id: String,
    pub title: String,
    pub language: String,
    pub code_excerpt: String,
    pub summary: String,
    pub full_report: String,
    pub analysis_source: String,
    pub report_type: String,
    pub risk_level: String,
    pub file_count: usize,
    pub metadata_json: String,
    pub risks: Vec<String>,
    pub suggestions: Vec<String>,
    pub metrics: ReportMetrics,
    pub files: Vec<ReportFile>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReportSummary {
    pub id: String,
    pub title: String,
    pub language: String,
    pub review_focus: Option<String>,
    pub summary: String,
    pub analysis_source: String,
    pub report_type: String,
    pub risk_level: String,
    pub file_count: usize,
    pub created_at: String,
    pub risk_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectFileInput {
    pub path: String,
    pub content: String,
    pub language: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectAnalyzeRequest {
    pub project_name: String,
    #[serde(default)]
    pub workspace_id: Option<String>,
    pub title: Option<String>,
    pub files: Vec<ProjectFileInput>,
    pub use_llm: Option<bool>,
    #[serde(default)]
    pub retry_report_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectImportResult {
    pub project_name: String,
    pub root_path: Option<String>,
    pub files: Vec<ProjectFileInput>,
    pub skipped: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiffAnalyzeRequest {
    pub title: Option<String>,
    pub language: Option<String>,
    pub before_label: String,
    pub before_code: String,
    pub after_label: String,
    pub after_code: String,
    pub use_llm: Option<bool>,
    #[serde(default)]
    pub retry_report_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessageItem {
    pub id: String,
    pub session_id: String,
    pub role: String,
    pub content: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatSessionSummary {
    pub id: String,
    pub title: String,
    pub context_report_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub message_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatSessionDetail {
    pub id: String,
    pub title: String,
    pub context_report_id: Option<String>,
    pub messages: Vec<ChatMessageItem>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatStreamRequest {
    pub session_id: Option<String>,
    pub message: String,
    pub context_report_id: Option<String>,
    pub context_kind: Option<String>,
    pub context_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LlmTestResult {
    pub ok: bool,
    pub message: String,
    pub api_base: String,
    pub model: String,
    pub latency_ms: u64,
    pub error_code: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LlmTestRequest {
    pub api_base: String,
    pub model: String,
    pub api_key: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkspaceSummary {
    pub id: String,
    pub name: String,
    pub root_path: String,
    pub file_count: usize,
    pub total_lines: usize,
    pub language_summary: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkspaceFile {
    pub id: String,
    pub workspace_id: String,
    pub path: String,
    pub language: String,
    pub content_hash: String,
    pub content: String,
    pub metrics: ReportMetrics,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkspaceDetail {
    pub summary: WorkspaceSummary,
    pub files: Vec<WorkspaceFile>,
    pub skipped: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LanguageStat {
    pub language: String,
    pub file_count: usize,
    pub total_lines: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkspaceFileHotspot {
    pub path: String,
    pub language: String,
    pub total_lines: usize,
    pub complexity_score: usize,
    pub risk_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CodeSymbol {
    pub id: String,
    pub workspace_id: String,
    pub file_path: String,
    pub name: String,
    pub kind: String,
    pub line: usize,
    pub signature: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileDependency {
    pub id: String,
    pub workspace_id: String,
    pub source_path: String,
    pub target: String,
    pub kind: String,
    pub line: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CodeMap {
    pub workspace_id: String,
    pub languages: Vec<LanguageStat>,
    pub hotspot_files: Vec<WorkspaceFileHotspot>,
    pub symbols: Vec<CodeSymbol>,
    pub dependencies: Vec<FileDependency>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Finding {
    pub id: String,
    pub workspace_id: String,
    pub report_id: Option<String>,
    pub file_path: String,
    pub severity: String,
    pub category: String,
    pub title: String,
    pub detail: String,
    pub line_start: Option<usize>,
    pub line_end: Option<usize>,
    pub suggestion: String,
    pub status: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LearningCard {
    pub id: String,
    pub finding_id: Option<String>,
    pub workspace_id: Option<String>,
    pub title: String,
    pub content: String,
    pub tags: Vec<String>,
    pub status: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LearningCardCreate {
    pub finding_id: Option<String>,
    pub workspace_id: Option<String>,
    pub title: String,
    pub content: String,
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CardMaterial {
    pub id: String,
    pub card_id: String,
    pub title: String,
    pub content: String,
    pub source: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DailySummary {
    pub date: String,
    pub report_count: usize,
    pub chat_message_count: usize,
    pub finding_count: usize,
    pub card_count: usize,
    pub agent_task_count: usize,
    pub activity_count: usize,
    pub highlights: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DailyLog {
    pub id: String,
    pub date: String,
    pub title: String,
    pub content: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectGuideItem {
    pub title: String,
    pub detail: String,
    pub path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectGuide {
    pub workspace_id: String,
    pub title: String,
    pub summary: String,
    pub architecture: Vec<ProjectGuideItem>,
    pub reading_order: Vec<ProjectGuideItem>,
    pub key_files: Vec<ProjectGuideItem>,
    pub generated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentPlanRequest {
    pub context_kind: String,
    pub context_id: String,
    pub goal: Option<String>,
    pub selected_file_paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentStep {
    pub id: String,
    pub task_id: String,
    pub position: usize,
    pub title: String,
    pub detail: String,
    pub risk: String,
    pub suggested_patch: String,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentTask {
    pub id: String,
    pub context_kind: String,
    pub context_id: String,
    pub title: String,
    pub summary: String,
    pub status: String,
    pub selected_file_paths: Vec<String>,
    pub apply_summary: String,
    pub created_at: String,
    pub updated_at: String,
    pub steps: Vec<AgentStep>,
    pub operations: Vec<AgentFileOperation>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentFileOperation {
    pub id: String,
    pub task_id: String,
    pub path: String,
    pub operation: String,
    pub title: String,
    pub preview: String,
    pub replacement: String,
    pub status: String,
    pub confirmed: bool,
    pub backup_path: Option<String>,
    pub applied_at: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentApplyRequest {
    pub task_id: String,
    pub operation_ids: Vec<String>,
    pub confirm: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentApplyResult {
    pub task: AgentTask,
    pub applied_count: usize,
    pub backup_dir: String,
    pub messages: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkspaceBridgeFile {
    pub path: String,
    pub language: String,
    pub total_lines: usize,
    pub complexity_score: usize,
    pub risk_count: usize,
    pub selected: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkspaceBridgeStatus {
    pub connected: bool,
    pub status: String,
    pub workspace_id: Option<String>,
    pub workspace_name: String,
    pub workspace_root: String,
    pub candidate_files: Vec<WorkspaceBridgeFile>,
    pub selected_file_paths: Vec<String>,
    pub heartbeat_at: String,
    pub updated_at: String,
    pub plugin_version: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkspaceBridgeManifestResult {
    pub export_dir: String,
    pub manifest_path: String,
    pub readme_path: String,
    pub current_dir: String,
    pub current_manifest_path: String,
    pub current_readme_path: String,
    pub generated_at: String,
    pub workspace_id: Option<String>,
    pub workspace_name: String,
    pub selected_file_count: usize,
    pub candidate_file_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkspaceBridgeInboxRequest {
    pub id: String,
    pub source: String,
    pub workspace_id: Option<String>,
    pub context_kind: String,
    pub context_id: String,
    pub goal: String,
    pub selected_file_paths: Vec<String>,
    pub created_at: String,
    pub file_path: String,
    pub status: String,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkspaceBridgeInboxApplyResult {
    pub request: WorkspaceBridgeInboxRequest,
    pub task: AgentTask,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LearningCardCandidate {
    pub id: String,
    pub source_kind: String,
    pub source_id: String,
    pub workspace_id: Option<String>,
    pub report_id: Option<String>,
    pub finding_id: Option<String>,
    pub title: String,
    pub content: String,
    pub tags: Vec<String>,
    pub difficulty: String,
    pub status: String,
    pub dedupe_key: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LearningCalendarItem {
    pub date: String,
    pub has_log: bool,
    pub activity_count: usize,
    pub report_count: usize,
    pub card_count: usize,
    pub agent_task_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LearningCenterData {
    pub today: DailySummary,
    pub calendar: Vec<LearningCalendarItem>,
    pub review_cards: Vec<LearningCard>,
    pub recent_agent_tasks: Vec<AgentTask>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActivityEvent {
    pub id: String,
    pub event_type: String,
    pub title: String,
    pub detail: String,
    pub entity_kind: Option<String>,
    pub entity_id: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActivityDay {
    pub date: String,
    pub count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActivitySummary {
    pub report_count: usize,
    pub chat_count: usize,
    pub card_count: usize,
    pub workspace_count: usize,
    pub finding_count: usize,
    pub agent_task_count: usize,
    pub recent_events: Vec<ActivityEvent>,
    pub daily_counts: Vec<ActivityDay>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActivityNode {
    pub id: String,
    pub label: String,
    pub group: String,
    pub weight: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActivityLink {
    pub source: String,
    pub target: String,
    pub weight: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActivityGalaxyData {
    pub nodes: Vec<ActivityNode>,
    pub links: Vec<ActivityLink>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActivityStarRoute {
    pub page: Option<String>,
    pub target_id: Option<String>,
    pub session_id: Option<String>,
    pub plan_id: Option<String>,
    pub context_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActivityStarItem {
    pub id: String,
    pub kind: String,
    pub kind_label: String,
    pub title: String,
    pub subtitle: String,
    pub status: String,
    pub target_id: String,
    pub created_at: String,
    pub route: Option<ActivityStarRoute>,
    pub weight: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActivityConstellationData {
    pub items: Vec<ActivityStarItem>,
    pub code_line_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TraceabilityCounts {
    pub workspaces: usize,
    pub reports: usize,
    pub findings: usize,
    pub cards: usize,
    pub chats: usize,
    pub daily_logs: usize,
    pub agent_tasks: usize,
    pub activity_events: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TraceabilityNode {
    pub id: String,
    pub kind: String,
    pub title: String,
    pub subtitle: String,
    pub status: String,
    pub weight: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TraceabilityLink {
    pub source: String,
    pub target: String,
    pub label: String,
    pub weight: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TraceabilitySnapshot {
    pub scope_kind: String,
    pub scope_id: Option<String>,
    pub title: String,
    pub counts: TraceabilityCounts,
    pub nodes: Vec<TraceabilityNode>,
    pub links: Vec<TraceabilityLink>,
    pub gaps: Vec<String>,
    pub next_actions: Vec<String>,
    pub generated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProductArchiveResult {
    pub export_dir: String,
    pub index_path: String,
    pub manifest_path: String,
    pub generated_at: String,
    pub counts: TraceabilityCounts,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProductArchiveImportResult {
    pub source_path: String,
    pub backup_path: String,
    pub imported_at: String,
    pub counts: TraceabilityCounts,
    pub warnings: Vec<String>,
}
