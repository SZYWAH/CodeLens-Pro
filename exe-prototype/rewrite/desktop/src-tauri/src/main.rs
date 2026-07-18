#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::collections::HashMap;
use std::env;
use std::fs;
use std::future::Future;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use codelens_next_core::{
    classify_llm_error_code,
    ActivityConstellationData, ActivityEvent, ActivityGalaxyData, ActivitySummary,
    AgentApplyRequest, AgentApplyResult, AgentPlanRequest, AgentTask, AnalysisRequest,
    AppHealth, CardMaterial, ChatSessionDetail, ChatSessionSummary,
    ChatStreamRequest, CodeMap, CoreApp, DailyLog, DailySummary, DiffAnalyzeRequest, Finding,
    LearningCalendarItem, LearningCard,
    LearningCardCandidate, LearningCardCreate, LearningCenterData, LlmTestRequest, LlmTestResult,
    ModelProfile, ModelProfileInput, ProductArchiveImportResult, ProductArchiveResult, ProjectAnalyzeRequest, ProjectGuide,
    ProjectImportResult, ReportDetail, ReportSummary, Settings, SettingsUpdate,
    TraceabilitySnapshot, WorkspaceBridgeInboxApplyResult, WorkspaceBridgeInboxRequest,
    WorkspaceBridgeManifestResult, WorkspaceBridgeStatus, WorkspaceDetail, WorkspaceSummary,
};
use serde::Serialize;
use serde_json::Value;
use tauri::{Emitter, Manager, State, Window};
use tokio_util::sync::CancellationToken;

#[cfg(not(windows))]
use std::io::Write;
#[cfg(windows)]
use std::os::windows::process::CommandExt;

type CommandResult<T> = Result<T, String>;

const AI_TASK_TIMEOUT: Duration = Duration::from_secs(90);

#[derive(Debug, Clone, Serialize)]
struct AiTaskError {
    code: String,
    message: String,
    retryable: bool,
}

#[derive(Debug, Clone, Serialize)]
struct AiStreamEvent {
    request_id: String,
    task: String,
    event: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    phase: Option<String>,
    sequence: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    chunk: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<AiTaskError>,
}

#[derive(Default)]
struct AiRequestRegistry {
    active: Mutex<HashMap<String, CancellationToken>>,
}

impl AiRequestRegistry {
    fn register(&self, request_id: &str) -> CommandResult<CancellationToken> {
        if request_id.trim().is_empty() {
            return Err("request_id 不能为空。".to_string());
        }
        let mut active = self
            .active
            .lock()
            .map_err(|_| "AI 请求注册表不可用。".to_string())?;
        if active.contains_key(request_id) {
            return Err(format!("AI 请求已存在：{request_id}"));
        }
        let token = CancellationToken::new();
        active.insert(request_id.to_string(), token.clone());
        Ok(token)
    }

    fn cancel(&self, request_id: &str) -> CommandResult<bool> {
        let active = self
            .active
            .lock()
            .map_err(|_| "AI 请求注册表不可用。".to_string())?;
        if let Some(token) = active.get(request_id) {
            token.cancel();
            Ok(true)
        } else {
            Ok(false)
        }
    }

    fn remove(&self, request_id: &str) {
        if let Ok(mut active) = self.active.lock() {
            active.remove(request_id);
        }
    }
}

#[derive(Clone)]
struct AiEventEmitter {
    window: Window,
    request_id: String,
    task: &'static str,
    sequence: Arc<AtomicU64>,
    streaming_started: Arc<AtomicBool>,
    chunk_count: Arc<AtomicU64>,
}

impl AiEventEmitter {
    fn new(window: Window, request_id: String, task: &'static str) -> Self {
        Self {
            window,
            request_id,
            task,
            sequence: Arc::new(AtomicU64::new(0)),
            streaming_started: Arc::new(AtomicBool::new(false)),
            chunk_count: Arc::new(AtomicU64::new(0)),
        }
    }

    fn emit(
        &self,
        event: &str,
        phase: Option<&str>,
        chunk: Option<String>,
        result: Option<Value>,
        error: Option<AiTaskError>,
    ) -> anyhow::Result<()> {
        let payload = AiStreamEvent {
            request_id: self.request_id.clone(),
            task: self.task.to_string(),
            event: event.to_string(),
            phase: phase.map(str::to_string),
            sequence: self.sequence.fetch_add(1, Ordering::Relaxed),
            chunk,
            result,
            error,
        };
        self.window.emit("ai:stream", payload)?;
        Ok(())
    }

    fn phase(&self, phase: &str) -> anyhow::Result<()> {
        self.emit("phase", Some(phase), None, None, None)
    }

