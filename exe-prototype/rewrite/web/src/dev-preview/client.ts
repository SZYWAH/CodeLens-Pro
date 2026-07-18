import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { runAiStream } from "../aiStreamRuntime";
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
  ProjectFileInput,
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
} from "../types";

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
    __CODELENS_PREVIEW_COMMAND_COUNTS__?: Record<string, number>;
  }
}

const mockReports: ReportDetail[] = [];
const mockSessions: ChatSessionDetail[] = [];
const mockWorkspaces: WorkspaceDetail[] = [];
const mockFindings: Finding[] = [];
const mockCards: LearningCard[] = [];
const mockMaterials: CardMaterial[] = [];
const mockDailyLogs: DailyLog[] = [];
const mockAgentTasks: AgentTask[] = [];
const mockActivityEvents: ActivityEvent[] = [];
const mockModelProfiles: ModelProfile[] = defaultModelProfiles();
const mockGuides = new Map<string, ProjectGuide>();
const mockBridgeSelections = new Map<string, string[]>();
const mockBridgeInbox: WorkspaceBridgeInboxRequest[] = [];
const mockCardCandidates: LearningCardCandidate[] = [];

export async function getAppHealth(): Promise<AppHealth> {
  return call("get_app_health", undefined, mockHealth);
}

export async function getSettings(): Promise<Settings> {
  return call("get_settings", undefined, () => mockSettingsValue);
}

export async function getLegacyMigrationState(): Promise<LegacyMigrationResult> {
  return {
    status: "not_needed",
    destination: "开发预览数据",
    databaseMigrated: false,
    logsMigrated: 0,
    restartRequired: false,
    message: "浏览器预览不执行桌面版数据迁移。"
  };
}

export async function selectLegacyDataAndMigrate(): Promise<LegacyMigrationResult> {
  return getLegacyMigrationState();
}

export async function restartApplication(): Promise<void> {
  return Promise.resolve();
}

export async function saveSettings(update: SettingsUpdate): Promise<Settings> {
  return call("save_settings", { update }, () => {
    const apiBase = update.api_base.trim();
    const model = update.model.trim();
    let parsed: URL;
    try {
      parsed = new URL(apiBase);
    } catch {
      throw new Error("API Base 必须是有效的 HTTP 或 HTTPS 地址。");
    }
    if (!(["http:", "https:"] as string[]).includes(parsed.protocol)) {
      throw new Error("API Base 必须是有效的 HTTP 或 HTTPS 地址。");
    }
    if (!model) throw new Error("模型名称不能为空。");
    const apiKeySet = update.clear_api_key ? false : Boolean(update.api_key?.trim()) || mockSettingsValue.api_key_set;
    const enabled = update.clear_api_key ? false : update.enable_llm;
    if (enabled && !apiKeySet) throw new Error("启用 LLM 前必须保存 API Key。");
    mockSettingsValue = {
      enable_llm: enabled,
      api_base: apiBase,
      model,
      api_key_set: apiKeySet,
      llm_state: !enabled ? "disabled" : apiKeySet ? "configured" : "missing_key"
    };
    return mockSettingsValue;
  });
}

export async function listModelProfiles(): Promise<ModelProfile[]> {
  return call("list_model_profiles", undefined, () => mockModelProfiles);
}

export async function saveModelProfile(input: ModelProfileInput): Promise<ModelProfile> {
  return call("save_model_profile", { input }, () => {
    const now = new Date().toISOString();
    const id = input.id || crypto.randomUUID();
    if (input.is_default) {
      for (const item of mockModelProfiles) item.is_default = false;
    }
    const existingIndex = mockModelProfiles.findIndex((item) => item.id === id);
    const profile: ModelProfile = {
      id,
      name: input.name.trim(),
      api_base: input.api_base.trim(),
      model: input.model.trim(),
      note: input.note.trim(),
      is_default: input.is_default,
      created_at: existingIndex >= 0 ? mockModelProfiles[existingIndex].created_at : now,
      updated_at: now
    };
    if (existingIndex >= 0) mockModelProfiles.splice(existingIndex, 1, profile);
    else mockModelProfiles.unshift(profile);
    return profile;
  });
}

export async function deleteModelProfile(id: string): Promise<ModelProfile[]> {
  return call("delete_model_profile", { id }, () => {
    const index = mockModelProfiles.findIndex((item) => item.id === id);
    if (index >= 0) mockModelProfiles.splice(index, 1);
    return mockModelProfiles;
  });
}

export async function importCodeFiles(): Promise<ProjectImportResult> {
  return call("import_code_files", undefined, () => mockImport());
}

export async function importSingleCodeFile(): Promise<ProjectImportResult> {
  return call("import_single_code_file", undefined, () => mockImport());
}

export async function importProjectFolder(): Promise<ProjectImportResult> {
  return call("import_project_folder", undefined, () => mockImport());
}

export async function analyzeCodeStream(request: AnalysisRequest, options?: AiTaskRunOptions): Promise<AnalysisResponse> {
  return runStream("single_review", "analyze_code_stream", (requestId) => ({ requestId, request }), options, async () => mockCodeAnalysis(request));
}

export async function analyzeProjectStream(
  request: ProjectAnalyzeRequest,
  options?: AiTaskRunOptions
): Promise<AnalysisResponse> {
  return runStream("project_review", "analyze_project_stream", (requestId) => ({ requestId, request }), options, () =>
    mockProjectAnalysis(request, options?.onChunk || (() => undefined))
  );
}

export async function analyzeDiffStream(
  request: DiffAnalyzeRequest,
  options?: AiTaskRunOptions
): Promise<AnalysisResponse> {
  return runStream("diff_review", "analyze_diff_stream", (requestId) => ({ requestId, request }), options, () =>
    mockDiffAnalysis(request, options?.onChunk || (() => undefined))
  );
}

export async function sendChatMessageStream(
  request: ChatStreamRequest,
  options?: AiTaskRunOptions
): Promise<ChatSessionDetail> {
  return runStream("chat", "send_chat_message_stream", (requestId) => ({ requestId, request }), options, () =>
    mockChat(request, options?.onChunk || (() => undefined))
  );
}

export async function importWorkspaceFolder(): Promise<WorkspaceDetail> {
  return call("import_workspace_folder", undefined, () => mockWorkspace());
}

export async function listWorkspaces(query?: string): Promise<WorkspaceSummary[]> {
  return call("list_workspaces", { query: query || null }, () => {
    const q = (query || "").toLowerCase();
    return mockWorkspaces
      .filter((item) => !q || [item.summary.name, item.summary.root_path, item.summary.language_summary].some((value) => value.toLowerCase().includes(q)))
      .map((item) => item.summary);
  });
}

export async function getWorkspace(id: string): Promise<WorkspaceDetail> {
  return call("get_workspace", { id }, () => {
    const workspace = mockWorkspaces.find((item) => item.summary.id === id);
    if (!workspace) throw new Error("workspace not found");
    return workspace;
  });
}

export async function rescanWorkspace(id: string): Promise<WorkspaceDetail> {
  return call("rescan_workspace", { id }, () => getWorkspace(id));
}

export async function deleteWorkspace(id: string): Promise<void> {
  return call("delete_workspace", { id }, () => {
    const index = mockWorkspaces.findIndex((item) => item.summary.id === id);
    if (index >= 0) mockWorkspaces.splice(index, 1);
  });
}

export async function analyzeWorkspaceStream(
  workspaceId: string,
  options?: AiTaskRunOptions,
  retryReportId?: string
): Promise<AnalysisResponse> {
  return runStream(
    "workspace_review",
    "analyze_workspace_stream",
    (requestId) => ({ requestId, workspaceId, useLlm: true, retryReportId: retryReportId || null }),
    options,
    async () => {
      const workspace = await getWorkspace(workspaceId);
      return mockProjectAnalysis(
        {
          project_name: workspace.summary.name,
          title: `${workspace.summary.name} 工作区审查`,
          files: workspace.files.map((file) => ({
            path: file.path,
            content: file.content,
            language: file.language
          })),
          use_llm: true
        },
        options?.onChunk || (() => undefined)
      );
    }
  );
}

export async function getCodeMap(workspaceId: string): Promise<CodeMap> {
  return call("get_code_map", { workspaceId }, async () => {
    const workspace = await getWorkspace(workspaceId);
    const languageTotals = new Map<string, { file_count: number; total_lines: number }>();
    for (const file of workspace.files) {
      const current = languageTotals.get(file.language) || { file_count: 0, total_lines: 0 };
      current.file_count += 1;
      current.total_lines += file.metrics.total_lines;
      languageTotals.set(file.language, current);
    }
    return {
      workspace_id: workspaceId,
      languages: [...languageTotals.entries()].map(([language, totals]) => ({ language, ...totals })),
      hotspot_files: workspace.files.map((file) => ({
        path: file.path,
        language: file.language,
        total_lines: file.metrics.total_lines,
        complexity_score: file.metrics.complexity_score,
        risk_count: file.metrics.risk_count
      })),
      symbols: workspace.files.map((file) => ({
        id: crypto.randomUUID(),
        workspace_id: workspaceId,
        file_path: file.path,
        name: "score",
        kind: "function",
        line: 1,
        signature: "export function score(items: number[])"
      })),
      dependencies: mockCodeMapDependencies(workspaceId)
    };
  });
}

