#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::env;
use std::fs;
use std::path::PathBuf;
use std::process::{Command, Stdio};

use codelens_next_core::{
    ActivityConstellationData, ActivityEvent, ActivityGalaxyData, ActivitySummary,
    AgentApplyRequest, AgentApplyResult, AgentPlanRequest, AgentTask, AnalysisRequest,
    AnalysisResponse, AppHealth, CardMaterial, ChatSessionDetail, ChatSessionSummary,
    ChatStreamRequest, CodeMap, CoreApp, DailyLog, DailySummary, DiffAnalyzeRequest, Finding,
    LearningCalendarItem, LearningCard,
    LearningCardCandidate, LearningCardCreate, LearningCenterData, LlmTestResult,
    ModelProfile, ModelProfileInput, ProductArchiveImportResult, ProductArchiveResult, ProjectAnalyzeRequest, ProjectGuide,
    ProjectImportResult, ReportDetail, ReportSummary, Settings, SettingsUpdate,
    TraceabilitySnapshot, WorkspaceBridgeInboxApplyResult, WorkspaceBridgeInboxRequest,
    WorkspaceBridgeManifestResult, WorkspaceBridgeStatus, WorkspaceDetail, WorkspaceSummary,
};
use serde::Serialize;
use tauri::{Emitter, Manager, State, Window};

#[cfg(not(windows))]
use std::io::Write;
#[cfg(windows)]
use std::os::windows::process::CommandExt;

type CommandResult<T> = Result<T, String>;

#[derive(Debug, Clone, Serialize)]
struct StreamChunk {
    chunk: String,
}

#[derive(Debug, Clone, Serialize)]
struct StreamDone<T> {
    result: T,
}

#[derive(Debug, Clone, Serialize)]
struct StreamError {
    message: String,
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
async fn analyze_code(
    core: State<'_, CoreApp>,
    request: AnalysisRequest,
) -> CommandResult<AnalysisResponse> {
    core.inner()
        .clone()
        .analyze_code(request)
        .await
        .map_err(format_error)
}

#[tauri::command]
async fn analyze_project_stream(
    window: Window,
    core: State<'_, CoreApp>,
    request: ProjectAnalyzeRequest,
) -> CommandResult<()> {
    let emit_window = window.clone();
    let result = core
        .inner()
        .clone()
        .analyze_project_stream(request, move |chunk| {
            emit_window.emit("analysis:chunk", StreamChunk { chunk: chunk.to_string() })?;
            Ok(())
        })
        .await;
    emit_stream_result(&window, "analysis", result)
}

#[tauri::command]
async fn analyze_diff_stream(
    window: Window,
    core: State<'_, CoreApp>,
    request: DiffAnalyzeRequest,
) -> CommandResult<()> {
    let emit_window = window.clone();
    let result = core
        .inner()
        .clone()
        .analyze_diff_stream(request, move |chunk| {
            emit_window.emit("diff:chunk", StreamChunk { chunk: chunk.to_string() })?;
            Ok(())
        })
        .await;
    emit_stream_result(&window, "diff", result)
}

#[tauri::command]
async fn send_chat_message_stream(
    window: Window,
    core: State<'_, CoreApp>,
    request: ChatStreamRequest,
) -> CommandResult<()> {
    let emit_window = window.clone();
    let result = core
        .inner()
        .clone()
        .send_chat_message_stream(request, move |chunk| {
            emit_window.emit("chat:chunk", StreamChunk { chunk: chunk.to_string() })?;
            Ok(())
        })
        .await;
    emit_stream_result(&window, "chat", result)
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
    workspace_id: String,
    use_llm: Option<bool>,
) -> CommandResult<()> {
    let emit_window = window.clone();
    let result = core
        .inner()
        .clone()
        .analyze_workspace_stream(workspace_id, use_llm, move |chunk| {
            emit_window.emit("workspace:progress", StreamChunk { chunk: chunk.to_string() })?;
            Ok(())
        })
        .await;
    emit_stream_result(&window, "workspace", result)
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
async fn generate_card_material(
    core: State<'_, CoreApp>,
    card_id: String,
    use_llm: Option<bool>,
) -> CommandResult<CardMaterial> {
    core.inner()
        .clone()
        .generate_card_material(card_id, use_llm)
        .await
        .map_err(format_error)
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
    api_key: Option<String>,
) -> CommandResult<LlmTestResult> {
    core.inner()
        .clone()
        .test_llm_connection(api_key)
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
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_app_health,
            get_settings,
            save_settings,
            list_model_profiles,
            save_model_profile,
            delete_model_profile,
            analyze_code,
            analyze_project_stream,
            analyze_diff_stream,
            send_chat_message_stream,
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
            generate_card_material,
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

fn emit_stream_result<T>(window: &Window, prefix: &str, result: anyhow::Result<T>) -> CommandResult<()>
where
    T: Serialize + Clone,
{
    match result {
        Ok(value) => {
            window
                .emit(&format!("{prefix}:done"), StreamDone { result: value })
                .map_err(|err| err.to_string())?;
            Ok(())
        }
        Err(err) => {
            let message = err.to_string();
            let _ = window.emit(&format!("{prefix}:error"), StreamError { message: message.clone() });
            Err(message)
        }
    }
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