    fn chunk(&self, chunk: &str) -> anyhow::Result<()> {
        if !self.streaming_started.swap(true, Ordering::Relaxed) {
            self.phase("streaming")?;
        }
        self.chunk_count.fetch_add(1, Ordering::Relaxed);
        self.emit("chunk", None, Some(chunk.to_string()), None, None)
    }

    fn chunk_count(&self) -> u64 {
        self.chunk_count.load(Ordering::Relaxed)
    }

    fn error(&self, error: AiTaskError) -> anyhow::Result<()> {
        self.emit("error", None, None, None, Some(error))
    }
}

fn begin_ai_request(
    registry: &AiRequestRegistry,
    emitter: &AiEventEmitter,
) -> CommandResult<Option<CancellationToken>> {
    let token = match registry.register(&emitter.request_id) {
        Ok(token) => token,
        Err(message) => {
            emitter
                .error(AiTaskError {
                    code: "internal".to_string(),
                    message,
                    retryable: false,
                })
                .map_err(format_error)?;
            return Ok(None);
        }
    };

    if let Err(error) = emitter
        .phase("accepted")
        .and_then(|_| emitter.phase("connecting"))
    {
        registry.remove(&emitter.request_id);
        return Err(format_error(error));
    }
    Ok(Some(token))
}

async fn complete_ai_task<T, F>(
    core: &CoreApp,
    registry: &AiRequestRegistry,
    emitter: &AiEventEmitter,
    token: CancellationToken,
    future: F,
) -> CommandResult<()>
where
    T: Serialize,
    F: Future<Output = anyhow::Result<T>>,
{
    enum Outcome<T> {
        Completed(anyhow::Result<T>),
        Cancelled,
        TimedOut,
    }

    let started_at = Instant::now();
    core.log_ai_task_event(
        &emitter.request_id,
        emitter.task,
        "accepted",
        0,
        0,
        None,
        None,
    );
    let outcome = tokio::select! {
        biased;
        _ = token.cancelled() => Outcome::Cancelled,
        _ = tokio::time::sleep(AI_TASK_TIMEOUT) => {
            token.cancel();
            Outcome::TimedOut
        },
        result = future => Outcome::Completed(result),
    };

    let result = match outcome {
        Outcome::Completed(Ok(value)) => match serde_json::to_value(value) {
            Ok(value) => {
                let source = ai_result_source(&value).map(str::to_string);
                let result = emit_ai_success(emitter, value);
                core.log_ai_task_event(
                    &emitter.request_id,
                    emitter.task,
                    "completed",
                    started_at.elapsed().as_millis(),
                    emitter.chunk_count(),
                    source.as_deref(),
                    None,
                );
                result
            }
            Err(error) => {
                core.log_ai_task_event(
                    &emitter.request_id,
                    emitter.task,
                    "error",
                    started_at.elapsed().as_millis(),
                    emitter.chunk_count(),
                    None,
                    Some("internal"),
                );
                emitter
                    .error(AiTaskError {
                        code: "internal".to_string(),
                        message: format!("AI 结果序列化失败：{error}"),
                        retryable: false,
                    })
                    .map_err(format_error)
            }
        },
        Outcome::Completed(Err(error)) => {
            let error = classify_ai_error(&error.to_string());
            core.log_ai_task_event(
                &emitter.request_id,
                emitter.task,
                "error",
                started_at.elapsed().as_millis(),
                emitter.chunk_count(),
                None,
                Some(&error.code),
            );
            emitter.error(error).map_err(format_error)
        }
        Outcome::Cancelled => {
            core.log_ai_task_event(
                &emitter.request_id,
                emitter.task,
                "cancelled",
                started_at.elapsed().as_millis(),
                emitter.chunk_count(),
                None,
                Some("cancelled"),
            );
            emitter.error(AiTaskError {
                code: "cancelled".to_string(),
                message: "AI 任务已取消。".to_string(),
                retryable: false,
            })
            .map_err(format_error)
        }
        Outcome::TimedOut => {
            core.log_ai_task_event(
                &emitter.request_id,
                emitter.task,
                "timeout",
                started_at.elapsed().as_millis(),
                emitter.chunk_count(),
                None,
                Some("timeout"),
            );
            emitter.error(AiTaskError {
                code: "timeout".to_string(),
                message: "AI 任务超过 90 秒，已自动取消。".to_string(),
                retryable: true,
            })
            .map_err(format_error)
        }
    };
    registry.remove(&emitter.request_id);
    result
}

fn emit_ai_success(emitter: &AiEventEmitter, value: Value) -> CommandResult<()> {
    if is_fallback_result(&value) {
        emitter.phase("fallback").map_err(format_error)?;
    }
    emitter.phase("saving").map_err(format_error)?;
    emitter
        .emit("done", None, None, Some(value), None)
        .map_err(format_error)
}