export async function listFindings(workspaceId?: string, status?: string, severity?: string, reportId?: string): Promise<Finding[]> {
  return call("list_findings", { workspaceId: workspaceId || null, status: status || null, severity: severity || null, reportId: reportId || null }, () =>
    mockFindings.filter((item) =>
      (!workspaceId || item.workspace_id === workspaceId) &&
      (!status || status === "all" || item.status === status) &&
      (!severity || severity === "all" || item.severity === severity) &&
      (!reportId || item.report_id === reportId)
    )
  );
}

export async function updateFindingStatus(id: string, status: string): Promise<Finding> {
  return call("update_finding_status", { id, status }, () => {
    const finding = mockFindings.find((item) => item.id === id);
    if (!finding) throw new Error("finding not found");
    finding.status = status;
    finding.updated_at = new Date().toISOString();
    return finding;
  });
}

export async function createCardsFromFindings(findingIds: string[]): Promise<LearningCard[]> {
  return call("create_cards_from_findings", { findingIds }, () => {
    const source = findingIds.length
      ? mockFindings.filter((item) => findingIds.includes(item.id))
      : mockFindings.filter((item) => item.status !== "resolved");
    const cards = source.map((finding) => makeCard(finding));
    mockCards.unshift(...cards);
    return cards;
  });
}

export async function listLearningCards(workspaceId?: string, status?: string, tag?: string): Promise<LearningCard[]> {
  return call("list_learning_cards", { workspaceId: workspaceId || null, status: status || null, tag: tag || null }, () =>
    mockCards.filter((card) =>
      (!workspaceId || card.workspace_id === workspaceId) &&
      (!status || status === "all" || card.status === status) &&
      (!tag || card.tags.some((item) => item.toLowerCase() === tag.toLowerCase()))
    )
  );
}

export async function updateLearningCard(id: string, status: string): Promise<LearningCard> {
  return call("update_learning_card", { id, status }, () => {
    const card = mockCards.find((item) => item.id === id);
    if (!card) throw new Error("learning card not found");
    card.status = status;
    card.updated_at = new Date().toISOString();
    return card;
  });
}

export async function deleteLearningCard(id: string): Promise<void> {
  return call("delete_learning_card", { id }, () => {
    const index = mockCards.findIndex((item) => item.id === id);
    if (index >= 0) mockCards.splice(index, 1);
  });
}

export async function createLearningCard(input: LearningCardCreate): Promise<LearningCard> {
  return call("create_learning_card", { input }, () => {
    const now = new Date().toISOString();
    const card: LearningCard = {
      id: crypto.randomUUID(),
      finding_id: input.finding_id || null,
      workspace_id: input.workspace_id || null,
      title: input.title || "手动知识卡片",
      content: input.content,
      tags: input.tags.length ? input.tags : ["手动"],
      status: "new",
      created_at: now,
      updated_at: now
    };
    mockCards.unshift(card);
    mockActivity("card", "创建知识卡片", card.title, "learning_card", card.id);
    return card;
  });
}

async function generateCardMaterial(cardId: string, useLlm = true): Promise<CardMaterial> {
  return call("generate_card_material", { cardId, useLlm }, () => {
    const card = mockCards.find((item) => item.id === cardId);
    if (!card) throw new Error("未找到知识卡片");
    const material: CardMaterial = {
      id: crypto.randomUUID(),
      card_id: cardId,
      title: `${card.title}：学习材料`,
      content: `# ${card.title}\n\n## 学习目标\n理解这张卡片对应的代码审查知识点。\n\n## 卡片内容\n${card.content}\n\n## 练习\n- 用自己的话解释问题。\n- 找一个相似代码片段进行检查。\n- 写一个最小回归测试。`,
      source: "mock",
      created_at: new Date().toISOString()
    };
    mockMaterials.unshift(material);
    mockActivity("card", "生成学习材料", material.title, "card_material", material.id);
    return material;
  });
}

export async function listCardMaterials(cardId?: string): Promise<CardMaterial[]> {
  return call("list_card_materials", { cardId: cardId || null }, () =>
    mockMaterials.filter((item) => !cardId || item.card_id === cardId)
  );
}

export async function generateCardCandidatesFromReport(reportId: string): Promise<LearningCardCandidate[]> {
  return call("generate_card_candidates_from_report", { reportId }, () => {
    const report = mockReports.find((item) => item.id === reportId);
    if (!report) throw new Error("未找到报告");
    const seeds = [...report.risks, ...report.suggestions].slice(0, 12);
    const candidates = seeds.map((item, index) => makeCardCandidate(report, item, index));
    for (const candidate of candidates) {
      if (!mockCardCandidates.some((item) => item.dedupe_key === candidate.dedupe_key)) {
        mockCardCandidates.unshift(candidate);
      }
    }
    mockActivity("card_candidate", "生成知识卡片候选", `${candidates.length} 个候选`, "report", reportId);
    return mockCardCandidates.filter((item) => item.source_id === reportId && item.status === "pending");
  });
}

export async function listLearningCardCandidates(status?: string, sourceId?: string): Promise<LearningCardCandidate[]> {
  return call("list_learning_card_candidates", { status: status || null, sourceId: sourceId || null }, () =>
    mockCardCandidates.filter((item) =>
      (!status || status === "all" || item.status === status) &&
      (!sourceId || item.source_id === sourceId)
    )
  );
}

