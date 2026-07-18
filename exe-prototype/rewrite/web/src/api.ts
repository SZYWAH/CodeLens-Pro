import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { runAiStream } from "./aiStreamRuntime";
import type {
  ActivityEvent,
  ActivityConstellationData,
  ActivityGalaxyData,
  ActivitySummary,
  AgentApplyRequest,
  AgentApplyResult,
  AgentPlanRequest,
  AgentTask,
  AiStreamEvent,
  AiTaskKind,
  AiTaskRunOptions,
  AnalysisRequest,
  AnalysisResponse,
  AppHealth,
  CardMaterial,
  ChatSessionDetail,
  ChatSessionSummary,
  ChatStreamRequest,
  CodeMap,
  DailyLog,
  DailySummary,
  DiffAnalyzeRequest,
  Finding,
  LearningCard,
  LearningCalendarItem,
  LearningCardCreate,
  LearningCardCandidate,
  LearningCenterData,
  LlmTestRequest,
  LlmTestResult,
  LegacyMigrationResult,
  ModelProfile,
  ModelProfileInput,
  ProductArchiveImportResult,
  ProductArchiveResult,
  ProjectAnalyzeRequest,
  ProjectGuide,
  ProjectImportResult,
  ReportDetail,
  ReportSummary,
  Settings,
  SettingsUpdate,
  TraceabilitySnapshot,
  WorkspaceDetail,
  WorkspaceBridgeInboxApplyResult,
  WorkspaceBridgeInboxRequest,
  WorkspaceBridgeManifestResult,
  WorkspaceBridgeStatus,
  WorkspaceSummary
} from "./types";

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

export async function getAppHealth(): Promise<AppHealth> {
  return call("get_app_health");
}

export async function getSettings(): Promise<Settings> {
  return call("get_settings");
}

export async function getLegacyMigrationState(): Promise<LegacyMigrationResult> {
  return call("get_legacy_migration_state");
}

export async function selectLegacyDataAndMigrate(): Promise<LegacyMigrationResult> {
  return call("select_legacy_data_and_migrate");
}

export async function restartApplication(): Promise<void> {
  return call("restart_application");
}

export async function saveSettings(update: SettingsUpdate): Promise<Settings> {
  return call("save_settings", { update });
}

export async function listModelProfiles(): Promise<ModelProfile[]> {
  return call("list_model_profiles");
}

export async function saveModelProfile(input: ModelProfileInput): Promise<ModelProfile> {
  return call("save_model_profile", { input });
}

export async function deleteModelProfile(id: string): Promise<ModelProfile[]> {
  return call("delete_model_profile", { id });
}

export async function importCodeFiles(): Promise<ProjectImportResult> {
  return call("import_code_files");
}

export async function importSingleCodeFile(): Promise<ProjectImportResult> {
  return call("import_single_code_file");
}

export async function importProjectFolder(): Promise<ProjectImportResult> {
  return call("import_project_folder");
}

export async function analyzeCodeStream(
  request: AnalysisRequest,
  options?: AiTaskRunOptions
): Promise<AnalysisResponse> {
  return runStream("single_review", "analyze_code_stream", (requestId) => ({ requestId, request }), options);
}

export async function analyzeProjectStream(
  request: ProjectAnalyzeRequest,
  options?: AiTaskRunOptions
): Promise<AnalysisResponse> {
  return runStream("project_review", "analyze_project_stream", (requestId) => ({ requestId, request }), options);
}

export async function analyzeDiffStream(
  request: DiffAnalyzeRequest,
  options?: AiTaskRunOptions
): Promise<AnalysisResponse> {
  return runStream("diff_review", "analyze_diff_stream", (requestId) => ({ requestId, request }), options);
}

export async function sendChatMessageStream(
  request: ChatStreamRequest,
  options?: AiTaskRunOptions
): Promise<ChatSessionDetail> {
  return runStream("chat", "send_chat_message_stream", (requestId) => ({ requestId, request }), options);
}

export async function importWorkspaceFolder(): Promise<WorkspaceDetail> {
  return call("import_workspace_folder");
}

export async function listWorkspaces(query?: string): Promise<WorkspaceSummary[]> {
  return call("list_workspaces", { query: query || null });
}

export async function getWorkspace(id: string): Promise<WorkspaceDetail> {
  return call("get_workspace", { id });
}

export async function rescanWorkspace(id: string): Promise<WorkspaceDetail> {
  return call("rescan_workspace", { id });
}

export async function deleteWorkspace(id: string): Promise<void> {
  return call("delete_workspace", { id });
}