fn ai_result_source(value: &Value) -> Option<&str> {
    value
        .pointer("/report/analysis_source")
        .or_else(|| value.get("source"))
        .and_then(Value::as_str)
}

fn is_fallback_result(value: &Value) -> bool {
    value
        .pointer("/report/analysis_source")
        .or_else(|| value.get("source"))
        .and_then(Value::as_str)
        .is_some_and(|source| source == "local_fallback")
}

fn classify_ai_error(message: &str) -> AiTaskError {
    let normalized = message.to_ascii_lowercase();
    let code = if normalized.contains("尚未配置")
        || normalized.contains("尚未启用")
        || message.contains("配置")
    {
        "configuration"
    } else {
        classify_llm_error_code(message)
    };
    AiTaskError {
        code: code.to_string(),
        message: message.to_string(),
        retryable: matches!(code, "rate_limited" | "timeout" | "network" | "protocol"),
    }
}

#[tauri::command]
fn get_app_health(core: State<'_, CoreApp>) -> CommandResult<AppHealth> {
    Ok(core.health())
}

#[tauri::command]
fn get_settings(core: State<'_, CoreApp>) -> CommandResult<Settings> {
    core.settings().map_err(format_error)
}

#[tauri::command]
fn save_settings(core: State<'_, CoreApp>, update: SettingsUpdate) -> CommandResult<Settings> {
    core.save_settings(update).map_err(format_error)
}

#[tauri::command]
fn list_model_profiles(core: State<'_, CoreApp>) -> CommandResult<Vec<ModelProfile>> {
    core.list_model_profiles().map_err(format_error)
}

#[tauri::command]
fn save_model_profile(core: State<'_, CoreApp>, input: ModelProfileInput) -> CommandResult<ModelProfile> {
    core.save_model_profile(input).map_err(format_error)
}

#[tauri::command]
fn delete_model_profile(core: State<'_, CoreApp>, id: String) -> CommandResult<Vec<ModelProfile>> {
    core.delete_model_profile(id).map_err(format_error)
}

#[tauri::command]
async fn analyze_code_stream(
    window: Window,
    core: State<'_, CoreApp>,
    requests: State<'_, AiRequestRegistry>,
    request_id: String,
    request: AnalysisRequest,
) -> CommandResult<()> {
    let emitter = AiEventEmitter::new(window, request_id, "single_review");
    let Some(token) = begin_ai_request(&requests, &emitter)? else {
        return Ok(());
    };
    let core = core.inner().clone();
    let future = core.analyze_code(request);
    complete_ai_task(&core, &requests, &emitter, token, future).await
}

#[tauri::command]
async fn analyze_project_stream(
    window: Window,
    core: State<'_, CoreApp>,
    requests: State<'_, AiRequestRegistry>,
    request_id: String,
    request: ProjectAnalyzeRequest,
) -> CommandResult<()> {
    let emitter = AiEventEmitter::new(window, request_id, "project_review");
    let Some(token) = begin_ai_request(&requests, &emitter)? else {
        return Ok(());
    };
    let chunk_emitter = emitter.clone();
    let core = core.inner().clone();
    let future = core.analyze_project_stream(request, move |chunk| {
        chunk_emitter.chunk(chunk)?;
        Ok(())
    });
    complete_ai_task(&core, &requests, &emitter, token, future).await
}

#[tauri::command]
async fn analyze_diff_stream(
    window: Window,
    core: State<'_, CoreApp>,
    requests: State<'_, AiRequestRegistry>,
    request_id: String,
    request: DiffAnalyzeRequest,
) -> CommandResult<()> {
    let emitter = AiEventEmitter::new(window, request_id, "diff_review");
    let Some(token) = begin_ai_request(&requests, &emitter)? else {
        return Ok(());
    };
    let chunk_emitter = emitter.clone();
    let core = core.inner().clone();
    let future = core.analyze_diff_stream(request, move |chunk| {
        chunk_emitter.chunk(chunk)?;
        Ok(())
    });
    complete_ai_task(&core, &requests, &emitter, token, future).await
}

#[tauri::command]
async fn send_chat_message_stream(
    window: Window,
    core: State<'_, CoreApp>,
    requests: State<'_, AiRequestRegistry>,
    request_id: String,
    request: ChatStreamRequest,
) -> CommandResult<()> {
    let emitter = AiEventEmitter::new(window, request_id, "chat");
    let Some(token) = begin_ai_request(&requests, &emitter)? else {
        return Ok(());
    };
    let chunk_emitter = emitter.clone();
    let core = core.inner().clone();
    let future = core.send_chat_message_stream(request, move |chunk| {
        chunk_emitter.chunk(chunk)?;
        Ok(())
    });
    complete_ai_task(&core, &requests, &emitter, token, future).await
}