export async function approveLearningCardCandidates(candidateIds: string[]): Promise<LearningCard[]> {
  return call("approve_learning_card_candidates", { candidateIds }, () => {
    const cards: LearningCard[] = [];
    for (const candidate of mockCardCandidates.filter((item) => candidateIds.includes(item.id))) {
      candidate.status = "approved";
      const card: LearningCard = {
        id: crypto.randomUUID(),
        finding_id: candidate.finding_id || null,
        workspace_id: candidate.workspace_id || null,
        title: candidate.title,
        content: candidate.content,
        tags: candidate.tags,
        status: "new",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      cards.push(card);
      mockCards.unshift(card);
    }
    mockActivity("card", "审核通过知识卡片候选", `${cards.length} 张卡片`, "learning_card", cards[0]?.id);
    return cards;
  });
}

export async function rejectLearningCardCandidate(id: string): Promise<void> {
  return call("reject_learning_card_candidate", { id }, () => {
    const candidate = mockCardCandidates.find((item) => item.id === id);
    if (candidate) candidate.status = "rejected";
  });
}

export async function getDailySummary(date: string): Promise<DailySummary> {
  return call("get_daily_summary", { date }, () => mockDailySummary(date));
}

export async function generateDailyLog(date: string): Promise<DailyLog> {
  return call("generate_daily_log", { date }, () => {
    const summary = mockDailySummary(date);
    const now = new Date().toISOString();
    return {
      id: crypto.randomUUID(),
      date: summary.date,
      title: `${summary.date} 学习日志`,
      content: renderMockDailyLog(summary),
      created_at: now,
      updated_at: now
    };
  });
}

export async function saveDailyLog(date: string, title: string, content: string): Promise<DailyLog> {
  return call("save_daily_log", { date, title, content }, () => {
    const now = new Date().toISOString();
    const existing = mockDailyLogs.find((item) => item.date === date);
    const log: DailyLog = existing || {
      id: crypto.randomUUID(),
      date,
      title,
      content,
      created_at: now,
      updated_at: now
    };
    log.title = title;
    log.content = content;
    log.updated_at = now;
    if (!existing) mockDailyLogs.unshift(log);
    mockActivity("daily_log", "保存每日日志", title, "daily_log", log.id);
    return log;
  });
}

export async function listDailyLogs(): Promise<DailyLog[]> {
  return call("list_daily_logs", undefined, () => mockDailyLogs);
}

export async function exportDailyLogMarkdown(date: string): Promise<string> {
  return call("export_daily_log_markdown", { date }, () => `local-preview/storage/exports/daily-logs/${date}.md`);
}

export async function getLearningCalendar(month: string): Promise<LearningCalendarItem[]> {
  return call("get_learning_calendar", { month }, () => mockLearningCalendar(month));
}

export async function getLearningCenter(date: string, month: string): Promise<LearningCenterData> {
  return call("get_learning_center", { date, month }, () => ({
    today: mockDailySummary(date),
    calendar: mockLearningCalendar(month),
    review_cards: mockCards.filter((item) => item.status !== "mastered").slice(0, 8),
    recent_agent_tasks: mockAgentTasks.slice(0, 8)
  }));
}

export async function generateProjectGuide(workspaceId: string): Promise<ProjectGuide> {
  return call("generate_project_guide", { workspaceId }, async () => {
    const workspace = await getWorkspace(workspaceId);
    const guide = mockProjectGuide(workspace);
    mockGuides.set(workspaceId, guide);
    mockActivity("guide", "生成项目导览", guide.title, "workspace", workspaceId);
    return guide;
  });
}

export async function getProjectGuide(workspaceId: string): Promise<ProjectGuide> {
  return call("get_project_guide", { workspaceId }, () => {
    const existing = mockGuides.get(workspaceId);
    if (existing) return existing;
    throw new Error("当前工作区还没有项目导览，请先生成导览。");
  });
}

export async function generateCardMaterialStream(
  cardId: string,
  useLlm = true,
  options?: AiTaskRunOptions
): Promise<CardMaterial> {
  return runStream("card_material", "generate_card_material_stream", (requestId) => ({ requestId, cardId, useLlm }), options, () =>
    generateCardMaterial(cardId, useLlm)
  );
}

export async function createAgentPlan(request: AgentPlanRequest): Promise<AgentTask> {
  return call("create_agent_plan", { request }, () => {
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    const goal = request.goal || "围绕当前上下文生成确认式改进计划";
    const taskDir = `.codelens-agent/tasks/${id.slice(0, 8)}`;
    const planPath = `${taskDir}/plan.md`;
    const checklistPath = `${taskDir}/checklist.md`;
    const manifestPath = `${taskDir}/context.json`;
    const steps = ["确认目标与边界", "定位关键文件与风险", "设计最小修复路径", "制定验证清单"].map((title, index) => ({
      id: crypto.randomUUID(),
      task_id: id,
      position: index + 1,
      title,
      detail: "只读分析当前上下文，生成可复制的执行建议。",
      risk: "执行前需要人工确认影响范围。",
      suggested_patch: index === 2 ? `生成 ${planPath}、${checklistPath} 和 ${manifestPath} 作为可追踪执行草稿。` : "此步骤输出检查清单。",
      status: "planned"
    }));
    const selectedFiles = request.selected_file_paths.map((item) => `- ${item}`).join("\n") || "- 暂未选择候选文件";
    const task: AgentTask = {
      id,
      context_kind: request.context_kind,
      context_id: request.context_id,
      title: `Agent 计划：${goal}`,
      summary: "这是本地预览模式中的确认式 Agent 计划。桌面端会在人工确认后写入计划草稿文件。",
      status: "planned",
      selected_file_paths: request.selected_file_paths,
      apply_summary: "等待用户确认后应用。",
      created_at: now,
      updated_at: now,
      steps,
      operations: [
        {
          id: crypto.randomUUID(),
          task_id: id,
          path: planPath,
          operation: "create_or_replace",
          title: "生成 Agent 执行计划",
          preview: `将在工作区内写入 ${planPath}，记录目标、上下文、候选文件和验证清单。`,
          replacement: `# Agent 执行草稿\n\n## 目标\n${goal}\n\n## 候选文件\n${selectedFiles}\n`,
          status: "pending",
          confirmed: false,
          backup_path: null,
          applied_at: null,
          error: null
        },
        {
          id: crypto.randomUUID(),
          task_id: id,
          path: checklistPath,
          operation: "create_or_replace",
          title: "生成执行确认清单",
          preview: `将在工作区内写入 ${checklistPath}，用于人工确认和应用后验证。`,
          replacement: `# Agent 执行确认清单\n\n## 目标\n${goal}\n\n## 上下文确认\n${selectedFiles}\n\n## 应用前检查\n- [ ] 确认影响范围\n- [ ] 确认回滚方式\n- [ ] 确认验证命令\n`,
          status: "pending",
          confirmed: false,
          backup_path: null,
          applied_at: null,
          error: null
        },
        {
          id: crypto.randomUUID(),
          task_id: id,
          path: manifestPath,
          operation: "create_or_replace",
          title: "生成上下文清单",
          preview: `将在工作区内写入 ${manifestPath}，用于后续追踪 Agent 上下文。`,
          replacement: JSON.stringify({ product: "CodeLens Pro Next", kind: "agent_context_manifest", task_id: id, goal, context_kind: request.context_kind, context_id: request.context_id, selected_file_paths: request.selected_file_paths, generated_at: now }, null, 2),
          status: "pending",
          confirmed: false,
          backup_path: null,
          applied_at: null,
          error: null
        }
      ]
    };
    mockAgentTasks.unshift(task);
    mockActivity("agent", "生成 Agent 计划", task.title, "agent_task", task.id);
    return task;
  });
}

export async function listAgentTasks(): Promise<AgentTask[]> {
  return call("list_agent_tasks", undefined, () => mockAgentTasks);
}

export async function getAgentTask(id: string): Promise<AgentTask> {
  return call("get_agent_task", { id }, () => {
    const task = mockAgentTasks.find((item) => item.id === id);
    if (!task) throw new Error("未找到 Agent 计划");
    return task;
  });
}

export async function deleteAgentTask(id: string): Promise<void> {
  return call("delete_agent_task", { id }, () => {
    const index = mockAgentTasks.findIndex((item) => item.id === id);
    if (index >= 0) mockAgentTasks.splice(index, 1);
  });
}

export async function applyAgentPlan(request: AgentApplyRequest): Promise<AgentApplyResult> {
  return call("apply_agent_plan", { request }, () => {
    if (!request.confirm) throw new Error("应用 Agent 计划前必须确认。");
    const task = mockAgentTasks.find((item) => item.id === request.task_id);
    if (!task) throw new Error("未找到 Agent 计划");
    const operationIds = request.operation_ids.length ? request.operation_ids : task.operations.map((item) => item.id);
    let appliedCount = 0;
    for (const operation of task.operations) {
      if (!operationIds.includes(operation.id)) continue;
      operation.status = "applied";
      operation.confirmed = true;
      operation.applied_at = new Date().toISOString();
      operation.backup_path = `local-preview/storage/backups/agent/${task.id}/${operation.path.replace(/[\\/]/g, "_")}`;
      appliedCount += 1;
    }
    task.status = appliedCount === operationIds.length ? "applied" : "partial";
    task.apply_summary = `已确认 ${operationIds.length} 项操作，成功应用 ${appliedCount} 项。`;
    task.updated_at = new Date().toISOString();
    mockActivity("agent", "应用 Agent 计划", task.apply_summary, "agent_task", task.id);
    return {
      task,
      applied_count: appliedCount,
      backup_dir: `local-preview/storage/backups/agent/${task.id}`,
      messages: task.operations.filter((item) => operationIds.includes(item.id)).map((item) => `${item.path} 已标记为已应用。`)
    };
  });
}

export async function rollbackAgentOperation(taskId: string, operationId: string): Promise<AgentTask> {
  return call("rollback_agent_operation", { taskId, operationId }, () => {
    const task = mockAgentTasks.find((item) => item.id === taskId);
    if (!task) throw new Error("未找到 Agent 计划");
    const operation = task.operations.find((item) => item.id === operationId);
    if (!operation) throw new Error("未找到 Agent 文件操作");
    if (operation.status !== "applied") throw new Error("只有已应用的操作可以回滚。");
    operation.status = "rolled_back";
    operation.error = null;
    task.status = task.operations.some((item) => item.status === "applied")
      ? "partial"
      : task.operations.some((item) => item.status === "pending")
        ? "planned"
        : "rolled_back";
    task.apply_summary = `已回滚文件操作：${operation.path}`;
    task.updated_at = new Date().toISOString();
    mockActivity("agent", "回滚 Agent 操作", task.apply_summary, "agent_task", task.id);
    return task;
  });
}

export async function getWorkspaceBridgeStatus(workspaceId?: string): Promise<WorkspaceBridgeStatus> {
  return call("get_workspace_bridge_status", { workspaceId: workspaceId || null }, () => mockWorkspaceBridge(workspaceId));
}

export async function updateWorkspaceBridgeSelection(workspaceId: string, selectedFilePaths: string[]): Promise<WorkspaceBridgeStatus> {
  return call("update_workspace_bridge_selection", { workspaceId, selectedFilePaths }, () => {
    mockBridgeSelections.set(workspaceId, selectedFilePaths.slice(0, 12));
    return mockWorkspaceBridge(workspaceId);
  });
}

export async function exportWorkspaceBridgeManifest(workspaceId?: string): Promise<WorkspaceBridgeManifestResult> {
  return call("export_workspace_bridge_manifest", { workspaceId: workspaceId || null }, () => {
    const status = mockWorkspaceBridge(workspaceId);
    const name = status.workspace_name || "workspace";
    return {
      export_dir: `local-preview/storage/bridge/${name}`,
      manifest_path: `local-preview/storage/bridge/${name}/manifest.json`,
      readme_path: `local-preview/storage/bridge/${name}/README.md`,
      current_dir: "local-preview/storage/bridge/current",
      current_manifest_path: "local-preview/storage/bridge/current/manifest.json",
      current_readme_path: "local-preview/storage/bridge/current/README.md",
      generated_at: new Date().toISOString(),
      workspace_id: status.workspace_id,
      workspace_name: status.workspace_name,
      selected_file_count: status.selected_file_paths.length,
      candidate_file_count: status.candidate_files.length
    };
  });
}

export async function listWorkspaceBridgeInbox(): Promise<WorkspaceBridgeInboxRequest[]> {
  return call("list_workspace_bridge_inbox", undefined, () => {
    ensureMockBridgeInbox();
    return mockBridgeInbox.slice().sort((left, right) => right.created_at.localeCompare(left.created_at));
  });
}

export async function createAgentPlanFromBridgeInbox(requestId: string): Promise<WorkspaceBridgeInboxApplyResult> {
  return call("create_agent_plan_from_bridge_inbox", { requestId }, async () => {
    ensureMockBridgeInbox();
    const index = mockBridgeInbox.findIndex((item) => item.id === requestId || item.file_path.endsWith(requestId));
    if (index < 0) throw new Error("未找到桥接收件箱请求");
    const request = mockBridgeInbox[index];
    if (request.status === "invalid") throw new Error(request.error || "桥接请求格式无效");
    const task = await createAgentPlan({
      context_kind: request.context_kind,
      context_id: request.context_id,
      goal: request.goal,
      selected_file_paths: request.selected_file_paths
    });
    mockBridgeInbox.splice(index, 1);
    return {
      request: {
        ...request,
        status: "processed",
        file_path: `local-preview/storage/bridge/processed/${request.id}.json`
      },
      task
    };
  });
}

export async function recordActivityEvent(
  eventType: string,
  title: string,
  detail: string,
  entityKind?: string,
  entityId?: string
): Promise<ActivityEvent> {
  return call(
    "record_activity_event",
    { eventType, title, detail, entityKind: entityKind || null, entityId: entityId || null },
    () => mockActivity(eventType, title, detail, entityKind, entityId)
  );
}

export async function getActivitySummary(): Promise<ActivitySummary> {
  return call("get_activity_summary", undefined, () => mockActivitySummary());
}

export async function getActivityGalaxyData(): Promise<ActivityGalaxyData> {
  return call("get_activity_galaxy_data", undefined, () => ({
    nodes: [
      { id: "reports", label: "历史报告", group: "analysis", weight: Math.max(mockReports.length, 1) },
      { id: "workspaces", label: "工作区", group: "analysis", weight: Math.max(mockWorkspaces.length, 1) },
      { id: "findings", label: "问题清单", group: "review", weight: Math.max(mockFindings.length, 1) },
      { id: "cards", label: "知识卡片", group: "learning", weight: Math.max(mockCards.length, 1) },
      { id: "chats", label: "AI 对话", group: "ai", weight: Math.max(mockSessions.length, 1) },
      { id: "agent", label: "Agent 计划", group: "agent", weight: Math.max(mockAgentTasks.length, 1) }
    ],
    links: [
      { source: "workspaces", target: "reports", weight: Math.max(mockReports.length, 1) },
      { source: "reports", target: "findings", weight: Math.max(mockFindings.length, 1) },
      { source: "findings", target: "cards", weight: Math.max(mockCards.length, 1) },
      { source: "reports", target: "chats", weight: Math.max(mockSessions.length, 1) },
      { source: "findings", target: "agent", weight: Math.max(mockAgentTasks.length, 1) }
    ]
  }));
}

export async function getActivityConstellation(limit = 300): Promise<ActivityConstellationData> {
  return call("get_activity_constellation", { limit }, () => ({
    items: mockActivityEvents.slice(0, Math.max(1, Math.min(limit, 300))).map((event, index) => {
      const kind = mockActivityStarKind(event.entity_kind || event.event_type);
      const targetId = event.entity_id || event.id;
      return {
        id: `${event.entity_kind || event.event_type}:${targetId}`,
        kind,
        kind_label: mockActivityKindLabel(kind),
        title: event.title,
        subtitle: event.detail,
        status: "active",
        target_id: targetId,
        created_at: event.created_at,
        route: {
          page: mockActivityRoutePage(kind),
          target_id: targetId,
          session_id: kind === "chat" ? targetId : null,
          plan_id: kind === "agent" ? targetId : null,
          context_type: mockActivityKindLabel(kind)
        },
        weight: Math.max(1, 6 - Math.floor(index / 10))
      };
    }),
    code_line_count: mockWorkspaces.reduce((sum, item) => sum + item.summary.total_lines, 0)
  }));
}

export async function getTraceabilitySnapshot(scopeKind?: string, scopeId?: string): Promise<TraceabilitySnapshot> {
  return call(
    "get_traceability_snapshot",
    { scopeKind: scopeKind || null, scopeId: scopeId || null },
    () => mockTraceabilitySnapshot(scopeKind, scopeId)
  );
}

export async function listReports(query?: string, reportType?: string): Promise<ReportSummary[]> {
  return call("list_reports", { query: query || null, reportType: reportType || null }, () => {
    const q = (query || "").toLowerCase();
    return mockReports
      .filter((report) => !reportType || reportType === "all" || report.report_type === reportType)
      .filter((report) => !q || [report.title, report.language, report.summary].some((value) => value.toLowerCase().includes(q)))
      .map(toSummary);
  });
}

export async function getReport(id: string): Promise<ReportDetail> {
  return call("get_report", { id }, () => {
    const report = mockReports.find((item) => item.id === id);
    if (!report) throw new Error("report not found");
    return report;
  });
}

export async function renameReport(id: string, title: string): Promise<ReportDetail> {
  return call("rename_report", { id, title }, () => {
    const report = mockReports.find((item) => item.id === id);
    if (!report) throw new Error("report not found");
    const base = title.trim().slice(0, 60);
    if (!base) throw new Error("报告标题不能为空。");
    let candidate = base;
    let counter = 2;
    while (mockReports.some((item) => item.id !== id && item.title === candidate)) {
      candidate = `${base.slice(0, Math.max(0, 60 - String(counter).length - 2))}（${counter}）`;
      counter += 1;
    }
    report.title = candidate;
    return report;
  });
}

export async function deleteReport(id: string): Promise<void> {
  return call("delete_report", { id }, () => {
    const index = mockReports.findIndex((item) => item.id === id);
    if (index >= 0) mockReports.splice(index, 1);
  });
}

export async function listChatSessions(query?: string): Promise<ChatSessionSummary[]> {
  return call("list_chat_sessions", { query: query || null }, () =>
    mockSessions.map((session) => ({
      id: session.id,
      title: session.title,
      context_report_id: session.context_report_id,
      created_at: session.created_at,
      updated_at: session.updated_at,
      message_count: session.messages.length
    }))
  );
}

export async function getChatSession(id: string): Promise<ChatSessionDetail> {
  return call("get_chat_session", { id }, () => {
    const session = mockSessions.find((item) => item.id === id);
    if (!session) throw new Error("chat session not found");
    return session;
  });
}

export async function deleteChatSession(id: string): Promise<void> {
  return call("delete_chat_session", { id }, () => {
    const index = mockSessions.findIndex((item) => item.id === id);
    if (index >= 0) mockSessions.splice(index, 1);
  });
}

export async function testLlmConnection(request: LlmTestRequest): Promise<LlmTestResult> {
  const keyAvailable = request.api_key === undefined
    ? mockSettingsValue.api_key_set
    : Boolean(request.api_key.trim());
  const configured = Boolean(request.api_base.trim() && request.model.trim() && keyAvailable);
  return call("test_llm_connection", {
    request: { ...request, api_key: request.api_key === undefined ? null : request.api_key }
  }, () => ({
    ok: configured,
    message: configured ? "本地预览连接结果。" : "请完整填写 API Base、模型和 API Key。",
    api_base: request.api_base,
    model: request.model,
    latency_ms: 12,
    error_code: configured ? null : "configuration"
  }));
}

export async function openStorageDir(): Promise<void> {
  return call("open_storage_dir", undefined, () => undefined);
}

export async function openLogsDir(): Promise<void> {
  return call("open_logs_dir", undefined, () => undefined);
}

export async function exportReportMarkdown(id: string): Promise<string> {
  return call("export_report_markdown", { id }, () => "local-preview/storage/exports/report.md");
}

export async function exportReportHtml(id: string): Promise<string> {
  return call("export_report_html", { id }, () => "local-preview/storage/exports/report.html");
}

export async function exportAgentTaskMarkdown(id: string): Promise<string> {
  return call("export_agent_task_markdown", { id }, () => "local-preview/storage/exports/agent/agent-plan.md");
}

export async function exportLearningCardsMarkdown(workspaceId?: string, status?: string, tag?: string): Promise<string> {
  return call(
    "export_learning_cards_markdown",
    { workspaceId: workspaceId || null, status: status || null, tag: tag || null },
    () => "local-preview/storage/exports/learning-cards/cards.md"
  );
}

export async function copyReportText(id: string, text: string): Promise<void> {
  if (!hasTauriInvoke() && navigator.clipboard) {
    await navigator.clipboard.writeText(text);
    return;
  }
  return call("copy_report_text", { id }, async () => {
    if (navigator.clipboard) await navigator.clipboard.writeText(text);
  });
}

export async function exportProductArchive(): Promise<ProductArchiveResult> {
  return call("export_product_archive", undefined, () => {
    const snapshot = mockTraceabilitySnapshot("global");
    return {
      export_dir: "local-preview/storage/exports/product-archive",
      index_path: "local-preview/storage/exports/product-archive/index.md",
      manifest_path: "local-preview/storage/exports/product-archive/manifest.json",
      generated_at: new Date().toISOString(),
      counts: snapshot.counts
    };
  });
}

export async function importProductArchive(): Promise<ProductArchiveImportResult> {
  return call("import_product_archive", undefined, () => {
    const snapshot = mockTraceabilitySnapshot("global");
    return {
      source_path: "local-preview/storage/exports/product-archive/manifest.json",
      backup_path: "local-preview/storage/backups/codelens-next-before-archive-import.sqlite",
      imported_at: new Date().toISOString(),
      counts: snapshot.counts,
      warnings: []
    };
  });
}

async function runStream<T>(
  task: AiTaskKind,
  command: string,
  buildArgs: (requestId: string) => Record<string, unknown>,
  options: AiTaskRunOptions | undefined,
  mock: () => Promise<T>
): Promise<T> {
  recordPreviewCommand(command);
  if (!hasTauriInvoke()) {
    if (options?.signal?.aborted) throw new Error("AI 任务已取消。");
    previewPhases(options);
    return mock();
  }
  return runAiStream<T>({
    listen: async (eventName, handler) => listen<AiStreamEvent<unknown>>(eventName, (event) => handler(event.payload)),
    invoke: (name, args) => invoke(name, args),
    cancel: (requestId) => invoke("cancel_ai_request", { requestId })
  }, { command, task, buildArgs, options });
}

function previewPhases(options?: AiTaskRunOptions) {
  options?.onPhase?.("accepted");
  options?.onPhase?.("connecting");
  options?.onPhase?.("streaming");
  options?.onPhase?.("saving");
}

async function call<T>(
  command: string,
  args: Record<string, unknown> | undefined,
  mock: () => T | Promise<T>
): Promise<T> {
  recordPreviewCommand(command);
  if (hasTauriInvoke()) {
    return invoke<T>(command, args);
  }
  return mock();
}

function hasTauriInvoke(): boolean {
  const internals = window.__TAURI_INTERNALS__ as { invoke?: unknown } | undefined;
  return typeof internals?.invoke === "function";
}

function recordPreviewCommand(command: string) {
  const counts = window.__CODELENS_PREVIEW_COMMAND_COUNTS__ || {};
  counts[command] = (counts[command] || 0) + 1;
  window.__CODELENS_PREVIEW_COMMAND_COUNTS__ = counts;
  document.documentElement.dataset.previewCommandCounts = JSON.stringify(counts);
}

let mockSettingsValue: Settings = {
  enable_llm: false,
  api_base: "https://api.deepseek.com/v1",
  model: "deepseek-chat",
  api_key_set: false,
  llm_state: "disabled"
};

function defaultModelProfiles(): ModelProfile[] {
  const builtAt = "1970-01-01T00:00:00Z";
  return [
    {
      id: "builtin-deepseek-chat",
      name: "DeepSeek Chat",
      api_base: "https://api.deepseek.com/v1",
      model: "deepseek-chat",
      note: "适合中文代码审查、报告生成、项目导览和学习材料。",
      is_default: true,
      created_at: builtAt,
      updated_at: builtAt
    },
    {
      id: "builtin-openai-compatible",
      name: "OpenAI Compatible",
      api_base: "https://api.openai.com/v1",
      model: "gpt-4.1-mini",
      note: "适合 OpenAI-compatible 云端模型和通用对话接口。",
      is_default: false,
      created_at: builtAt,
      updated_at: builtAt
    },
    {
      id: "builtin-local-gateway",
      name: "Local Gateway",
      api_base: "http://127.0.0.1:11434/v1",
      model: "local-model",
      note: "适合本地模型网关、局域网代理或离线增强能力。",
      is_default: false,
      created_at: builtAt,
      updated_at: builtAt
    }
  ];
}

function mockHealth(): AppHealth {
  return {
    version: "1.1.0",
    app_home: "local-preview",
    storage_dir: "local-preview/storage",
    logs_dir: "local-preview/logs",
    database_path: "local-preview/storage/codelens-next.sqlite",
    database_ok: true,
    database_message: "本地预览模式",
    llm_enabled: mockSettingsValue.enable_llm,
    llm_configured: mockSettingsValue.api_key_set
  };
}

function mockWorkspace(): WorkspaceDetail {
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const files = mockImport().files.map((file) => ({
    id: crypto.randomUUID(),
    workspace_id: id,
    path: file.path,
    language: file.language || "TypeScript",
    content_hash: "local-preview",
    content: file.content,
    metrics: {
      total_lines: file.content.split("\n").length,
      non_empty_lines: file.content.split("\n").filter(Boolean).length,
      comment_lines: 0,
      complexity_score: 2,
      risk_count: 1,
      suggestion_count: 1
    },
    updated_at: now
  }));
  if (denseProjectFixtureEnabled()) {
    for (let index = 1; index <= 72; index += 1) {
      const name = `module-${String(index).padStart(2, "0")}`;
      const content = index < 72
        ? `import { value as nextValue } from "./module-${String(index + 1).padStart(2, "0")}";\n\nexport const value = nextValue + ${index};`
        : `export const value = ${index};`;
      files.push({
        id: crypto.randomUUID(),
        workspace_id: id,
        path: `src/dense/${name}.ts`,
        language: "TypeScript",
        content_hash: `dense-${index}`,
        content,
        metrics: {
          total_lines: content.split("\n").length,
          non_empty_lines: content.split("\n").filter(Boolean).length,
          comment_lines: 0,
          complexity_score: 1,
          risk_count: index % 11 === 0 ? 1 : 0,
          suggestion_count: 0
        },
        updated_at: now
      });
    }
  }
  const workspace: WorkspaceDetail = {
    summary: {
      id,
      name: "预览工作区",
      root_path: "local-preview/workspace",
      file_count: files.length,
      total_lines: files.reduce((sum, file) => sum + file.metrics.total_lines, 0),
      language_summary: denseProjectFixtureEnabled()
        ? "TypeScript: 81, Rust: 2, Markdown: 1"
        : "TypeScript: 9, Rust: 2, Markdown: 1",
      created_at: now,
      updated_at: now
    },
    files,
    skipped: []
  };
  mockWorkspaces.unshift(workspace);
    const finding: Finding = {
    id: crypto.randomUUID(),
    workspace_id: id,
    report_id: null,
    file_path: files[0]?.path || "src/main.ts",
    severity: "medium",
    category: "maintainability",
    title: "预览问题：输入边界需要检查",
    detail: "本地预览模式根据模拟工作区生成的问题，用于验证页面流程。",
    line_start: 1,
    line_end: 1,
    suggestion: "请在桌面应用中导入真实项目以获得完整索引。",
    status: "open",
    created_at: now,
    updated_at: now
  };
  mockFindings.unshift(finding);
  mockActivity("workspace", "导入工作区", workspace.summary.name, "workspace", workspace.summary.id);
  return workspace;
}

function mockWorkspaceBridge(workspaceId?: string): WorkspaceBridgeStatus {
  const workspace = workspaceId
    ? mockWorkspaces.find((item) => item.summary.id === workspaceId)
    : mockWorkspaces[0];
  const now = new Date().toISOString();
  if (!workspace) {
    return {
      connected: false,
      status: "no_workspace",
      workspace_id: null,
      workspace_name: "未打开工作区",
      workspace_root: "",
      candidate_files: [],
      selected_file_paths: [],
      heartbeat_at: "",
      updated_at: now,
      plugin_version: "local-preview/1.0",
      message: "请先导入或打开一个本地工作区。"
    };
  }
  const selected = mockBridgeSelections.get(workspace.summary.id) || workspace.files.slice(0, 5).map((file) => file.path);
  return {
    connected: true,
    status: "browser_preview_bridge",
    workspace_id: workspace.summary.id,
    workspace_name: workspace.summary.name,
    workspace_root: workspace.summary.root_path,
    candidate_files: workspace.files
      .map((file) => ({
        path: file.path,
        language: file.language,
        total_lines: file.metrics.total_lines,
        complexity_score: file.metrics.complexity_score,
        risk_count: file.metrics.risk_count,
        selected: selected.includes(file.path)
      }))
      .sort((left, right) => right.risk_count - left.risk_count || right.complexity_score - left.complexity_score || left.path.localeCompare(right.path)),
    selected_file_paths: selected,
    heartbeat_at: now,
    updated_at: now,
    plugin_version: "local-preview/1.0",
    message: "本地预览桥接已就绪；桌面端会使用本地 Tauri 工作区状态。"
  };
}

function ensureMockBridgeInbox() {
  if (mockBridgeInbox.length > 0) return;
  const workspace = mockWorkspaces[0];
  const selected = workspace?.files.slice(0, 2).map((file) => file.path) || ["src/main.ts"];
  mockBridgeInbox.push({
    id: "preview-editor-request",
    source: "本地预览",
    workspace_id: workspace?.summary.id || null,
    context_kind: workspace ? "workspace" : "general",
    context_id: workspace?.summary.id || "general",
    goal: "根据外部编辑器选中的上下文生成确认式改进计划",
    selected_file_paths: selected,
    created_at: new Date().toISOString(),
    file_path: "local-preview/storage/bridge/inbox/preview-editor-request.json",
    status: "pending",
    error: null
  });
}

function mockImport(): ProjectImportResult {
  return {
    project_name: "CodeLens Preview",
    root_path: null,
    skipped: [],
    files: [
      {
        path: "src/main.ts",
        language: "TypeScript",
        content: "import { createApp } from './app/createApp';\n\ncreateApp().start();"
      },
      {
        path: "src/app/createApp.ts",
        language: "TypeScript",
        content: "import { reviewWorkspace } from '../services/reviewService';\nimport { renderSummary } from '../ui/renderSummary';\n\nexport function createApp() {\n  return { start: () => renderSummary(reviewWorkspace()) };\n}"
      },
      {
        path: "src/services/reviewService.ts",
        language: "TypeScript",
        content: "import { loadReports } from '../data/reportRepository';\nimport { scoreRisk } from '../domain/riskScorer';\nimport { formatDate } from '../utils/formatDate';\n\nexport function reviewWorkspace() {\n  return loadReports().map((report) => ({ ...report, risk: scoreRisk(report), date: formatDate(new Date()) }));\n}"
      },
      {
        path: "src/data/reportRepository.ts",
        language: "TypeScript",
        content: "export function loadReports() { return [{ id: 'report-1', findings: 3 }]; }"
      },
      {
        path: "src/domain/riskScorer.ts",
        language: "TypeScript",
        content: "export function scoreRisk(report: { findings: number }) { return report.findings > 2 ? 'high' : 'low'; }"
      },
      {
        path: "src/ui/renderSummary.ts",
        language: "TypeScript",
        content: "export function renderSummary(value: unknown) { document.body.textContent = JSON.stringify(value); }"
      },
      {
        path: "src/utils/formatDate.ts",
        language: "TypeScript",
        content: "export function formatDate(value: Date) { return value.toISOString().slice(0, 10); }"
      },
      {
        path: "tests/reviewService.spec.ts",
        language: "TypeScript",
        content: "import { reviewWorkspace } from '../src/services/reviewService';\n\ntest('reviews workspace', () => expect(reviewWorkspace()).toHaveLength(1));"
      },
      {
        path: "scripts/build.ts",
        language: "TypeScript",
        content: "import { build } from 'vite';\n\nvoid build();"
      },
      {
        path: "desktop/src/main.rs",
        language: "Rust",
        content: "mod commands;\n\nfn main() { commands::start(); }"
      },
      {
        path: "desktop/src/commands.rs",
        language: "Rust",
        content: "pub fn start() { println!(\"desktop ready\"); }"
      },
      {
        path: "README.md",
        language: "Markdown",
        content: "# CodeLens Preview\n\nA stable fixture for project navigation and dependency graph testing."
      }
    ]
  };
}

function mockCodeMapDependencies(workspaceId: string) {
  const rows: Array<[string, string, string, number]> = [
    ["src/main.ts", "./app/createApp", "import", 1],
    ["src/app/createApp.ts", "../services/reviewService", "import", 1],
    ["src/app/createApp.ts", "../ui/renderSummary", "import", 2],
    ["src/services/reviewService.ts", "../data/reportRepository", "import", 1],
    ["src/services/reviewService.ts", "../domain/riskScorer", "import", 2],
    ["src/services/reviewService.ts", "../utils/formatDate", "import", 3],
    ["tests/reviewService.spec.ts", "../src/services/reviewService", "import", 1],
    ["scripts/build.ts", "vite", "import", 1],
    ["desktop/src/main.rs", "crate::commands", "mod", 1]
  ];
  if (denseProjectFixtureEnabled()) {
    for (let index = 1; index <= 38; index += 1) {
      rows.push([
        `src/dense/module-${String(index).padStart(2, "0")}.ts`,
        `./module-${String(index + 1).padStart(2, "0")}`,
        "import",
        1
      ]);
    }
  }
  return rows.map(([source_path, target, kind, line]) => ({
    id: crypto.randomUUID(),
    workspace_id: workspaceId,
    source_path,
    target,
    kind,
    line
  }));
}

function denseProjectFixtureEnabled() {
  return new URL(window.location.href).searchParams.get("fixture") === "dense";
}

function mockCodeAnalysis(request: AnalysisRequest): AnalysisResponse {
  const language = request.language && request.language !== "auto" ? request.language : "TypeScript";
  const lineCount = request.code.split("\n").length;
  const modeLabel = request.mode_label || "综合代码审查";
  const full = `# 单文件代码分析报告\n\n## 摘要\n已分析 ${lineCount} 行 ${language} 代码。当前为浏览器预览模式，桌面端会调用 Rust 本地分析并保存到 SQLite。\n\n## 分析模式\n- 当前模式：${modeLabel}\n- 后续动作：可继续生成知识卡片、加入每日日志，或围绕本报告创建 Agent 计划。\n\n## 主要风险\n- 请关注输入校验、异常处理、敏感信息和复杂分支。\n\n## 优先建议\n- 把核心行为补充成测试用例，再把报告中的高价值结论沉淀为知识卡片或 Agent 计划。`;
  const report = makeReport(request.title || previewSingleReportTitle(request, language), "single", full, [
    { path: "pasted-code", content: request.code, language }
  ]);
  report.metadata_json = JSON.stringify({ analysis_profile: modeLabel, mode_group: request.mode_group, mode: request.mode });
  mockReports.unshift(report);
  mockActivity("report", "生成单文件代码分析报告", report.title, "report", report.id);
  return { report, warnings: [] };
}

function previewSingleReportTitle(request: AnalysisRequest, language: string): string {
  const source = request.source_label?.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, "").trim();
  const symbol = request.code.match(/(?:async\s+function|function|async\s+fn|fn|def|class|struct|interface)\s+([A-Za-z_$][\w$]*)/)?.[1];
  const subject = source || symbol || language;
  return `${subject} ${request.mode_label || "代码审查"}`.slice(0, 60);
}