export async function analyzeWorkspaceStream(
  workspaceId: string,
  options?: AiTaskRunOptions,
  retryReportId?: string
): Promise<AnalysisResponse> {
  return runStream("workspace_review", "analyze_workspace_stream", (requestId) => ({
    requestId,
    workspaceId,
    useLlm: true,
    retryReportId: retryReportId || null
  }), options);
}

export async function getCodeMap(workspaceId: string): Promise<CodeMap> {
  return call("get_code_map", { workspaceId });
}

export async function listFindings(workspaceId?: string, status?: string, severity?: string, reportId?: string): Promise<Finding[]> {
  return call("list_findings", {
    workspaceId: workspaceId || null,
    status: status || null,
    severity: severity || null,
    reportId: reportId || null
  });
}

export async function updateFindingStatus(id: string, status: string): Promise<Finding> {
  return call("update_finding_status", { id, status });
}

export async function createCardsFromFindings(findingIds: string[]): Promise<LearningCard[]> {
  return call("create_cards_from_findings", { findingIds });
}

export async function listLearningCards(workspaceId?: string, status?: string, tag?: string): Promise<LearningCard[]> {
  return call("list_learning_cards", {
    workspaceId: workspaceId || null,
    status: status || null,
    tag: tag || null
  });
}

export async function updateLearningCard(id: string, status: string): Promise<LearningCard> {
  return call("update_learning_card", { id, status });
}

export async function deleteLearningCard(id: string): Promise<void> {
  return call("delete_learning_card", { id });
}

export async function createLearningCard(input: LearningCardCreate): Promise<LearningCard> {
  return call("create_learning_card", { input });
}

export async function generateCardMaterialStream(
  cardId: string,
  useLlm = true,
  options?: AiTaskRunOptions
): Promise<CardMaterial> {
  return runStream("card_material", "generate_card_material_stream", (requestId) => ({ requestId, cardId, useLlm }), options);
}

export async function listCardMaterials(cardId?: string): Promise<CardMaterial[]> {
  return call("list_card_materials", { cardId: cardId || null });
}

export async function generateCardCandidatesFromReport(reportId: string): Promise<LearningCardCandidate[]> {
  return call("generate_card_candidates_from_report", { reportId });
}

export async function listLearningCardCandidates(status?: string, sourceId?: string): Promise<LearningCardCandidate[]> {
  return call("list_learning_card_candidates", {
    status: status || null,
    sourceId: sourceId || null
  });
}

export async function approveLearningCardCandidates(candidateIds: string[]): Promise<LearningCard[]> {
  return call("approve_learning_card_candidates", { candidateIds });
}

export async function rejectLearningCardCandidate(id: string): Promise<void> {
  return call("reject_learning_card_candidate", { id });
}

export async function getDailySummary(date: string): Promise<DailySummary> {
  return call("get_daily_summary", { date });
}

export async function generateDailyLog(date: string): Promise<DailyLog> {
  return call("generate_daily_log", { date });
}

export async function saveDailyLog(date: string, title: string, content: string): Promise<DailyLog> {
  return call("save_daily_log", { date, title, content });
}

export async function listDailyLogs(): Promise<DailyLog[]> {
  return call("list_daily_logs");
}

export async function exportDailyLogMarkdown(date: string): Promise<string> {
  return call("export_daily_log_markdown", { date });
}

export async function getLearningCalendar(month: string): Promise<LearningCalendarItem[]> {
  return call("get_learning_calendar", { month });
}

export async function getLearningCenter(date: string, month: string): Promise<LearningCenterData> {
  return call("get_learning_center", { date, month });
}

export async function generateProjectGuide(workspaceId: string): Promise<ProjectGuide> {
  return call("generate_project_guide", { workspaceId });
}

export async function getProjectGuide(workspaceId: string): Promise<ProjectGuide> {
  return call("get_project_guide", { workspaceId });
}

export async function createAgentPlan(request: AgentPlanRequest): Promise<AgentTask> {
  return call("create_agent_plan", { request });
}

export async function listAgentTasks(): Promise<AgentTask[]> {
  return call("list_agent_tasks");
}

export async function getAgentTask(id: string): Promise<AgentTask> {
  return call("get_agent_task", { id });
}

export async function deleteAgentTask(id: string): Promise<void> {
  return call("delete_agent_task", { id });
}

export async function applyAgentPlan(request: AgentApplyRequest): Promise<AgentApplyResult> {
  return call("apply_agent_plan", { request });
}

export async function rollbackAgentOperation(taskId: string, operationId: string): Promise<AgentTask> {
  return call("rollback_agent_operation", { taskId, operationId });
}

export async function getWorkspaceBridgeStatus(workspaceId?: string): Promise<WorkspaceBridgeStatus> {
  return call("get_workspace_bridge_status", { workspaceId: workspaceId || null });
}