#[tauri::command]
fn cancel_ai_request(
    requests: State<'_, AiRequestRegistry>,
    request_id: String,
) -> CommandResult<()> {
    requests.cancel(&request_id)?;
    Ok(())
}

#[tauri::command]
fn list_reports(
    core: State<'_, CoreApp>,
    query: Option<String>,
    report_type: Option<String>,
) -> CommandResult<Vec<ReportSummary>> {
    core.list_reports_filtered(query, report_type).map_err(format_error)
}

#[tauri::command]
fn get_report(core: State<'_, CoreApp>, id: String) -> CommandResult<ReportDetail> {
    core.get_report(id).map_err(format_error)
}

#[tauri::command]
fn rename_report(core: State<'_, CoreApp>, id: String, title: String) -> CommandResult<ReportDetail> {
    core.rename_report(id, title).map_err(format_error)
}

#[tauri::command]
fn delete_report(core: State<'_, CoreApp>, id: String) -> CommandResult<()> {
    core.delete_report(id).map_err(format_error)
}

#[tauri::command]
fn list_chat_sessions(
    core: State<'_, CoreApp>,
    query: Option<String>,
) -> CommandResult<Vec<ChatSessionSummary>> {
    core.list_chat_sessions(query).map_err(format_error)
}

#[tauri::command]
fn get_chat_session(core: State<'_, CoreApp>, id: String) -> CommandResult<ChatSessionDetail> {
    core.get_chat_session(id).map_err(format_error)
}

#[tauri::command]
fn delete_chat_session(core: State<'_, CoreApp>, id: String) -> CommandResult<()> {
    core.delete_chat_session(id).map_err(format_error)
}

#[tauri::command]
fn import_code_files(core: State<'_, CoreApp>) -> CommandResult<ProjectImportResult> {
    let Some(paths) = rfd::FileDialog::new()
        .add_filter("Code files", &["py", "js", "jsx", "ts", "tsx", "rs", "java", "cpp", "c", "h", "hpp", "cs", "go", "md", "txt", "json", "toml", "yaml", "yml", "html", "css"])
        .pick_files()
    else {
        return Err("No files selected.".to_string());
    };
    core.import_files_from_paths(paths).map_err(format_error)
}

#[tauri::command]
fn import_single_code_file(core: State<'_, CoreApp>) -> CommandResult<ProjectImportResult> {
    let Some(path) = rfd::FileDialog::new()
        .add_filter("Code files", &["py", "js", "jsx", "ts", "tsx", "rs", "java", "cpp", "c", "h", "hpp", "cs", "go", "md", "txt", "json", "toml", "yaml", "yml", "html", "css"])
        .pick_file()
    else {
        return Err("No file selected.".to_string());
    };
    core.import_files_from_paths(vec![path]).map_err(format_error)
}

#[tauri::command]
fn import_project_folder(core: State<'_, CoreApp>) -> CommandResult<ProjectImportResult> {
    let Some(path) = rfd::FileDialog::new().pick_folder() else {
        return Err("No folder selected.".to_string());
    };
    core.import_folder_from_path(path).map_err(format_error)
}

#[tauri::command]
fn import_workspace_folder(core: State<'_, CoreApp>) -> CommandResult<WorkspaceDetail> {
    let Some(path) = rfd::FileDialog::new().pick_folder() else {
        return Err("No folder selected.".to_string());
    };
    core.import_workspace_from_path(path).map_err(format_error)
}

#[tauri::command]
fn list_workspaces(
    core: State<'_, CoreApp>,
    query: Option<String>,
) -> CommandResult<Vec<WorkspaceSummary>> {
    core.list_workspaces(query).map_err(format_error)
}

#[tauri::command]
fn get_workspace(core: State<'_, CoreApp>, id: String) -> CommandResult<WorkspaceDetail> {
    core.get_workspace(id).map_err(format_error)
}

#[tauri::command]
fn rescan_workspace(core: State<'_, CoreApp>, id: String) -> CommandResult<WorkspaceDetail> {
    core.rescan_workspace(id).map_err(format_error)
}

#[tauri::command]
fn delete_workspace(core: State<'_, CoreApp>, id: String) -> CommandResult<()> {
    core.delete_workspace(id).map_err(format_error)
}