async function mockProjectAnalysis(request: ProjectAnalyzeRequest, onChunk: (chunk: string) => void): Promise<AnalysisResponse> {
  const full = `# 项目分析报告\n\n## 摘要\n已分析 ${request.project_name} 中的 ${request.files.length} 个文件。\n\n## 主要风险\n- 本地预览模式使用模拟数据。\n\n## 优先建议\n- 在 Tauri 桌面应用中运行，以验证 SQLite 持久化和真实索引。`;
  onChunk(full);
  const report = makeReport(request.title || `${request.project_name} 项目分析`, "project", full, request.files);
  mockReports.unshift(report);
  mockActivity("report", "生成项目分析报告", report.title, "report", report.id);
  return { report, warnings: [] };
}

async function mockDiffAnalysis(request: DiffAnalyzeRequest, onChunk: (chunk: string) => void): Promise<AnalysisResponse> {
  const full = `# 代码对比报告\n\n## 摘要\n已对比 ${request.before_label} 与 ${request.after_label}。\n\n## 建议\n- 复查变更分支，并为关键路径补充回归测试。`;
  onChunk(full);
  const report = makeReport(request.title || "代码对比分析", "diff", full, []);
  mockReports.unshift(report);
  mockActivity("report", "生成代码对比报告", report.title, "report", report.id);
  return { report, warnings: [] };
}