export async function updateWorkspaceBridgeSelection(workspaceId: string, selectedFilePaths: string[]): Promise<WorkspaceBridgeStatus> {
  return call("update_workspace_bridge_selection", { workspaceId, selectedFilePaths });
}

export async function exportWorkspaceBridgeManifest(workspaceId?: string): Promise<WorkspaceBridgeManifestResult> {
  return call("export_workspace_bridge_manifest", { workspaceId: workspaceId || null });
}

export async function listWorkspaceBridgeInbox(): Promise<WorkspaceBridgeInboxRequest[]> {
  return call("list_workspace_bridge_inbox");
}

export async function createAgentPlanFromBridgeInbox(requestId: string): Promise<WorkspaceBridgeInboxApplyResult> {
  return call("create_agent_plan_from_bridge_inbox", { requestId });
}

export async function recordActivityEvent(
  eventType: string,
  title: string,
  detail: string,
  entityKind?: string,
  entityId?: string
): Promise<ActivityEvent> {
  return call("record_activity_event", {
    eventType,
    title,
    detail,
    entityKind: entityKind || null,
    entityId: entityId || null
  });
}

export async function getActivitySummary(): Promise<ActivitySummary> {
  return call("get_activity_summary");
}

export async function getActivityGalaxyData(): Promise<ActivityGalaxyData> {
  return call("get_activity_galaxy_data");
}

export async function getActivityConstellation(limit = 300): Promise<ActivityConstellationData> {
  return call("get_activity_constellation", { limit });
}

export async function getTraceabilitySnapshot(scopeKind?: string, scopeId?: string): Promise<TraceabilitySnapshot> {
  return call("get_traceability_snapshot", {
    scopeKind: scopeKind || null,
    scopeId: scopeId || null
  });
}

export async function listReports(query?: string, reportType?: string): Promise<ReportSummary[]> {
  return call("list_reports", {
    query: query || null,
    reportType: reportType || null
  });
}

export async function getReport(id: string): Promise<ReportDetail> {
  return call("get_report", { id });
}

export async function renameReport(id: string, title: string): Promise<ReportDetail> {
  return call("rename_report", { id, title });
}

export async function deleteReport(id: string): Promise<void> {
  return call("delete_report", { id });
}

export async function listChatSessions(query?: string): Promise<ChatSessionSummary[]> {
  return call("list_chat_sessions", { query: query || null });
}

export async function getChatSession(id: string): Promise<ChatSessionDetail> {
  return call("get_chat_session", { id });
}

export async function deleteChatSession(id: string): Promise<void> {
  return call("delete_chat_session", { id });
}

export async function testLlmConnection(request: LlmTestRequest): Promise<LlmTestResult> {
  return call("test_llm_connection", {
    request: { ...request, api_key: request.api_key === undefined ? null : request.api_key }
  });
}

export async function openStorageDir(): Promise<void> {
  return call("open_storage_dir");
}

export async function openLogsDir(): Promise<void> {
  return call("open_logs_dir");
}

export async function exportReportMarkdown(id: string): Promise<string> {
  return call("export_report_markdown", { id });
}

export async function exportReportHtml(id: string): Promise<string> {
  return call("export_report_html", { id });
}

export async function exportAgentTaskMarkdown(id: string): Promise<string> {
  return call("export_agent_task_markdown", { id });
}

export async function exportLearningCardsMarkdown(workspaceId?: string, status?: string, tag?: string): Promise<string> {
  return call("export_learning_cards_markdown", {
    workspaceId: workspaceId || null,
    status: status || null,
    tag: tag || null
  });
}

export async function copyReportText(id: string, _text: string): Promise<void> {
  return call("copy_report_text", { id });
}

export async function exportProductArchive(): Promise<ProductArchiveResult> {
  return call("export_product_archive");
}

export async function importProductArchive(): Promise<ProductArchiveImportResult> {
  return call("import_product_archive");
}

async function runStream<T>(
  task: AiTaskKind,
  command: string,
  buildArgs: (requestId: string) => Record<string, unknown>,
  options?: AiTaskRunOptions
): Promise<T> {
  ensureDesktopRuntime();
  return runAiStream<T>({
    listen: async (eventName, handler) => listen<AiStreamEvent<unknown>>(eventName, (event) => handler(event.payload)),
    invoke: (name, args) => invoke(name, args),
    cancel: (requestId) => invoke("cancel_ai_request", { requestId })
  }, { command, task, buildArgs, options });
}

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  ensureDesktopRuntime();
  return invoke<T>(command, args);
}

function ensureDesktopRuntime() {
  if (!window.__TAURI_INTERNALS__) {
    throw new Error("请在 CodeLens Pro Next 桌面应用中打开此界面。");
  }
}