#[tauri::command]
async fn analyze_workspace_stream(
    window: Window,
    core: State<'_, CoreApp>,
    requests: State<'_, AiRequestRegistry>,
    request_id: String,
    workspace_id: String,
    use_llm: Option<bool>,
    retry_report_id: Option<String>,
) -> CommandResult<()> {
    let emitter = AiEventEmitter::new(window, request_id, "workspace_review");
    let Some(token) = begin_ai_request(&requests, &emitter)? else {
        return Ok(());
    };
    let chunk_emitter = emitter.clone();
    let core = core.inner().clone();
    let future = core.analyze_workspace_stream(
        workspace_id,
        use_llm,
        retry_report_id,
        move |chunk| {
            chunk_emitter.chunk(chunk)?;
            Ok(())
        },
    );
    complete_ai_task(&core, &requests, &emitter, token, future).await
}

#[tauri::command]
fn get_code_map(core: State<'_, CoreApp>, workspace_id: String) -> CommandResult<CodeMap> {
    core.get_code_map(workspace_id).map_err(format_error)
}

#[tauri::command]
fn list_findings(
    core: State<'_, CoreApp>,
    workspace_id: Option<String>,
    status: Option<String>,
    severity: Option<String>,
    report_id: Option<String>,
) -> CommandResult<Vec<Finding>> {
    core.list_findings(workspace_id, status, severity, report_id).map_err(format_error)
}

#[tauri::command]
fn update_finding_status(
    core: State<'_, CoreApp>,
    id: String,
    status: String,
) -> CommandResult<Finding> {
    core.update_finding_status(id, status).map_err(format_error)
}

#[tauri::command]
fn create_cards_from_findings(
    core: State<'_, CoreApp>,
    finding_ids: Vec<String>,
) -> CommandResult<Vec<LearningCard>> {
    core.create_cards_from_findings(finding_ids).map_err(format_error)
}

#[tauri::command]
fn list_learning_cards(
    core: State<'_, CoreApp>,
    workspace_id: Option<String>,
    status: Option<String>,
    tag: Option<String>,
) -> CommandResult<Vec<LearningCard>> {
    core.list_learning_cards(workspace_id, status, tag).map_err(format_error)
}

#[tauri::command]
fn update_learning_card(
    core: State<'_, CoreApp>,
    id: String,
    status: String,
) -> CommandResult<LearningCard> {
    core.update_learning_card(id, status).map_err(format_error)
}

#[tauri::command]
fn delete_learning_card(core: State<'_, CoreApp>, id: String) -> CommandResult<()> {
    core.delete_learning_card(id).map_err(format_error)
}

#[tauri::command]
fn create_learning_card(
    core: State<'_, CoreApp>,
    input: LearningCardCreate,
) -> CommandResult<LearningCard> {
    core.create_learning_card(input).map_err(format_error)
}

#[tauri::command]
async fn generate_card_material_stream(
    window: Window,
    core: State<'_, CoreApp>,
    requests: State<'_, AiRequestRegistry>,
    request_id: String,
    card_id: String,
    use_llm: Option<bool>,
) -> CommandResult<()> {
    let emitter = AiEventEmitter::new(window, request_id, "card_material");
    let Some(token) = begin_ai_request(&requests, &emitter)? else {
        return Ok(());
    };
    let core = core.inner().clone();
    let future = core.generate_card_material(card_id, use_llm);
    complete_ai_task(&core, &requests, &emitter, token, future).await
}

#[tauri::command]
fn list_card_materials(
    core: State<'_, CoreApp>,
    card_id: Option<String>,
) -> CommandResult<Vec<CardMaterial>> {
    core.list_card_materials(card_id).map_err(format_error)
}

#[tauri::command]
fn get_daily_summary(core: State<'_, CoreApp>, date: String) -> CommandResult<DailySummary> {
    core.get_daily_summary(date).map_err(format_error)
}

#[tauri::command]
fn generate_daily_log(core: State<'_, CoreApp>, date: String) -> CommandResult<DailyLog> {
    core.generate_daily_log(date).map_err(format_error)
}

#[tauri::command]
fn save_daily_log(
    core: State<'_, CoreApp>,
    date: String,
    title: String,
    content: String,
) -> CommandResult<DailyLog> {
    core.save_daily_log(date, title, content).map_err(format_error)
}

#[tauri::command]
fn list_daily_logs(core: State<'_, CoreApp>) -> CommandResult<Vec<DailyLog>> {
    core.list_daily_logs().map_err(format_error)
}

#[tauri::command]
fn export_daily_log_markdown(core: State<'_, CoreApp>, date: String) -> CommandResult<String> {
    core.export_daily_log_markdown(date).map_err(format_error)
}

#[tauri::command]
fn get_learning_calendar(
    core: State<'_, CoreApp>,
    month: String,
) -> CommandResult<Vec<LearningCalendarItem>> {
    core.get_learning_calendar(month).map_err(format_error)
}