async function mockChat(request: ChatStreamRequest, onChunk: (chunk: string) => void): Promise<ChatSessionDetail> {
  const now = new Date().toISOString();
  const session =
    mockSessions.find((item) => item.id === request.session_id) ||
    {
      id: crypto.randomUUID(),
      title: request.message.slice(0, 48) || "新对话",
      context_report_id: request.context_report_id || null,
      created_at: now,
      updated_at: now,
      messages: []
    };
  if (!mockSessions.includes(session)) mockSessions.unshift(session);
  session.messages.push({
    id: crypto.randomUUID(),
    session_id: session.id,
    role: "user",
    content: request.message,
    created_at: now
  });
  const answer = "这是本地预览回复。真实流式 AI 对话请在桌面应用中运行。";
  onChunk(answer);
  session.messages.push({
    id: crypto.randomUUID(),
    session_id: session.id,
    role: "assistant",
    content: answer,
    created_at: new Date().toISOString()
  });
  session.updated_at = new Date().toISOString();
  mockActivity("chat", "AI 对话回复", request.message, "chat_session", session.id);
  return session;
}

function makeReport(title: string, reportType: string, fullReport: string, files: ProjectFileInput[]): ReportDetail {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    title,
    language: files.length > 1 ? "Mixed" : files[0]?.language || "Plain Text",
    code_excerpt: files.map((file) => file.path).join("\n"),
    summary: `已生成 ${reportType} 报告。`,
    full_report: fullReport,
    analysis_source: "mock",
    report_type: reportType,
    risk_level: "low",
    file_count: Math.max(files.length, reportType === "diff" ? 2 : 1),
    metadata_json: "{}",
    risks: ["预览风险项。"],
    suggestions: ["预览建议项。"],
    metrics: {
      total_lines: files.reduce((sum, file) => sum + file.content.split("\n").length, 0),
      non_empty_lines: files.reduce((sum, file) => sum + file.content.split("\n").filter(Boolean).length, 0),
      comment_lines: 0,
      complexity_score: 1,
      risk_count: 1,
      suggestion_count: 1
    },
    files: [],
    created_at: now
  };
}

function toSummary(report: ReportDetail): ReportSummary {
  return {
    id: report.id,
    title: report.title,
    language: report.language,
    summary: report.summary,
    analysis_source: report.analysis_source,
    report_type: report.report_type,
    risk_level: report.risk_level,
    file_count: report.file_count,
    created_at: report.created_at,
    risk_count: report.risks.length
  };
}

function makeCard(finding: Finding): LearningCard {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    finding_id: finding.id,
    workspace_id: finding.workspace_id,
    title: `复习：${finding.title}`,
    content: `${finding.detail}\n\n练习：${finding.suggestion}`,
    tags: [finding.severity, finding.category],
    status: "new",
    created_at: now,
    updated_at: now
  };
}

function makeCardCandidate(report: ReportDetail, content: string, index: number): LearningCardCandidate {
  const titlePrefix = index < report.risks.length ? "风险复习" : "改进建议";
  const title = `${titlePrefix}：${content.slice(0, 36)}`;
  return {
    id: crypto.randomUUID(),
    source_kind: "report",
    source_id: report.id,
    workspace_id: report.metadata_json.includes("workspace_id") ? null : null,
    report_id: report.id,
    finding_id: null,
    title,
    content: `来源报告：${report.title}\n\n${content}\n\n复习要求：说明它为什么重要，并设计一个检查或测试动作。`,
    tags: [report.report_type, report.risk_level, "报告候选"],
    difficulty: report.risk_level === "high" ? "hard" : "medium",
    status: "pending",
    dedupe_key: `report:${report.id}:${title}`,
    created_at: new Date().toISOString()
  };
}