#[tauri::command]
fn get_learning_center(
    core: State<'_, CoreApp>,
    date: String,
    month: String,
) -> CommandResult<LearningCenterData> {
    core.get_learning_center(date, month).map_err(format_error)
}

#[tauri::command]
fn generate_project_guide(
    core: State<'_, CoreApp>,
    workspace_id: String,
) -> CommandResult<ProjectGuide> {
    core.generate_project_guide(workspace_id).map_err(format_error)
}

#[tauri::command]
fn get_project_guide(core: State<'_, CoreApp>, workspace_id: String) -> CommandResult<ProjectGuide> {
    core.get_project_guide(workspace_id).map_err(format_error)
}

#[tauri::command]
fn create_agent_plan(
    core: State<'_, CoreApp>,
    request: AgentPlanRequest,
) -> CommandResult<AgentTask> {
    core.create_agent_plan(request).map_err(format_error)
}

#[tauri::command]
fn list_agent_tasks(core: State<'_, CoreApp>) -> CommandResult<Vec<AgentTask>> {
    core.list_agent_tasks().map_err(format_error)
}

#[tauri::command]
fn get_agent_task(core: State<'_, CoreApp>, id: String) -> CommandResult<AgentTask> {
    core.get_agent_task(id).map_err(format_error)
}

#[tauri::command]
fn delete_agent_task(core: State<'_, CoreApp>, id: String) -> CommandResult<()> {
    core.delete_agent_task(id).map_err(format_error)
}

#[tauri::command]
fn apply_agent_plan(
    core: State<'_, CoreApp>,
    request: AgentApplyRequest,
) -> CommandResult<AgentApplyResult> {
    core.apply_agent_plan(request).map_err(format_error)
}

#[tauri::command]
fn rollback_agent_operation(
    core: State<'_, CoreApp>,
    task_id: String,
    operation_id: String,
) -> CommandResult<AgentTask> {
    core.rollback_agent_operation(task_id, operation_id).map_err(format_error)
}

#[tauri::command]
fn get_workspace_bridge_status(
    core: State<'_, CoreApp>,
    workspace_id: Option<String>,
) -> CommandResult<WorkspaceBridgeStatus> {
    core.get_workspace_bridge_status(workspace_id).map_err(format_error)
}

#[tauri::command]
fn update_workspace_bridge_selection(
    core: State<'_, CoreApp>,
    workspace_id: String,
    selected_file_paths: Vec<String>,
) -> CommandResult<WorkspaceBridgeStatus> {
    core.update_workspace_bridge_selection(workspace_id, selected_file_paths)
        .map_err(format_error)
}

#[tauri::command]
fn export_workspace_bridge_manifest(
    core: State<'_, CoreApp>,
    workspace_id: Option<String>,
) -> CommandResult<WorkspaceBridgeManifestResult> {
    core.export_workspace_bridge_manifest(workspace_id)
        .map_err(format_error)
}

#[tauri::command]
fn list_workspace_bridge_inbox(
    core: State<'_, CoreApp>,
) -> CommandResult<Vec<WorkspaceBridgeInboxRequest>> {
    core.list_workspace_bridge_inbox().map_err(format_error)
}

#[tauri::command]
fn create_agent_plan_from_bridge_inbox(
    core: State<'_, CoreApp>,
    request_id: String,
) -> CommandResult<WorkspaceBridgeInboxApplyResult> {
    core.create_agent_plan_from_bridge_inbox(request_id)
        .map_err(format_error)
}

#[tauri::command]
fn generate_card_candidates_from_report(
    core: State<'_, CoreApp>,
    report_id: String,
) -> CommandResult<Vec<LearningCardCandidate>> {
    core.generate_card_candidates_from_report(report_id)
        .map_err(format_error)
}

#[tauri::command]
fn list_learning_card_candidates(
    core: State<'_, CoreApp>,
    status: Option<String>,
    source_id: Option<String>,
) -> CommandResult<Vec<LearningCardCandidate>> {
    core.list_learning_card_candidates(status, source_id)
        .map_err(format_error)
}

#[tauri::command]
fn approve_learning_card_candidates(
    core: State<'_, CoreApp>,
    candidate_ids: Vec<String>,
) -> CommandResult<Vec<LearningCard>> {
    core.approve_learning_card_candidates(candidate_ids)
        .map_err(format_error)
}

#[tauri::command]
fn reject_learning_card_candidate(core: State<'_, CoreApp>, id: String) -> CommandResult<()> {
    core.reject_learning_card_candidate(id).map_err(format_error)
}

#[tauri::command]
fn record_activity_event(
    core: State<'_, CoreApp>,
    event_type: String,
    title: String,
    detail: String,
    entity_kind: Option<String>,
    entity_id: Option<String>,
) -> CommandResult<ActivityEvent> {
    core.record_activity_event(event_type, title, detail, entity_kind, entity_id)
        .map_err(format_error)
}