function mockDailySummary(date: string): DailySummary {
  const day = date || new Date().toISOString().slice(0, 10);
  const highlights = mockActivityEvents
    .filter((event) => event.created_at.startsWith(day))
    .slice(0, 8)
    .map((event) => `${activityTypeLabel(event.event_type)}：${event.title}`);
  return {
    date: day,
    report_count: mockReports.filter((item) => item.created_at.startsWith(day)).length,
    chat_message_count: mockSessions.reduce((sum, session) => sum + session.messages.filter((item) => item.created_at.startsWith(day)).length, 0),
    finding_count: mockFindings.filter((item) => item.created_at.startsWith(day)).length,
    card_count: mockCards.filter((item) => item.created_at.startsWith(day)).length,
    agent_task_count: mockAgentTasks.filter((item) => item.created_at.startsWith(day)).length,
    activity_count: mockActivityEvents.filter((item) => item.created_at.startsWith(day)).length,
    highlights: highlights.length ? highlights : ["今天还没有活动记录，可以先导入工作区或生成报告。"]
  };
}

function mockLearningCalendar(month: string): LearningCalendarItem[] {
  const safeMonth = /^\d{4}-\d{2}$/.test(month) ? month : new Date().toISOString().slice(0, 7);
  const [year, monthIndex] = safeMonth.split("-").map(Number);
  const days = new Date(year, monthIndex, 0).getDate();
  return Array.from({ length: days }, (_, index) => {
    const date = `${safeMonth}-${String(index + 1).padStart(2, "0")}`;
    const summary = mockDailySummary(date);
    return {
      date,
      has_log: mockDailyLogs.some((item) => item.date === date),
      activity_count: summary.activity_count,
      report_count: summary.report_count,
      card_count: summary.card_count,
      agent_task_count: summary.agent_task_count
    };
  });
}

function renderMockDailyLog(summary: DailySummary): string {
  return `# ${summary.date} 学习日志\n\n## 今日数据\n- 报告：${summary.report_count} 份\n- 对话消息：${summary.chat_message_count} 条\n- 新增问题：${summary.finding_count} 个\n- 知识卡片：${summary.card_count} 张\n- Agent 计划：${summary.agent_task_count} 个\n\n## 关键活动\n${summary.highlights.map((item) => `- ${item}`).join("\n")}\n\n## 今日复盘\n今天的重点是把代码审查结果沉淀为可复习的知识。\n\n## 明日建议\n- 复查未解决问题。\n- 从一张未掌握卡片开始复习。\n- 为高风险问题生成 Agent dry-run 计划。`;
}

function mockProjectGuide(workspace: WorkspaceDetail): ProjectGuide {
  const hotFiles = [...workspace.files]
    .sort((left, right) => right.metrics.complexity_score - left.metrics.complexity_score)
    .slice(0, 8);
  return {
    workspace_id: workspace.summary.id,
    title: `${workspace.summary.name} 项目导览`,
    summary: `${workspace.summary.name} 包含 ${workspace.summary.file_count} 个文件、${workspace.summary.total_lines} 行代码。导览基于本地预览数据生成。`,
    architecture: [
      {
        title: "代码入口与核心文件",
        detail: "先确认入口文件、组件边界和数据流，再进入高复杂度文件。",
        path: hotFiles[0]?.path || null
      },
      {
        title: "语言分布",
        detail: `当前语言分布：${workspace.summary.language_summary}`,
        path: null
      }
    ],
    reading_order: hotFiles.map((file, index) => ({
      title: `第 ${index + 1} 步：阅读 ${file.path}`,
      detail: `${file.language} 文件，复杂度 ${file.metrics.complexity_score}，风险 ${file.metrics.risk_count}。`,
      path: file.path
    })),
    key_files: workspace.files.slice(0, 10).map((file) => ({
      title: file.path,
      detail: `${file.metrics.total_lines} 行，复杂度 ${file.metrics.complexity_score}。`,
      path: file.path
    })),
    generated_at: new Date().toISOString()
  };
}

function mockActivity(
  eventType: string,
  title: string,
  detail: string,
  entityKind?: string,
  entityId?: string
): ActivityEvent {
  const event: ActivityEvent = {
    id: crypto.randomUUID(),
    event_type: eventType,
    title,
    detail,
    entity_kind: entityKind || null,
    entity_id: entityId || null,
    created_at: new Date().toISOString()
  };
  mockActivityEvents.unshift(event);
  return event;
}

function mockActivityStarKind(source?: string | null) {
  if (source === "workspace") return "workspace";
  if (source === "report" || source === "product_archive") return "report";
  if (source === "finding") return "finding";
  if (source === "learning_card" || source === "card" || source === "card_candidate" || source === "card_material") return "card";
  if (source === "daily_log") return "log";
  if (source === "chat" || source === "chat_session") return "chat";
  if (source === "agent" || source === "agent_task") return "agent";
  return "activity";
}

function mockActivityKindLabel(kind: string) {
  const labels: Record<string, string> = {
    workspace: "工作区",
    report: "报告",
    finding: "问题",
    card: "知识卡片",
    log: "每日日志",
    chat: "对话",
    agent: "行动草稿",
    activity: "活动"
  };
  return labels[kind] || "活动";
}

function mockActivityRoutePage(kind: string) {
  const routes: Record<string, string> = {
    workspace: "projects",
    report: "history",
    finding: "findings",
    card: "cards",
    log: "logs",
    chat: "chat",
    agent: "agent"
  };
  return routes[kind] || "galaxy";
}

function mockActivitySummary(): ActivitySummary {
  const counts = new Map<string, number>();
  for (const event of mockActivityEvents) {
    const day = event.created_at.slice(0, 10);
    counts.set(day, (counts.get(day) || 0) + 1);
  }
  return {
    report_count: mockReports.length,
    chat_count: mockSessions.reduce((sum, session) => sum + session.messages.length, 0),
    card_count: mockCards.length,
    workspace_count: mockWorkspaces.length,
    finding_count: mockFindings.length,
    agent_task_count: mockAgentTasks.length,
    recent_events: mockActivityEvents.slice(0, 60),
    daily_counts: Array.from(counts.entries()).map(([date, count]) => ({ date, count }))
  };
}

function mockTraceabilitySnapshot(scopeKind = "global", scopeId?: string): TraceabilitySnapshot {
  const now = new Date().toISOString();
  const report = scopeKind === "report" && scopeId ? mockReports.find((item) => item.id === scopeId) : null;
  const workspace = scopeKind === "workspace" && scopeId ? mockWorkspaces.find((item) => item.summary.id === scopeId) : mockWorkspaces[0] || null;
  const relatedFindings = report
    ? mockFindings.filter((item) => item.report_id === report.id)
    : workspace
      ? mockFindings.filter((item) => item.workspace_id === workspace.summary.id)
      : mockFindings;
  const relatedCards = workspace
    ? mockCards.filter((item) => item.workspace_id === workspace.summary.id || relatedFindings.some((finding) => finding.id === item.finding_id))
    : mockCards;
  const relatedChats = report ? mockSessions.filter((item) => item.context_report_id === report.id) : mockSessions;
  const relatedAgents = report
    ? mockAgentTasks.filter((item) => item.context_kind === "report" && item.context_id === report.id)
    : workspace
      ? mockAgentTasks.filter((item) => item.context_kind === "workspace" && item.context_id === workspace.summary.id)
      : mockAgentTasks;
  const relatedLogs = mockDailyLogs.filter((item) =>
    report ? item.content.includes(report.title) : workspace ? item.content.includes(workspace.summary.name) : true
  );
  const nodes = [
    ...(workspace ? [{ id: `workspace:${workspace.summary.id}`, kind: "workspace", title: workspace.summary.name, subtitle: `${workspace.summary.file_count} 个文件 · ${workspace.summary.language_summary}`, status: "linked", weight: workspace.summary.file_count || 1 }] : []),
    ...(report ? [{ id: `report:${report.id}`, kind: "report", title: report.title, subtitle: `${report.report_type} · ${report.risk_level}`, status: report.risk_level, weight: report.metrics.risk_count || 1 }] : mockReports.slice(0, 4).map((item) => ({ id: `report:${item.id}`, kind: "report", title: item.title, subtitle: `${item.report_type} · ${item.risk_level}`, status: item.risk_level, weight: item.metrics.risk_count || 1 }))),
    ...relatedFindings.slice(0, 8).map((item) => ({ id: `finding:${item.id}`, kind: "finding", title: item.title, subtitle: `${item.file_path} · ${item.severity} · ${item.status}`, status: item.status, weight: item.severity === "high" ? 3 : item.severity === "medium" ? 2 : 1 })),
    ...relatedCards.slice(0, 8).map((item) => ({ id: `card:${item.id}`, kind: "card", title: item.title, subtitle: `${item.status} · ${item.tags.join("、")}`, status: item.status, weight: 1 })),
    ...relatedChats.slice(0, 4).map((item) => ({ id: `chat:${item.id}`, kind: "chat", title: item.title, subtitle: `${item.messages.length} 条消息`, status: "linked", weight: item.messages.length || 1 })),
    ...relatedAgents.slice(0, 5).map((item) => ({ id: `agent:${item.id}`, kind: "agent", title: item.title, subtitle: `${item.status} · ${item.operations.length} 个文件操作`, status: item.status, weight: item.operations.length || 1 })),
    ...relatedLogs.slice(0, 3).map((item) => ({ id: `daily_log:${item.id}`, kind: "daily_log", title: item.title, subtitle: `${item.date} · ${item.updated_at}`, status: "linked", weight: 1 }))
  ];
  const links = [
    ...(workspace && (report || mockReports.length) ? [{ source: `workspace:${workspace.summary.id}`, target: report ? `report:${report.id}` : `report:${mockReports[0].id}`, label: "生成报告", weight: 1 }] : []),
    ...relatedFindings.slice(0, 8).map((item) => ({ source: item.report_id ? `report:${item.report_id}` : workspace ? `workspace:${workspace.summary.id}` : "report:all", target: `finding:${item.id}`, label: "拆解问题", weight: 1 })),
    ...relatedCards.slice(0, 8).map((item) => ({ source: item.finding_id ? `finding:${item.finding_id}` : workspace ? `workspace:${workspace.summary.id}` : "finding:all", target: `card:${item.id}`, label: "沉淀卡片", weight: 1 })),
    ...relatedChats.slice(0, 4).map((item) => ({ source: report ? `report:${report.id}` : "report:all", target: `chat:${item.id}`, label: "继续对话", weight: item.messages.length || 1 })),
    ...relatedAgents.slice(0, 5).map((item) => ({ source: `${item.context_kind}:${item.context_id}`, target: `agent:${item.id}`, label: "生成计划", weight: 1 }))
  ];
  const gaps: string[] = [];
  const next_actions: string[] = [];
  if (!workspace && scopeKind !== "report") gaps.push("还没有可关联的真实工作区。");
  if (relatedFindings.length === 0) gaps.push("尚未形成结构化问题清单。");
  if (relatedCards.length === 0) gaps.push("尚未沉淀知识卡片。");
  if (relatedAgents.length === 0) gaps.push("尚未生成 Agent 计划。");
  if (relatedLogs.length === 0) gaps.push("尚未写入每日学习日志。");
  if (gaps.length === 0) {
    next_actions.push("闭环已经串联，可以继续复查未解决问题或应用 Agent 草稿。");
  } else {
    next_actions.push("优先补齐问题清单、知识卡片、每日日志和 Agent 计划。");
  }
  return {
    scope_kind: scopeKind,
    scope_id: scopeId || null,
    title: report ? `报告闭环：${report.title}` : workspace ? `工作区闭环：${workspace.summary.name}` : "本地产品闭环总览",
    counts: {
      workspaces: workspace ? 1 : mockWorkspaces.length,
      reports: report ? 1 : mockReports.length,
      findings: relatedFindings.length,
      cards: relatedCards.length,
      chats: relatedChats.length,
      daily_logs: relatedLogs.length,
      agent_tasks: relatedAgents.length,
      activity_events: mockActivityEvents.length
    },
    nodes,
    links,
    gaps,
    next_actions,
    generated_at: now
  };
}

function seedPreviewFixtures() {
  if (mockWorkspaces.length) return;

  const workspace = mockWorkspace();
  const report = makeReport(
    "预览项目审查报告",
    "project",
    "# 预览项目审查报告\n\n## 摘要\n用于验证问题索引、知识卡片、候选审核与来源回溯。\n\n## 风险\n- 外部输入进入业务分支前缺少校验。\n- 超长模块增加人工审查成本。\n\n## 建议\n- 提取边界校验并补充回归测试。\n- 将复杂逻辑拆分成职责清晰的函数。",
    workspace.files
  );
  report.risk_level = "high";
  report.risks = ["外部输入缺少边界校验", "复杂模块需要重点复查"];
  report.suggestions = ["为异常路径补充回归测试", "拆分高复杂度函数并补充命名"];
  report.metadata_json = JSON.stringify({ workspace_id: workspace.summary.id, mode_label: "风险审查" });
  mockReports.unshift(report);

  const baseFinding = mockFindings[0];
  if (!baseFinding) return;
  baseFinding.report_id = report.id;
  const fixtures: Array<Pick<Finding, "title" | "file_path" | "severity" | "category" | "status">> = [
    { title: "复杂文件需要重点审查：输入校验与异常分支耦合", file_path: "src/features/authentication/validateExternalIdentity.ts", severity: "high", category: "security", status: "open" },
    { title: "检测到疑似凭据相关字符串，避免提交密钥或在日志中输出敏感信息。", file_path: "src/config/runtime/environment.defaults.ts", severity: "high", category: "security", status: "reviewing" },
    { title: "响应解析逻辑缺少失败路径，可能导致页面状态不同步", file_path: "src/services/profile/parseRemoteProfileResponse.ts", severity: "medium", category: "reliability", status: "open" },
    { title: "状态更新函数承担过多职责，建议拆分为命名清晰的 helper", file_path: "src/workbench/state/synchronizeReviewLifecycle.ts", severity: "medium", category: "maintainability", status: "resolved" },
    { title: "缺少输入边界测试，建议覆盖空值与超长文本", file_path: "tests/review/input-boundaries.spec.ts", severity: "low", category: "quality", status: "open" }
  ];
  const now = new Date().toISOString();
  for (const fixture of fixtures) {
    mockFindings.unshift({
      ...baseFinding,
      ...fixture,
      id: crypto.randomUUID(),
      workspace_id: workspace.summary.id,
      report_id: report.id,
      detail: `预览夹具：${fixture.title}`,
      suggestion: "确认影响范围后，补充边界校验与最小回归测试。",
      created_at: now,
      updated_at: now
    });
  }

  const statusCycle = ["new", "reviewing", "mastered"] as const;
  const cards = mockFindings.slice(0, 4).map((finding, index) => ({
    ...makeCard(finding),
    status: statusCycle[index % statusCycle.length],
    tags: [finding.severity, finding.category, index % 2 ? "边界校验" : "复盘"]
  }));
  mockCards.unshift(...cards);
  if (cards[0]) {
    mockMaterials.unshift({
      id: crypto.randomUUID(),
      card_id: cards[0].id,
      title: `${cards[0].title}：学习材料`,
      content: `# ${cards[0].title}\n\n## 学习目标\n解释风险来源，并写出最小验证路径。\n\n## 复习提示\n- 用自己的话说明问题。\n- 找到类似代码片段。\n- 写出回归测试。`,
      source: "mock",
      created_at: now
    });
  }
  mockCardCandidates.unshift(...report.risks.map((item, index) => makeCardCandidate(report, item, index)));
  mockActivity("report", "生成预览审查报告", report.title, "report", report.id);
  mockActivity("card", "沉淀预览知识卡片", `${cards.length} 张卡片`, "learning_card", cards[0]?.id);
  const showcaseActivityTitles = [
    "完成风险审查",
    "定位复杂度热点",
    "整理边界验证",
    "复盘异常路径",
    "补充回归检查",
    "归纳项目结构",
    "记录关键依赖",
    "更新问题状态",
    "沉淀审查结论",
    "整理阅读路线",
    "核对代码地图",
    "生成学习摘要",
    "复习知识卡片",
    "记录每日进展",
    "确认后续动作",
    "归档审查上下文"
  ];
  while (mockActivityEvents.length < 18) {
    const index = mockActivityEvents.length;
    mockActivity(
      "activity",
      showcaseActivityTitles[index % showcaseActivityTitles.length],
      `活动展示台交互样本 ${String(index + 1).padStart(2, "0")}`,
      "activity"
    );
  }
}

seedPreviewFixtures();

function activityTypeLabel(value: string) {
  const labels: Record<string, string> = {
    workspace: "工作区",
    report: "报告",
    finding: "问题",
    card: "知识卡片",
    daily_log: "每日日志",
    guide: "项目导览",
    agent: "Agent",
    chat: "对话"
  };
  return labels[value] || "活动";
}