#[tauri::command]
fn get_activity_summary(core: State<'_, CoreApp>) -> CommandResult<ActivitySummary> {
    core.get_activity_summary().map_err(format_error)
}

#[tauri::command]
fn get_activity_galaxy_data(core: State<'_, CoreApp>) -> CommandResult<ActivityGalaxyData> {
    core.get_activity_galaxy_data().map_err(format_error)
}

#[tauri::command]
fn get_activity_constellation(core: State<'_, CoreApp>, limit: Option<usize>) -> CommandResult<ActivityConstellationData> {
    core.get_activity_constellation(limit).map_err(format_error)
}

#[tauri::command]
fn get_traceability_snapshot(
    core: State<'_, CoreApp>,
    scope_kind: Option<String>,
    scope_id: Option<String>,
) -> CommandResult<TraceabilitySnapshot> {
    core.get_traceability_snapshot(scope_kind, scope_id).map_err(format_error)
}

#[tauri::command]
async fn test_llm_connection(
    core: State<'_, CoreApp>,
    request: LlmTestRequest,
) -> CommandResult<LlmTestResult> {
    core.inner()
        .clone()
        .test_llm_connection(request)
        .await
        .map_err(format_error)
}

#[tauri::command]
fn open_storage_dir(core: State<'_, CoreApp>) -> CommandResult<()> {
    open_path(core.storage_dir_path()).map_err(format_error)
}

#[tauri::command]
fn open_logs_dir(core: State<'_, CoreApp>) -> CommandResult<()> {
    open_path(core.logs_dir_path()).map_err(format_error)
}

#[tauri::command]
fn export_report_markdown(core: State<'_, CoreApp>, id: String) -> CommandResult<String> {
    core.export_report_markdown(id).map_err(format_error)
}

#[tauri::command]
fn export_report_html(core: State<'_, CoreApp>, id: String) -> CommandResult<String> {
    core.export_report_html(id).map_err(format_error)
}

#[tauri::command]
fn export_agent_task_markdown(core: State<'_, CoreApp>, id: String) -> CommandResult<String> {
    core.export_agent_task_markdown(id).map_err(format_error)
}

#[tauri::command]
fn export_learning_cards_markdown(
    core: State<'_, CoreApp>,
    workspace_id: Option<String>,
    status: Option<String>,
    tag: Option<String>,
) -> CommandResult<String> {
    core.export_learning_cards_markdown(workspace_id, status, tag).map_err(format_error)
}

#[tauri::command]
fn copy_report_text(core: State<'_, CoreApp>, id: String) -> CommandResult<()> {
    let text = core.report_text_for_clipboard(id).map_err(format_error)?;
    copy_to_clipboard(&core, &text).map_err(format_error)
}

#[tauri::command]
fn export_product_archive(core: State<'_, CoreApp>) -> CommandResult<ProductArchiveResult> {
    core.export_product_archive().map_err(format_error)
}

#[tauri::command]
fn import_product_archive(core: State<'_, CoreApp>) -> CommandResult<ProductArchiveImportResult> {
    let Some(path) = rfd::FileDialog::new()
        .add_filter("CodeLens archive manifest", &["json"])
        .set_title("选择 CodeLens Pro Next 产品档案 manifest.json")
        .pick_file()
    else {
        return Err("未选择产品档案 manifest.json。".to_string());
    };
    core.import_product_archive_from_path(path).map_err(format_error)
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let app_home = resolve_app_home()?;
            let core = CoreApp::initialize(app_home)?;
            app.manage(core);
            app.manage(AiRequestRegistry::default());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_app_health,
            get_settings,
            save_settings,
            list_model_profiles,
            save_model_profile,
            delete_model_profile,
            analyze_code_stream,
            analyze_project_stream,
            analyze_diff_stream,
            send_chat_message_stream,
            cancel_ai_request,
            list_reports,
            get_report,
            rename_report,
            delete_report,
            list_chat_sessions,
            get_chat_session,
            delete_chat_session,
            import_code_files,
            import_single_code_file,
            import_project_folder,
            import_workspace_folder,
            list_workspaces,
            get_workspace,
            rescan_workspace,
            delete_workspace,
            analyze_workspace_stream,
            get_code_map,
            list_findings,
            update_finding_status,
            create_cards_from_findings,
            list_learning_cards,
            update_learning_card,
            delete_learning_card,
            create_learning_card,
            generate_card_material_stream,
            list_card_materials,
            get_daily_summary,
            generate_daily_log,
            save_daily_log,
            list_daily_logs,
            export_daily_log_markdown,
            get_learning_calendar,
            get_learning_center,
            generate_project_guide,
            get_project_guide,
            create_agent_plan,
            list_agent_tasks,
            get_agent_task,
            delete_agent_task,
            apply_agent_plan,
            rollback_agent_operation,
            get_workspace_bridge_status,
            update_workspace_bridge_selection,
            export_workspace_bridge_manifest,
            list_workspace_bridge_inbox,
            create_agent_plan_from_bridge_inbox,
            generate_card_candidates_from_report,
            list_learning_card_candidates,
            approve_learning_card_candidates,
            reject_learning_card_candidate,
            record_activity_event,
            get_activity_summary,
            get_activity_galaxy_data,
            get_activity_constellation,
            get_traceability_snapshot,
            test_llm_connection,
            open_storage_dir,
            open_logs_dir,
            export_report_markdown,
            export_report_html,
            export_agent_task_markdown,
            export_learning_cards_markdown,
            copy_report_text,
            export_product_archive,
            import_product_archive
        ])
        .run(tauri::generate_context!())
        .expect("failed to run CodeLens Pro Next");
}

fn resolve_app_home() -> anyhow::Result<PathBuf> {
    if let Ok(value) = env::var("CODELENS_NEXT_HOME") {
        let trimmed = value.trim();
        if !trimmed.is_empty() {
            return Ok(PathBuf::from(trimmed));
        }
    }

    let exe = env::current_exe()?;
    Ok(exe
        .parent()
        .map(PathBuf::from)
        .unwrap_or_else(|| env::current_dir().unwrap_or_else(|_| PathBuf::from("."))))
}

fn format_error(error: anyhow::Error) -> String {
    error.to_string()
}

fn open_path(path: PathBuf) -> anyhow::Result<()> {
    #[cfg(windows)]
    {
        Command::new("explorer")
            .arg(path)
            .creation_flags(0x08000000)
            .spawn()?;
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open").arg(path).spawn()?;
        return Ok(());
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        Command::new("xdg-open").arg(path).spawn()?;
        return Ok(());
    }
}

fn copy_to_clipboard(core: &CoreApp, text: &str) -> anyhow::Result<()> {
    let temp_path = core.clipboard_temp_path();
    fs::write(&temp_path, text)?;

    #[cfg(windows)]
    let status = Command::new("powershell")
        .args([
            "-NoProfile",
            "-Command",
            "Get-Content -LiteralPath $args[0] -Raw -Encoding UTF8 | Set-Clipboard",
        ])
        .arg(&temp_path)
        .creation_flags(0x08000000)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()?;

    #[cfg(not(windows))]
    let status = {
        let mut child = Command::new("sh")
            .arg("-c")
            .arg("cat >/dev/null")
            .stdin(Stdio::piped())
            .spawn()?;
        if let Some(stdin) = child.stdin.as_mut() {
            stdin.write_all(text.as_bytes())?;
        }
        child.wait()?
    };

    fs::remove_file(temp_path).ok();
    if status.success() {
        core.log_event("clipboard", "report copied to clipboard");
        Ok(())
    } else {
        anyhow::bail!("failed to copy report to clipboard")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn request_registry_rejects_duplicates_and_releases_after_remove() {
        let registry = AiRequestRegistry::default();
        let token = registry.register("request-1").expect("first registration");
        assert!(registry.register("request-1").is_err());
        assert!(registry.cancel("request-1").expect("cancel request"));
        assert!(token.is_cancelled());

        registry.remove("request-1");
        assert!(registry.register("request-1").is_ok());
        assert!(!registry.cancel("missing").expect("missing request is a no-op"));
    }

    #[test]
    fn fallback_detection_supports_reports_and_card_materials() {
        assert!(is_fallback_result(&json!({
            "report": { "analysis_source": "local_fallback" }
        })));
        assert!(is_fallback_result(&json!({ "source": "local_fallback" })));
        assert!(!is_fallback_result(&json!({
            "report": { "analysis_source": "llm" }
        })));
    }

    #[test]
    fn errors_have_stable_codes_and_retry_policy() {
        let configuration = classify_ai_error("设置中尚未启用 LLM。");
        assert_eq!(configuration.code, "configuration");
        assert!(!configuration.retryable);

        let rate_limit = classify_ai_error("LLM returned HTTP 429");
        assert_eq!(rate_limit.code, "rate_limited");
        assert!(rate_limit.retryable);

        let protocol = classify_ai_error("protocol: invalid SSE payload");
        assert_eq!(protocol.code, "protocol");
        assert!(protocol.retryable);

        let service_error = classify_ai_error("LLM returned HTTP 500");
        assert_eq!(service_error.code, "network");
        assert!(service_error.retryable);
    }
}
