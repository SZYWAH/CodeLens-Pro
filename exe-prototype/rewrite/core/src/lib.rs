mod analysis;
mod diff;
mod llm;
mod migration;
mod models;
mod project;
mod storage;
mod workspace;

use std::collections::{BTreeMap, BTreeSet};
use std::collections::hash_map::DefaultHasher;
use std::fs::{self, OpenOptions};
use std::hash::{Hash, Hasher};
use std::io::Write;
use std::path::{Path, PathBuf};

use anyhow::{anyhow, Context};
use chrono::Utc;
use serde::{de::DeserializeOwned, Deserialize};
use serde_json::{json, Value};
use uuid::Uuid;

pub use models::{
    ActivityConstellationData, ActivityDay, ActivityEvent, ActivityGalaxyData, ActivityLink,
    ActivityNode, ActivityStarItem, ActivityStarRoute, ActivitySummary, AgentApplyRequest,
    AgentApplyResult, AgentFileOperation, AgentPlanRequest, AgentStep, AgentTask, AnalysisRequest,
    AnalysisResponse, AppHealth, CardMaterial, ChatMessageItem, ChatSessionDetail,
    ChatSessionSummary, ChatStreamRequest, CodeMap, CodeSymbol, DailyLog, DailySummary,
    DiffAnalyzeRequest, FileDependency, Finding, LanguageStat, LearningCalendarItem, LearningCard,
    LearningCardCandidate, LearningCardCreate, LearningCenterData, LegacyMigrationResult,
    LegacyMigrationStatus, LlmTestRequest, LlmTestResult,
    ModelProfile, ModelProfileInput, ProductArchiveImportResult, ProductArchiveResult, ProjectAnalyzeRequest,
    ProjectFileInput, ProjectGuide, ProjectGuideItem, ProjectImportResult, ReportDetail,
    ReportFile, ReportMetrics, ReportSummary, Settings, SettingsUpdate, TraceabilityCounts,
    TraceabilityLink, TraceabilityNode, TraceabilitySnapshot,
    WorkspaceBridgeFile, WorkspaceBridgeInboxApplyResult, WorkspaceBridgeInboxRequest,
    WorkspaceBridgeManifestResult, WorkspaceBridgeStatus, WorkspaceDetail, WorkspaceFile,
    WorkspaceFileHotspot, WorkspaceSummary,
};

pub use llm::{classify_llm_error_code, classify_llm_error_message};
pub use migration::{legacy_migration_state, migrate_legacy_data};

#[derive(Clone)]
pub struct CoreApp {
    app_home: PathBuf,
    storage_dir: PathBuf,
    logs_dir: PathBuf,
    database_path: PathBuf,
}

#[derive(Debug, Clone, Deserialize)]
struct WorkspaceBridgeInboxPayload {
    id: Option<String>,
    source: Option<String>,
    workspace_id: Option<String>,
    context_kind: Option<String>,
    context_id: Option<String>,
    goal: Option<String>,
    selected_file_paths: Option<Vec<String>>,
    created_at: Option<String>,
}

impl CoreApp {
    pub fn initialize(app_home: impl AsRef<Path>) -> anyhow::Result<Self> {
        let app_home = app_home.as_ref().to_path_buf();
        let storage_dir = app_home.join("storage");
        let logs_dir = app_home.join("logs");
        fs::create_dir_all(&storage_dir)
            .with_context(|| format!("failed to create storage dir {}", storage_dir.display()))?;
        fs::create_dir_all(&logs_dir)
            .with_context(|| format!("failed to create logs dir {}", logs_dir.display()))?;

        let database_path = storage_dir.join("codelens-next.sqlite");
        let app = Self {
            app_home,
            storage_dir,
            logs_dir,
            database_path,
        };

        app.log_event("startup", "CodeLens Pro Next starting");
        app.log_event("startup", &format!("app_home={}", app.app_home.display()));
        match storage::init_database(&app.database_path) {
            Ok(()) => app.log_event("sqlite", "database initialized and migrated"),
            Err(err) => app.log_event("sqlite", &format!("database initialization failed: {err}")),
        }

        Ok(app)
    }

    pub fn health(&self) -> AppHealth {
        let database_result = storage::check_database(&self.database_path);
        let settings = self.settings().unwrap_or_default();

        AppHealth {
            version: env!("CARGO_PKG_VERSION").to_string(),
            app_home: self.app_home.display().to_string(),
            storage_dir: self.storage_dir.display().to_string(),
            logs_dir: self.logs_dir.display().to_string(),
            database_path: self.database_path.display().to_string(),
            database_ok: database_result.is_ok(),
            database_message: database_result
                .map(|_| "SQLite ready".to_string())
                .unwrap_or_else(|err| format!("SQLite unavailable. See logs for details: {err}")),
            llm_enabled: settings.enable_llm,
            llm_configured: settings.llm_state == "configured",
        }
    }

    pub fn settings(&self) -> anyhow::Result<Settings> {
        storage::load_public_settings(&self.database_path)
    }

    pub fn save_settings(&self, update: SettingsUpdate) -> anyhow::Result<Settings> {
        self.log_event(
            "settings",
            &format!(
                "saving settings enable_llm={} api_base={} model={} api_key_changed={} api_key_clear={}",
                update.enable_llm,
                update.api_base.trim(),
                update.model.trim(),
                update
                    .api_key
                    .as_ref()
                    .map(|value| !value.trim().is_empty())
                    .unwrap_or(false),
                update.clear_api_key
            ),
        );
        storage::save_settings(&self.database_path, update)?;
        self.settings()
    }

    pub fn list_model_profiles(&self) -> anyhow::Result<Vec<ModelProfile>> {
        storage::list_model_profiles(&self.database_path)
    }

    pub fn save_model_profile(&self, input: ModelProfileInput) -> anyhow::Result<ModelProfile> {
        let profile = storage::save_model_profile(&self.database_path, input)?;
        self.record_activity("settings", "保存模型档案", &profile.name, Some("model_profile"), Some(&profile.id));
        Ok(profile)
    }

    pub fn delete_model_profile(&self, id: String) -> anyhow::Result<Vec<ModelProfile>> {
        let profiles = storage::delete_model_profile(&self.database_path, &id)?;
        self.log_event("settings", &format!("model profile deleted id={id}"));
        Ok(profiles)
    }

    pub async fn analyze_code(
        &self,
        request: AnalysisRequest,
    ) -> anyhow::Result<AnalysisResponse> {
        self.log_event(
            "analysis",
            &format!(
                "single analysis requested language={:?} title_present={} code_lines={}",
                request.language,
                request
                    .title
                    .as_ref()
                    .map(|value| !value.trim().is_empty())
                    .unwrap_or(false),
                request.code.lines().count()
            ),
        );
        let settings = self.settings()?;
        let api_key = storage::load_api_key(&self.database_path)?;
        let mut local_report = analysis::analyze_locally(&request);
        let mut warnings = Vec::new();

        let should_try_llm = request.use_llm.unwrap_or(true) && settings.llm_state == "configured";
        if should_try_llm {
            match api_key.as_deref() {
                Some(key) if !key.trim().is_empty() => {
                    match llm::generate_report(&settings, key, &request, &local_report).await {
                        Ok(ai_report) => {
                            local_report.full_report = ai_report;
                            local_report.analysis_source = "llm".to_string();
                        }
                        Err(err) => {
                            self.log_event("llm", &format!("LLM failed, using local fallback: {err}"));
                            warnings.push(format!("LLM 不可用，已使用本地分析兜底：{err}"));
                            local_report.analysis_source = "local_fallback".to_string();
                        }
                    }
                }
                _ => {
                    warnings.push("LLM 配置已失效；本次直接使用本地分析。".to_string());
                }
            }
        } else if request.use_llm.unwrap_or(true) && settings.llm_state == "missing_key" {
            warnings.push("尚未配置 API Key；本次直接使用本地分析。".to_string());
        }

        self.apply_retry_report_id(&mut local_report, request.retry_report_id.as_deref())?;
        local_report.title = storage::unique_report_title(
            &self.database_path,
            &local_report.title,
            request.retry_report_id.as_deref(),
        )?;

        storage::save_report(&self.database_path, &local_report)?;
        self.record_activity("report", "生成代码分析报告", &local_report.title, Some("report"), Some(&local_report.id));
        self.log_event(
            "analysis",
            &format!(
                "report saved id={} source={}",
                local_report.id, local_report.analysis_source
            ),
        );

        Ok(AnalysisResponse {
            report: local_report,
            warnings,
        })
    }

    pub async fn analyze_project_stream<F>(
        &self,
        request: ProjectAnalyzeRequest,
        on_chunk: F,
    ) -> anyhow::Result<AnalysisResponse>
    where
        F: FnMut(&str) -> anyhow::Result<()> + Send,
    {
        if request.files.is_empty() {
            return Err(anyhow!("没有提供可分析的项目文件。"));
        }
        self.validate_project_retry_scope(
            request.retry_report_id.as_deref(),
            request.workspace_id.as_deref(),
        )?;
        self.log_event(
            "analysis",
            &format!(
                "project analysis requested project={} files={}",
                request.project_name,
                request.files.len()
            ),
        );

        let mut report = self.build_project_report(&request)?;
        let warnings = self
            .try_stream_llm_report(
                request.use_llm.unwrap_or(true),
                "Project analysis",
                &project_prompt(&request, &report),
                &mut report,
                on_chunk,
            )
            .await?;
        self.apply_retry_report_id(&mut report, request.retry_report_id.as_deref())?;
        storage::save_report(&self.database_path, &report)?;
        self.record_activity("report", "生成项目分析报告", &report.title, Some("report"), Some(&report.id));
        Ok(AnalysisResponse { report, warnings })
    }

    pub async fn analyze_diff_stream<F>(
        &self,
        request: DiffAnalyzeRequest,
        on_chunk: F,
    ) -> anyhow::Result<AnalysisResponse>
    where
        F: FnMut(&str) -> anyhow::Result<()> + Send,
    {
        if request.before_code.trim().is_empty() || request.after_code.trim().is_empty() {
            return Err(anyhow!("请同时提供旧版本和新版本代码。"));
        }
        self.log_event(
            "diff",
            &format!(
                "diff analysis requested before={} after={}",
                request.before_label, request.after_label
            ),
        );

        let mut report = diff::analyze_diff_locally(&request);
        let warnings = self
            .try_stream_llm_report(
                request.use_llm.unwrap_or(true),
                "Diff analysis",
                &diff_prompt(&request, &report),
                &mut report,
                on_chunk,
            )
            .await?;
        self.apply_retry_report_id(&mut report, request.retry_report_id.as_deref())?;
        storage::save_report(&self.database_path, &report)?;
        self.record_activity("report", "生成代码对比报告", &report.title, Some("report"), Some(&report.id));
        Ok(AnalysisResponse { report, warnings })
    }

    pub async fn send_chat_message_stream<F>(
        &self,
        request: ChatStreamRequest,
        mut on_chunk: F,
    ) -> anyhow::Result<ChatSessionDetail>
    where
        F: FnMut(&str) -> anyhow::Result<()> + Send,
    {
        let message = request.message.trim();
        if message.is_empty() {
            return Err(anyhow!("对话消息不能为空。"));
        }
        let settings = self.settings()?;
        let api_key = storage::load_api_key(&self.database_path)?;
        let Some(key) = api_key.filter(|value| !value.trim().is_empty()) else {
            return Err(anyhow!("尚未配置 LLM API Key。"));
        };
        if !settings.enable_llm {
            return Err(anyhow!("设置中尚未启用 LLM。"));
        }

        let existing_session = match request.session_id.as_deref() {
            Some(id) => storage::find_chat_session(&self.database_path, id)?,
            None => None,
        };
        let history = existing_session
            .as_ref()
            .map(|session| session.messages.clone())
            .unwrap_or_default()
            .into_iter()
            .filter(|item| item.role == "user" || item.role == "assistant")
            .map(|item| llm::ChatMessage {
                role: item.role,
                content: item.content,
            })
            .collect::<Vec<_>>();
        let context = self.chat_context(&request);
        let messages = llm::chat_messages(&history, message, context.as_deref());
        let assistant_text = llm::stream_chat(&settings, &key, &messages, |chunk| {
            on_chunk(chunk)?;
            Ok(())
        })
        .await?;
        let title = existing_session
            .as_ref()
            .map(|session| session.title.clone())
            .unwrap_or_else(|| chat_title(message));
        let context_report_id = request
            .context_report_id
            .clone()
            .or_else(|| existing_session.as_ref().and_then(|session| session.context_report_id.clone()));
        let session_id = storage::save_chat_exchange(
            &self.database_path,
            request.session_id.clone(),
            title,
            context_report_id,
            message,
            &assistant_text,
        )?;
        self.record_activity(
            "chat",
            "AI 对话回复",
            "对话已完成",
            Some("chat_session"),
            Some(&session_id),
        );
        self.log_event("chat", &format!("chat message saved session_id={session_id}"));
        storage::get_chat_session(&self.database_path, &session_id)
    }

    pub async fn test_llm_connection(&self, request: LlmTestRequest) -> anyhow::Result<LlmTestResult> {
        let key = match request.api_key {
            Some(value) => (!value.trim().is_empty()).then_some(value),
            None => storage::load_api_key(&self.database_path)?,
        };
        let settings = Settings {
            enable_llm: true,
            api_base: request.api_base.trim().to_string(),
            model: request.model.trim().to_string(),
            api_key_set: key.is_some(),
            llm_state: if key.is_some() { "configured" } else { "missing_key" }.to_string(),
        };
        Ok(llm::test_connection(&settings, key).await)
    }

    pub fn list_reports_filtered(
        &self,
        query: Option<String>,
        report_type: Option<String>,
    ) -> anyhow::Result<Vec<ReportSummary>> {
        storage::list_reports_filtered(&self.database_path, query, report_type)
    }

    pub fn list_reports(&self, query: Option<String>) -> anyhow::Result<Vec<ReportSummary>> {
        storage::list_reports(&self.database_path, query)
    }

    pub fn get_report(&self, id: String) -> anyhow::Result<ReportDetail> {
        storage::get_report(&self.database_path, &id)
    }

    pub fn rename_report(&self, id: String, title: String) -> anyhow::Result<ReportDetail> {
        let report = storage::rename_report(&self.database_path, &id, &title)?;
        self.log_event("reports", &format!("report renamed id={id}"));
        Ok(report)
    }

    pub fn delete_report(&self, id: String) -> anyhow::Result<()> {
        storage::delete_report(&self.database_path, &id)?;
        self.log_event("reports", &format!("report deleted id={id}"));
        Ok(())
    }

    pub fn list_chat_sessions(
        &self,
        query: Option<String>,
    ) -> anyhow::Result<Vec<ChatSessionSummary>> {
        storage::list_chat_sessions(&self.database_path, query)
    }

    pub fn get_chat_session(&self, id: String) -> anyhow::Result<ChatSessionDetail> {
        storage::get_chat_session(&self.database_path, &id)
    }

    pub fn delete_chat_session(&self, id: String) -> anyhow::Result<()> {
        storage::delete_chat_session(&self.database_path, &id)?;
        self.log_event("chat", &format!("chat session deleted id={id}"));
        Ok(())
    }

    pub fn import_files_from_paths(&self, paths: Vec<PathBuf>) -> anyhow::Result<ProjectImportResult> {
        let result = project::import_files(&paths)?;
        self.log_event("import", &format!("imported {} file(s)", result.files.len()));
        Ok(result)
    }

    pub fn import_folder_from_path(&self, path: PathBuf) -> anyhow::Result<ProjectImportResult> {
        let result = project::import_folder(&path)?;
        self.log_event(
            "import",
            &format!(
                "imported folder {} with {} file(s)",
                path.display(),
                result.files.len()
            ),
        );
        Ok(result)
    }

    pub fn import_workspace_from_path(&self, path: PathBuf) -> anyhow::Result<WorkspaceDetail> {
        let scan = workspace::scan_folder(&path, None)?;
        let detail = storage::save_workspace_scan(&self.database_path, &scan)?;
        self.record_activity("workspace", "导入工作区", &detail.summary.name, Some("workspace"), Some(&detail.summary.id));
        self.log_event(
            "workspace",
            &format!(
                "workspace imported id={} files={}",
                detail.summary.id, detail.summary.file_count
            ),
        );
        Ok(detail)
    }

    pub fn rescan_workspace(&self, id: String) -> anyhow::Result<WorkspaceDetail> {
        let current = storage::get_workspace(&self.database_path, &id)?;
        let scan = workspace::scan_folder(Path::new(&current.summary.root_path), Some(&id))?;
        let detail = storage::save_workspace_scan(&self.database_path, &scan)?;
        self.record_activity("workspace", "重新扫描工作区", &detail.summary.name, Some("workspace"), Some(&detail.summary.id));
        self.log_event(
            "workspace",
            &format!(
                "workspace rescanned id={} files={}",
                detail.summary.id, detail.summary.file_count
            ),
        );
        Ok(detail)
    }

    pub fn list_workspaces(&self, query: Option<String>) -> anyhow::Result<Vec<WorkspaceSummary>> {
        storage::list_workspaces(&self.database_path, query)
    }

    pub fn get_workspace(&self, id: String) -> anyhow::Result<WorkspaceDetail> {
        storage::get_workspace(&self.database_path, &id)
    }

    pub fn delete_workspace(&self, id: String) -> anyhow::Result<()> {
        storage::delete_workspace(&self.database_path, &id)?;
        self.log_event("workspace", &format!("workspace deleted id={id}"));
        Ok(())
    }

    pub async fn analyze_workspace_stream<F>(
        &self,
        workspace_id: String,
        use_llm: Option<bool>,
        retry_report_id: Option<String>,
        on_chunk: F,
    ) -> anyhow::Result<AnalysisResponse>
    where
        F: FnMut(&str) -> anyhow::Result<()> + Send,
    {
        let is_retry = retry_report_id
            .as_deref()
            .is_some_and(|value| !value.trim().is_empty());
        let detail = storage::get_workspace(&self.database_path, &workspace_id)?;
        if detail.files.is_empty() {
            return Err(anyhow!("Workspace has no files to analyze."));
        }
        let request = ProjectAnalyzeRequest {
            project_name: detail.summary.name.clone(),
            workspace_id: Some(workspace_id.clone()),
            title: Some(format!("{} workspace review", detail.summary.name)),
            files: detail
                .files
                .iter()
                .map(|file| ProjectFileInput {
                    path: file.path.clone(),
                    content: file.content.clone(),
                    language: Some(file.language.clone()),
                })
                .collect(),
            use_llm,
            retry_report_id,
        };
        self.validate_project_retry_scope(
            request.retry_report_id.as_deref(),
            Some(&workspace_id),
        )?;
        let mut report = self.build_project_report(&request)?;
        report.report_type = "project".to_string();
        report.metadata_json = json!({
            "workspace_id": workspace_id,
            "analysis_profile": "workspace-review-v1.0"
        })
        .to_string();
        let prompt = workspace_prompt(&detail, &report);
        let warnings = self
            .try_stream_llm_report(
                request.use_llm.unwrap_or(true),
                "Workspace review",
                &prompt,
                &mut report,
                on_chunk,
            )
            .await?;
        self.apply_retry_report_id(&mut report, request.retry_report_id.as_deref())?;
        storage::save_report(&self.database_path, &report)?;
        self.record_activity("report", "生成工作区审查报告", &report.title, Some("report"), Some(&report.id));
        if !is_retry {
            let mut findings = Vec::new();
            for file in &detail.files {
                findings.extend(workspace::build_findings(file, Some(report.id.clone())));
            }
            storage::replace_findings_for_report(&self.database_path, &report.id, &findings)?;
        }
        Ok(AnalysisResponse { report, warnings })
    }

    pub fn get_code_map(&self, workspace_id: String) -> anyhow::Result<CodeMap> {
        storage::get_code_map(&self.database_path, &workspace_id)
    }

    pub fn list_findings(
        &self,
        workspace_id: Option<String>,
        status: Option<String>,
        severity: Option<String>,
        report_id: Option<String>,
    ) -> anyhow::Result<Vec<Finding>> {
        storage::list_findings(&self.database_path, workspace_id, status, severity, report_id)
    }

    pub fn update_finding_status(&self, id: String, status: String) -> anyhow::Result<Finding> {
        let finding = storage::update_finding_status(&self.database_path, &id, &status)?;
        self.log_event(
            "findings",
            &format!("finding status updated id={} status={}", finding.id, finding.status),
        );
        Ok(finding)
    }

    pub fn create_cards_from_findings(&self, finding_ids: Vec<String>) -> anyhow::Result<Vec<LearningCard>> {
        let cards = storage::create_cards_from_findings(&self.database_path, finding_ids)?;
        self.log_event("cards", &format!("created {} learning card(s)", cards.len()));
        self.record_activity("card", "从问题清单生成知识卡片", &format!("生成 {} 张卡片", cards.len()), None, None);
        Ok(cards)
    }

    pub fn list_learning_cards(
        &self,
        workspace_id: Option<String>,
        status: Option<String>,
        tag: Option<String>,
    ) -> anyhow::Result<Vec<LearningCard>> {
        storage::list_learning_cards(&self.database_path, workspace_id, status, tag)
    }

    pub fn update_learning_card(&self, id: String, status: String) -> anyhow::Result<LearningCard> {
        storage::update_learning_card(&self.database_path, &id, &status)
    }

    pub fn delete_learning_card(&self, id: String) -> anyhow::Result<()> {
        storage::delete_learning_card(&self.database_path, &id)?;
        self.log_event("cards", &format!("learning card deleted id={id}"));
        Ok(())
    }

    pub fn create_learning_card(&self, input: LearningCardCreate) -> anyhow::Result<LearningCard> {
        let card = storage::create_learning_card(&self.database_path, input)?;
        self.record_activity("card", "创建知识卡片", &card.title, Some("learning_card"), Some(&card.id));
        Ok(card)
    }

    pub async fn generate_card_material(&self, card_id: String, use_llm: Option<bool>) -> anyhow::Result<CardMaterial> {
        let card = storage::get_learning_card(&self.database_path, &card_id)?;
        let mut content = render_local_card_material(&card);
        let mut source = "local".to_string();
        if use_llm.unwrap_or(true) {
            let settings = self.settings()?;
            if settings.llm_state == "configured" {
                if let Some(key) = storage::load_api_key(&self.database_path)?.filter(|value| !value.trim().is_empty()) {
                    let messages = llm::learning_material_messages(&card);
                    match llm::complete_chat(&settings, &key, &messages).await {
                        Ok(value) => {
                            content = value;
                            source = "llm".to_string();
                        }
                        Err(err) => {
                            self.log_event("llm", &format!("card material fallback: {err}"));
                            source = "local_fallback".to_string();
                        }
                    }
                }
            }
        }
        let material = CardMaterial {
            id: Uuid::new_v4().to_string(),
            card_id: card.id.clone(),
            title: format!("{}：学习材料", card.title),
            content,
            source,
            created_at: Utc::now().to_rfc3339(),
        };
        storage::save_card_material(&self.database_path, &material)?;
        self.record_activity("card", "生成学习材料", &material.title, Some("card_material"), Some(&material.id));
        Ok(material)
    }

    pub fn list_card_materials(&self, card_id: Option<String>) -> anyhow::Result<Vec<CardMaterial>> {
        storage::list_card_materials(&self.database_path, card_id)
    }

    pub fn get_daily_summary(&self, date: String) -> anyhow::Result<DailySummary> {
        storage::get_daily_summary(&self.database_path, &date)
    }

    pub fn generate_daily_log(&self, date: String) -> anyhow::Result<DailyLog> {
        let summary = storage::get_daily_summary(&self.database_path, &date)?;
        let now = Utc::now().to_rfc3339();
        Ok(DailyLog {
            id: Uuid::new_v4().to_string(),
            date: summary.date.clone(),
            title: format!("{} 学习日志", summary.date),
            content: render_daily_log(&summary),
            created_at: now.clone(),
            updated_at: now,
        })
    }

    pub fn save_daily_log(&self, date: String, title: String, content: String) -> anyhow::Result<DailyLog> {
        let log = storage::save_daily_log(&self.database_path, &date, &title, &content)?;
        self.record_activity("daily_log", "保存每日日志", &log.title, Some("daily_log"), Some(&log.id));
        Ok(log)
    }

    pub fn list_daily_logs(&self) -> anyhow::Result<Vec<DailyLog>> {
        storage::list_daily_logs(&self.database_path)
    }

    pub fn export_daily_log_markdown(&self, date: String) -> anyhow::Result<String> {
        let log = self
            .list_daily_logs()?
            .into_iter()
            .find(|item| item.date == date)
            .unwrap_or_else(|| self.generate_daily_log(date.clone()).unwrap_or_else(|_| {
                let now = Utc::now().to_rfc3339();
                DailyLog {
                    id: Uuid::new_v4().to_string(),
                    date: date.clone(),
                    title: format!("{date} 学习日志"),
                    content: format!("# {date} 学习日志\n\n当前日期还没有可汇总的本地活动。"),
                    created_at: now.clone(),
                    updated_at: now,
                }
            }));
        let exports_dir = self.storage_dir.join("exports").join("daily-logs");
        fs::create_dir_all(&exports_dir)
            .with_context(|| format!("failed to create daily log exports dir {}", exports_dir.display()))?;
        let file_name = format!("{}-{}.md", log.date, safe_file_stem(&log.title));
        let output_path = exports_dir.join(file_name);
        fs::write(&output_path, render_daily_log_export(&log))
            .with_context(|| format!("failed to write daily log export {}", output_path.display()))?;
        self.log_event("export", &format!("daily log exported to {}", output_path.display()));
        self.record_activity("daily_log", "导出每日日志", &log.title, Some("daily_log"), Some(&log.id));
        Ok(output_path.display().to_string())
    }

    pub fn generate_project_guide(&self, workspace_id: String) -> anyhow::Result<ProjectGuide> {
        let detail = storage::get_workspace(&self.database_path, &workspace_id)?;
        let code_map = storage::get_code_map(&self.database_path, &workspace_id)?;
        let guide = build_project_guide(&detail, &code_map);
        storage::save_project_guide(&self.database_path, &guide)?;
        self.record_activity("guide", "生成项目导览", &guide.title, Some("workspace"), Some(&workspace_id));
        Ok(guide)
    }

    pub fn get_project_guide(&self, workspace_id: String) -> anyhow::Result<ProjectGuide> {
        storage::get_project_guide(&self.database_path, &workspace_id)
    }

    pub fn create_agent_plan(&self, request: AgentPlanRequest) -> anyhow::Result<AgentTask> {
        let task = self.build_agent_task(request)?;
        storage::save_agent_task(&self.database_path, &task)?;
        self.record_activity("agent", "生成行动草稿", &task.title, Some("agent_task"), Some(&task.id));
        Ok(task)
    }

    pub fn list_agent_tasks(&self) -> anyhow::Result<Vec<AgentTask>> {
        storage::list_agent_tasks(&self.database_path)
    }

    pub fn get_agent_task(&self, id: String) -> anyhow::Result<AgentTask> {
        storage::get_agent_task(&self.database_path, &id)
    }

    pub fn delete_agent_task(&self, id: String) -> anyhow::Result<()> {
        storage::delete_agent_task(&self.database_path, &id)?;
        self.log_event("agent", &format!("agent task deleted id={id}"));
        Ok(())
    }

    pub fn apply_agent_plan(&self, request: AgentApplyRequest) -> anyhow::Result<AgentApplyResult> {
        if !request.confirm {
            return Err(anyhow!("写入行动草稿前必须显式确认。"));
        }
        let mut task = storage::get_agent_task(&self.database_path, &request.task_id)?;
        let root = self.workspace_root_for_agent_task(&task)?;
        let backup_dir = self
            .storage_dir
            .join("backups")
            .join("agent")
            .join(&task.id);
        fs::create_dir_all(&backup_dir)?;
        let selected = if request.operation_ids.is_empty() {
            task.operations.iter().map(|item| item.id.clone()).collect::<Vec<_>>()
        } else {
            request.operation_ids.clone()
        };
        let mut messages = Vec::new();
        let mut applied_count = 0usize;
        for operation in task.operations.clone().into_iter().filter(|item| selected.contains(&item.id)) {
            match self.apply_agent_operation(&root, &backup_dir, &operation) {
                Ok((backup_path, message)) => {
                    applied_count += 1;
                    storage::update_agent_operation_result(
                        &self.database_path,
                        &operation.id,
                        "applied",
                        true,
                        backup_path.map(|path| path.display().to_string()),
                        Some(Utc::now().to_rfc3339()),
                        None,
                    )?;
                    messages.push(message);
                }
                Err(err) => {
                    storage::update_agent_operation_result(
                        &self.database_path,
                        &operation.id,
                        "failed",
                        true,
                        None,
                        None,
                        Some(err.to_string()),
                    )?;
                    messages.push(format!("{} 写入失败：{err}", operation.path));
                }
            }
        }
        let status = if applied_count == selected.len() { "applied" } else { "partial" };
        let summary = format!(
            "已确认 {} 项操作，成功写入 {} 项。备份目录：{}",
            selected.len(),
            applied_count,
            backup_dir.display()
        );
        storage::update_agent_task_status(&self.database_path, &task.id, status, &summary)?;
        task = storage::get_agent_task(&self.database_path, &task.id)?;
        self.record_activity("agent", "写入行动草稿", &summary, Some("agent_task"), Some(&task.id));
        Ok(AgentApplyResult {
            task,
            applied_count,
            backup_dir: backup_dir.display().to_string(),
            messages,
        })
    }

    pub fn rollback_agent_operation(
        &self,
        task_id: String,
        operation_id: String,
    ) -> anyhow::Result<AgentTask> {
        let task = storage::get_agent_task(&self.database_path, &task_id)?;
        let root = self.workspace_root_for_agent_task(&task)?;
        let operation = task
            .operations
            .iter()
            .find(|item| item.id == operation_id)
            .cloned()
            .ok_or_else(|| anyhow!("未找到行动草稿文件操作：{operation_id}"))?;
        if operation.status != "applied" {
            return Err(anyhow!("只有已写入的行动草稿文件操作可以回滚。"));
        }
        let target = safe_agent_target(&root, &operation.path)?;
        if let Some(backup_path) = operation.backup_path.as_deref().filter(|value| !value.trim().is_empty()) {
            let backup_path = PathBuf::from(backup_path);
            if !backup_path.exists() {
                return Err(anyhow!("回滚备份文件不存在：{}", backup_path.display()));
            }
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent)?;
            }
            fs::copy(&backup_path, &target)
                .with_context(|| format!("failed to restore backup {}", backup_path.display()))?;
        } else if target.exists() {
            if target.is_dir() {
                return Err(anyhow!("拒绝删除目录类型目标：{}", target.display()));
            }
            fs::remove_file(&target)
                .with_context(|| format!("failed to remove generated file {}", target.display()))?;
        }
        storage::update_agent_operation_result(
            &self.database_path,
            &operation.id,
            "rolled_back",
            true,
            operation.backup_path.clone(),
            operation.applied_at.clone(),
            None,
        )?;
        let next_task = storage::get_agent_task(&self.database_path, &task.id)?;
        let status = if next_task.operations.iter().any(|item| item.status == "applied") {
            "partial"
        } else if next_task.operations.iter().any(|item| item.status == "pending") {
            "planned"
        } else {
            "rolled_back"
        };
        let summary = format!("已回滚文件操作：{}", operation.path);
        storage::update_agent_task_status(&self.database_path, &task.id, status, &summary)?;
        let next_task = storage::get_agent_task(&self.database_path, &task.id)?;
        self.record_activity("agent", "回滚行动草稿操作", &summary, Some("agent_task"), Some(&task.id));
        Ok(next_task)
    }

    pub fn get_workspace_bridge_status(
        &self,
        workspace_id: Option<String>,
    ) -> anyhow::Result<WorkspaceBridgeStatus> {
        let workspace = match workspace_id.filter(|value| !value.trim().is_empty()) {
            Some(id) => Some(storage::get_workspace(&self.database_path, &id)?),
            None => storage::list_workspaces(&self.database_path, None)?.into_iter().next()
                .map(|summary| storage::get_workspace(&self.database_path, &summary.id))
                .transpose()?,
        };
        let Some(detail) = workspace else {
            return Ok(WorkspaceBridgeStatus {
                connected: false,
                status: "no_workspace".to_string(),
                workspace_id: None,
                workspace_name: "未打开工作区".to_string(),
                workspace_root: String::new(),
                candidate_files: Vec::new(),
                selected_file_paths: Vec::new(),
                heartbeat_at: String::new(),
                updated_at: Utc::now().to_rfc3339(),
                plugin_version: "local-tauri-bridge/1.0".to_string(),
                message: "请先在“分析主线”导入一个本地工作区。".to_string(),
            });
        };
        let stored_selection = storage::load_workspace_bridge_selection(&self.database_path, &detail.summary.id)?;
        let selected_file_paths = if stored_selection.is_empty() {
            detail
                .files
                .iter()
                .take(5)
                .map(|file| file.path.clone())
                .collect::<Vec<_>>()
        } else {
            stored_selection
        };
        let mut candidate_files = detail
            .files
            .iter()
            .map(|file| WorkspaceBridgeFile {
                path: file.path.clone(),
                language: file.language.clone(),
                total_lines: file.metrics.total_lines,
                complexity_score: file.metrics.complexity_score,
                risk_count: file.metrics.risk_count,
                selected: selected_file_paths.contains(&file.path),
            })
            .collect::<Vec<_>>();
        candidate_files.sort_by(|left, right| {
            right
                .risk_count
                .cmp(&left.risk_count)
                .then(right.complexity_score.cmp(&left.complexity_score))
                .then(left.path.cmp(&right.path))
        });
        candidate_files.truncate(80);
        let now = Utc::now().to_rfc3339();
        let status = WorkspaceBridgeStatus {
            connected: true,
            status: "local_bridge".to_string(),
            workspace_id: Some(detail.summary.id.clone()),
            workspace_name: detail.summary.name.clone(),
            workspace_root: detail.summary.root_path.clone(),
            candidate_files,
            selected_file_paths,
            heartbeat_at: now.clone(),
            updated_at: now,
            plugin_version: "local-tauri-bridge/1.0".to_string(),
            message: "本地 Tauri workspace bridge 已就绪，可作为高级外部工具清单入口。".to_string(),
        };
        storage::save_workspace_bridge_status(&self.database_path, &status)?;
        Ok(status)
    }

    pub fn update_workspace_bridge_selection(
        &self,
        workspace_id: String,
        selected_file_paths: Vec<String>,
    ) -> anyhow::Result<WorkspaceBridgeStatus> {
        let mut status = self.get_workspace_bridge_status(Some(workspace_id))?;
        let selected = selected_file_paths
            .into_iter()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .take(12)
            .collect::<Vec<_>>();
        status.selected_file_paths = selected.clone();
        for file in &mut status.candidate_files {
            file.selected = selected.contains(&file.path);
        }
        status.updated_at = Utc::now().to_rfc3339();
        storage::save_workspace_bridge_status(&self.database_path, &status)?;
        Ok(status)
    }

    pub fn export_workspace_bridge_manifest(
        &self,
        workspace_id: Option<String>,
    ) -> anyhow::Result<WorkspaceBridgeManifestResult> {
        let status = self.get_workspace_bridge_status(workspace_id)?;
        let generated_at = Utc::now().to_rfc3339();
        let bridge_dir = self.storage_dir.join("bridge").join(format!(
            "{}-{}",
            Utc::now().format("%Y%m%d-%H%M%S"),
            safe_file_stem(if status.workspace_name.trim().is_empty() {
                "workspace-bridge"
            } else {
                &status.workspace_name
            })
        ));
        fs::create_dir_all(&bridge_dir)
            .with_context(|| format!("failed to create bridge export dir {}", bridge_dir.display()))?;

        let selected_candidates = status
            .candidate_files
            .iter()
            .filter(|file| status.selected_file_paths.contains(&file.path))
            .cloned()
            .collect::<Vec<_>>();
        let manifest = json!({
            "schema": "codelens.workspace_bridge.v1",
            "app": "CodeLens Pro Next",
            "version": env!("CARGO_PKG_VERSION"),
            "generated_at": generated_at,
            "workspace": {
                "id": status.workspace_id,
                "name": status.workspace_name,
                "root": status.workspace_root,
                "connected": status.connected,
                "status": status.status,
                "plugin_version": status.plugin_version,
                "heartbeat_at": status.heartbeat_at,
                "updated_at": status.updated_at
            },
            "selected_file_paths": status.selected_file_paths,
            "selected_files": selected_candidates,
            "candidate_files": status.candidate_files,
            "contracts": {
                "read_only_scan": true,
                "writes_user_project": false,
                "agent_requires_confirmation": true,
                "expected_consumer": "external editor or local automation",
                "notes": [
                    "该清单只导出路径、语言、行数、复杂度和风险计数，不导出源代码正文。",
                    "外部工具可读取 selected_file_paths 作为行动草稿上下文入口。",
                    "真正写入用户项目前仍应回到 CodeLens Pro Next 的行动草稿页确认。"
                ]
            }
        });

        let manifest_text = serde_json::to_string_pretty(&manifest)?;
        let readme_text = render_workspace_bridge_readme(&status, &generated_at);
        let manifest_path = bridge_dir.join("manifest.json");
        fs::write(&manifest_path, &manifest_text)
            .with_context(|| format!("failed to write bridge manifest {}", manifest_path.display()))?;

        let readme_path = bridge_dir.join("README.md");
        fs::write(&readme_path, &readme_text)
            .with_context(|| format!("failed to write bridge README {}", readme_path.display()))?;

        let current_dir = self.storage_dir.join("bridge").join("current");
        fs::create_dir_all(&current_dir)
            .with_context(|| format!("failed to create current bridge dir {}", current_dir.display()))?;
        let current_manifest_path = current_dir.join("manifest.json");
        let current_readme_path = current_dir.join("README.md");
        fs::write(&current_manifest_path, &manifest_text).with_context(|| {
            format!(
                "failed to write current bridge manifest {}",
                current_manifest_path.display()
            )
        })?;
        fs::write(&current_readme_path, &readme_text).with_context(|| {
            format!(
                "failed to write current bridge README {}",
                current_readme_path.display()
            )
        })?;

        self.log_event("bridge", &format!("workspace bridge manifest exported to {}", manifest_path.display()));
        self.record_activity(
            "bridge",
            "导出工作区桥接清单",
            &status.workspace_name,
            Some("workspace"),
            status.workspace_id.as_deref(),
        );

        Ok(WorkspaceBridgeManifestResult {
            export_dir: bridge_dir.display().to_string(),
            manifest_path: manifest_path.display().to_string(),
            readme_path: readme_path.display().to_string(),
            current_dir: current_dir.display().to_string(),
            current_manifest_path: current_manifest_path.display().to_string(),
            current_readme_path: current_readme_path.display().to_string(),
            generated_at,
            workspace_id: status.workspace_id,
            workspace_name: status.workspace_name,
            selected_file_count: status.selected_file_paths.len(),
            candidate_file_count: status.candidate_files.len(),
        })
    }

    pub fn list_workspace_bridge_inbox(&self) -> anyhow::Result<Vec<WorkspaceBridgeInboxRequest>> {
        self.ensure_workspace_bridge_inbox()?;
        let inbox_dir = self.bridge_inbox_dir();
        let mut requests = Vec::new();
        for entry in fs::read_dir(&inbox_dir)
            .with_context(|| format!("failed to read bridge inbox dir {}", inbox_dir.display()))?
        {
            let entry = entry?;
            let path = entry.path();
            if !path.is_file() || path.extension().and_then(|value| value.to_str()) != Some("json") {
                continue;
            }
            match self.parse_workspace_bridge_inbox_file(&path) {
                Ok(request) => requests.push(request),
                Err(err) => requests.push(invalid_bridge_inbox_request(&path, err.to_string())),
            }
        }
        requests.sort_by(|left, right| {
            right
                .created_at
                .cmp(&left.created_at)
                .then(left.id.cmp(&right.id))
        });
        Ok(requests)
    }

    pub fn create_agent_plan_from_bridge_inbox(
        &self,
        request_id: String,
    ) -> anyhow::Result<WorkspaceBridgeInboxApplyResult> {
        self.ensure_workspace_bridge_inbox()?;
        let request_id = request_id.trim();
        if request_id.is_empty() {
            return Err(anyhow!("请选择一个桥接收件箱请求。"));
        }

        let mut matched_path = None;
        let mut matched_request = None;
        for entry in fs::read_dir(self.bridge_inbox_dir())? {
            let entry = entry?;
            let path = entry.path();
            if !path.is_file() || path.extension().and_then(|value| value.to_str()) != Some("json") {
                continue;
            }
            let request = match self.parse_workspace_bridge_inbox_file(&path) {
                Ok(value) => value,
                Err(_) => continue,
            };
            let stem = path
                .file_stem()
                .and_then(|value| value.to_str())
                .unwrap_or_default();
            let file_name = path
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or_default();
            if request.id == request_id || stem == request_id || file_name == request_id {
                matched_path = Some(path);
                matched_request = Some(request);
                break;
            }
        }

        let path = matched_path.ok_or_else(|| anyhow!("未找到可处理的桥接收件箱请求：{request_id}"))?;
        let mut request = matched_request.expect("matched request is present");
        let task = self.create_agent_plan(AgentPlanRequest {
            context_kind: request.context_kind.clone(),
            context_id: request.context_id.clone(),
            goal: Some(request.goal.clone()),
            selected_file_paths: request.selected_file_paths.clone(),
        })?;

        let processed_dir = self.bridge_processed_dir();
        fs::create_dir_all(&processed_dir)
            .with_context(|| format!("failed to create bridge processed dir {}", processed_dir.display()))?;
        let processed_path = processed_dir.join(format!(
            "{}-{}",
            Utc::now().format("%Y%m%d-%H%M%S"),
            path.file_name()
                .and_then(|value| value.to_str())
                .map(safe_file_stem)
                .unwrap_or_else(|| format!("{}.json", safe_file_stem(&request.id)))
        ));
        fs::rename(&path, &processed_path).or_else(|_| {
            fs::copy(&path, &processed_path)?;
            fs::remove_file(&path)?;
            Ok::<(), std::io::Error>(())
        })
        .with_context(|| {
            format!(
                "failed to move bridge inbox request {} to {}",
                path.display(),
                processed_path.display()
            )
        })?;

        request.status = "processed".to_string();
        request.file_path = processed_path.display().to_string();
        self.log_event(
            "bridge",
            &format!("bridge inbox request {} converted to agent task {}", request.id, task.id),
        );
        self.record_activity(
            "bridge",
            "处理桥接收件箱请求",
            &request.goal,
            Some("agent_task"),
            Some(&task.id),
        );
        Ok(WorkspaceBridgeInboxApplyResult { request, task })
    }

    pub fn generate_card_candidates_from_report(
        &self,
        report_id: String,
    ) -> anyhow::Result<Vec<LearningCardCandidate>> {
        let report = storage::get_report(&self.database_path, &report_id)?;
        let mut candidates = Vec::new();
        for (index, item) in report.risks.iter().chain(report.suggestions.iter()).take(16).enumerate() {
            let title = if index < report.risks.len() {
                format!("风险复习：{}", item.chars().take(36).collect::<String>())
            } else {
                format!("改进建议：{}", item.chars().take(36).collect::<String>())
            };
            let tags = vec![report.report_type.clone(), report.risk_level.clone(), "报告候选".to_string()];
            let dedupe_key = format!("report:{report_id}:{:x}", stable_hash(&title));
            candidates.push(LearningCardCandidate {
                id: Uuid::new_v4().to_string(),
                source_kind: "report".to_string(),
                source_id: report_id.clone(),
                workspace_id: workspace_id_from_report(&report),
                report_id: Some(report_id.clone()),
                finding_id: None,
                title,
                content: format!("来源报告：{}\n\n{}\n\n复习要求：说明该点为什么重要，并给出一个检查或测试动作。", report.title, item),
                tags,
                difficulty: if report.risk_level == "high" { "hard" } else { "medium" }.to_string(),
                status: "pending".to_string(),
                dedupe_key,
                created_at: Utc::now().to_rfc3339(),
            });
        }
        let created = storage::save_learning_card_candidates(&self.database_path, &candidates)?;
        self.record_activity("card_candidate", "生成知识卡片候选", &format!("{} 个候选", created.len()), Some("report"), Some(&report_id));
        Ok(created)
    }

    pub fn list_learning_card_candidates(
        &self,
        status: Option<String>,
        source_id: Option<String>,
    ) -> anyhow::Result<Vec<LearningCardCandidate>> {
        storage::list_learning_card_candidates(&self.database_path, status, source_id)
    }

    pub fn approve_learning_card_candidates(
        &self,
        candidate_ids: Vec<String>,
    ) -> anyhow::Result<Vec<LearningCard>> {
        let cards = storage::approve_learning_card_candidates(&self.database_path, candidate_ids)?;
        self.record_activity("card", "审核通过知识卡片候选", &format!("{} 张卡片", cards.len()), None, None);
        Ok(cards)
    }

    pub fn reject_learning_card_candidate(&self, id: String) -> anyhow::Result<()> {
        storage::reject_learning_card_candidate(&self.database_path, &id)?;
        self.record_activity("card_candidate", "拒绝知识卡片候选", &id, Some("card_candidate"), Some(&id));
        Ok(())
    }

    pub fn get_learning_calendar(&self, month: String) -> anyhow::Result<Vec<LearningCalendarItem>> {
        storage::list_learning_calendar(&self.database_path, &month)
    }

    pub fn get_learning_center(&self, date: String, month: String) -> anyhow::Result<LearningCenterData> {
        Ok(LearningCenterData {
            today: storage::get_daily_summary(&self.database_path, &date)?,
            calendar: storage::list_learning_calendar(&self.database_path, &month)?,
            review_cards: storage::list_learning_cards(&self.database_path, None, Some("new".to_string()), None)?,
            recent_agent_tasks: storage::list_agent_tasks(&self.database_path)?.into_iter().take(8).collect(),
        })
    }

    pub fn record_activity_event(
        &self,
        event_type: String,
        title: String,
        detail: String,
        entity_kind: Option<String>,
        entity_id: Option<String>,
    ) -> anyhow::Result<ActivityEvent> {
        storage::record_activity_event(
            &self.database_path,
            &event_type,
            &title,
            &detail,
            entity_kind.as_deref(),
            entity_id.as_deref(),
        )
    }

    pub fn get_activity_summary(&self) -> anyhow::Result<ActivitySummary> {
        storage::get_activity_summary(&self.database_path)
    }

    pub fn get_activity_galaxy_data(&self) -> anyhow::Result<ActivityGalaxyData> {
        storage::get_activity_galaxy_data(&self.database_path)
    }

    pub fn get_activity_constellation(&self, limit: Option<usize>) -> anyhow::Result<ActivityConstellationData> {
        storage::get_activity_constellation(&self.database_path, limit)
    }

    pub fn get_traceability_snapshot(
        &self,
        scope_kind: Option<String>,
        scope_id: Option<String>,
    ) -> anyhow::Result<TraceabilitySnapshot> {
        storage::get_traceability_snapshot(&self.database_path, scope_kind, scope_id)
    }

    pub fn export_report_markdown(&self, id: String) -> anyhow::Result<String> {
        let report = self.get_report(id)?;
        let exports_dir = self.storage_dir.join("exports");
        fs::create_dir_all(&exports_dir)
            .with_context(|| format!("failed to create exports dir {}", exports_dir.display()))?;

        let file_name = format!(
            "{}-{}.md",
            Utc::now().format("%Y%m%d-%H%M%S"),
            safe_file_stem(&report.title)
        );
        let output_path = exports_dir.join(file_name);
        fs::write(&output_path, render_markdown_export(&report))
            .with_context(|| format!("failed to write export {}", output_path.display()))?;
        self.log_event("export", &format!("report exported to {}", output_path.display()));
        Ok(output_path.display().to_string())
    }

    pub fn export_report_html(&self, id: String) -> anyhow::Result<String> {
        let report = self.get_report(id)?;
        let exports_dir = self.storage_dir.join("exports");
        fs::create_dir_all(&exports_dir)
            .with_context(|| format!("failed to create exports dir {}", exports_dir.display()))?;
        let file_name = format!(
            "{}-{}.html",
            Utc::now().format("%Y%m%d-%H%M%S"),
            safe_file_stem(&report.title)
        );
        let output_path = exports_dir.join(file_name);
        fs::write(&output_path, render_html_export(&report))
            .with_context(|| format!("failed to write export {}", output_path.display()))?;
        self.log_event("export", &format!("HTML report exported to {}", output_path.display()));
        Ok(output_path.display().to_string())
    }

    pub fn export_agent_task_markdown(&self, id: String) -> anyhow::Result<String> {
        let task = self.get_agent_task(id)?;
        let exports_dir = self.storage_dir.join("exports").join("agent");
        fs::create_dir_all(&exports_dir)
            .with_context(|| format!("failed to create agent exports dir {}", exports_dir.display()))?;
        let file_name = format!(
            "{}-{}.md",
            Utc::now().format("%Y%m%d-%H%M%S"),
            safe_file_stem(&task.title)
        );
        let output_path = exports_dir.join(file_name);
        fs::write(&output_path, render_agent_task_markdown(&task))
            .with_context(|| format!("failed to write agent export {}", output_path.display()))?;
        self.log_event("export", &format!("agent task exported to {}", output_path.display()));
        self.record_activity("agent", "导出行动草稿", &task.title, Some("agent_task"), Some(&task.id));
        Ok(output_path.display().to_string())
    }

    pub fn export_learning_cards_markdown(
        &self,
        workspace_id: Option<String>,
        status: Option<String>,
        tag: Option<String>,
    ) -> anyhow::Result<String> {
        let cards = self.list_learning_cards(workspace_id, status.clone(), tag.clone())?;
        let materials = self.list_card_materials(None)?;
        let exports_dir = self.storage_dir.join("exports").join("learning-cards");
        fs::create_dir_all(&exports_dir)
            .with_context(|| format!("failed to create learning card exports dir {}", exports_dir.display()))?;
        let suffix = match (status.as_deref(), tag.as_deref()) {
            (Some(status), Some(tag)) if status != "all" => format!("{}-{}", status, safe_file_stem(tag)),
            (Some(status), _) if status != "all" => status.to_string(),
            (_, Some(tag)) => safe_file_stem(tag),
            _ => "all".to_string(),
        };
        let file_name = format!("{}-learning-cards-{}.md", Utc::now().format("%Y%m%d-%H%M%S"), suffix);
        let output_path = exports_dir.join(file_name);
        fs::write(&output_path, render_learning_cards_markdown(&cards, &materials, status.as_deref(), tag.as_deref()))
            .with_context(|| format!("failed to write learning card export {}", output_path.display()))?;
        self.log_event("export", &format!("learning cards exported to {}", output_path.display()));
        self.record_activity(
            "card",
            "导出知识卡片组",
            &format!("导出 {} 张知识卡片", cards.len()),
            Some("learning_card"),
            cards.first().map(|card| card.id.as_str()),
        );
        Ok(output_path.display().to_string())
    }

    pub fn report_text_for_clipboard(&self, id: String) -> anyhow::Result<String> {
        let report = self.get_report(id)?;
        Ok(render_markdown_export(&report))
    }

    pub fn export_product_archive(&self) -> anyhow::Result<ProductArchiveResult> {
        let generated_at = Utc::now().to_rfc3339();
        let export_dir = self
            .storage_dir
            .join("exports")
            .join(format!("product-archive-{}", Utc::now().format("%Y%m%d-%H%M%S")));
        fs::create_dir_all(&export_dir)
            .with_context(|| format!("failed to create product archive dir {}", export_dir.display()))?;

        let settings = self.settings()?;
        let model_profiles = self.list_model_profiles()?;
        let report_summaries = self.list_reports_filtered(None, None)?;
        let reports = report_summaries
            .iter()
            .filter_map(|item| self.get_report(item.id.clone()).ok())
            .collect::<Vec<_>>();
        let workspaces = self
            .list_workspaces(None)?
            .into_iter()
            .filter_map(|item| self.get_workspace(item.id).ok())
            .collect::<Vec<_>>();
        let findings = self.list_findings(None, None, None, None)?;
        let cards = self.list_learning_cards(None, None, None)?;
        let card_materials = self.list_card_materials(None)?;
        let daily_logs = self.list_daily_logs()?;
        let project_guides = storage::list_project_guides(&self.database_path)?;
        let agent_tasks = self.list_agent_tasks()?;
        let chat_sessions = self
            .list_chat_sessions(None)?
            .into_iter()
            .filter_map(|item| self.get_chat_session(item.id).ok())
            .collect::<Vec<_>>();
        let activity = self.get_activity_summary()?;
        let activity_events = activity.recent_events.clone();
        let code_maps = workspaces
            .iter()
            .filter_map(|item| self.get_code_map(item.summary.id.clone()).ok())
            .collect::<Vec<_>>();
        let traceability = self.get_traceability_snapshot(Some("global".to_string()), None)?;
        let counts = traceability.counts.clone();

        let manifest = json!({
            "product": "CodeLens Pro Next",
            "version": env!("CARGO_PKG_VERSION"),
            "generated_at": generated_at,
            "settings": settings,
            "model_profiles": model_profiles,
            "counts": counts.clone(),
            "reports": reports,
            "workspaces": workspaces,
            "code_maps": code_maps,
            "findings": findings,
            "learning_cards": cards,
            "card_materials": card_materials,
            "daily_logs": daily_logs,
            "project_guides": project_guides,
            "agent_tasks": agent_tasks,
            "chat_sessions": chat_sessions,
            "activity_summary": activity,
            "activity_events": activity_events,
            "traceability": traceability
        });
        let manifest_path = export_dir.join("manifest.json");
        fs::write(&manifest_path, serde_json::to_string_pretty(&manifest)?)
            .with_context(|| format!("failed to write archive manifest {}", manifest_path.display()))?;

        let index_path = export_dir.join("index.md");
        fs::write(
            &index_path,
            render_product_archive_index(&manifest, &generated_at),
        )
        .with_context(|| format!("failed to write archive index {}", index_path.display()))?;
        self.record_activity(
            "export",
            "导出本地产品档案",
            &format!("导出目录：{}", export_dir.display()),
            Some("product_archive"),
            Some(&generated_at),
        );
        self.log_event("export", &format!("product archive exported to {}", export_dir.display()));

        Ok(ProductArchiveResult {
            export_dir: export_dir.display().to_string(),
            index_path: index_path.display().to_string(),
            manifest_path: manifest_path.display().to_string(),
            generated_at,
            counts,
        })
    }

    pub fn import_product_archive_from_path(
        &self,
        manifest_path: impl AsRef<Path>,
    ) -> anyhow::Result<ProductArchiveImportResult> {
        let manifest_path = manifest_path.as_ref();
        let text = fs::read_to_string(manifest_path)
            .with_context(|| format!("failed to read product archive {}", manifest_path.display()))?;
        let manifest: Value = serde_json::from_str(&text)
            .with_context(|| format!("failed to parse product archive {}", manifest_path.display()))?;
        let product = manifest
            .get("product")
            .and_then(Value::as_str)
            .unwrap_or_default();
        if product != "CodeLens Pro Next" {
            return Err(anyhow!("这不是 CodeLens Pro Next 的本地产品档案。"));
        }

        let backup_path = self.backup_database("before-archive-import")?;
        let mut warnings = Vec::new();

        for profile in manifest_vec::<ModelProfile>(&manifest, "model_profiles")? {
            storage::save_model_profile(
                &self.database_path,
                ModelProfileInput {
                    id: Some(profile.id),
                    name: profile.name,
                    api_base: profile.api_base,
                    model: profile.model,
                    note: profile.note,
                    is_default: profile.is_default,
                },
            )?;
        }

        let reports = manifest_vec::<ReportDetail>(&manifest, "reports")?;
        for report in &reports {
            storage::save_report(&self.database_path, report)?;
        }

        let findings = manifest_vec::<Finding>(&manifest, "findings")?;
        let mut findings_by_workspace: BTreeMap<String, Vec<Finding>> = BTreeMap::new();
        for finding in findings {
            findings_by_workspace
                .entry(finding.workspace_id.clone())
                .or_default()
                .push(finding);
        }

        let workspaces = manifest_vec::<WorkspaceDetail>(&manifest, "workspaces")?;
        for workspace in workspaces {
            let workspace_id = workspace.summary.id.clone();
            let workspace_findings = findings_by_workspace
                .remove(&workspace_id)
                .unwrap_or_default();
            let scan = workspace::scan_from_detail(workspace, workspace_findings);
            storage::save_workspace_scan(&self.database_path, &scan)?;
        }
        if !findings_by_workspace.is_empty() {
            warnings.push(format!(
                "有 {} 组问题缺少对应工作区，已跳过。",
                findings_by_workspace.len()
            ));
        }

        let cards = manifest_vec::<LearningCard>(&manifest, "learning_cards")?;
        storage::save_learning_cards(&self.database_path, &cards)?;
        let card_materials = manifest_vec::<CardMaterial>(&manifest, "card_materials")?;
        storage::save_card_materials(&self.database_path, &card_materials)?;

        for guide in manifest_vec::<ProjectGuide>(&manifest, "project_guides")? {
            storage::save_project_guide(&self.database_path, &guide)?;
        }
        for log in manifest_vec::<DailyLog>(&manifest, "daily_logs")? {
            storage::save_daily_log(&self.database_path, &log.date, &log.title, &log.content)?;
        }
        for task in manifest_vec::<AgentTask>(&manifest, "agent_tasks")? {
            storage::save_agent_task(&self.database_path, &task)?;
        }
        for session in manifest_vec::<ChatSessionDetail>(&manifest, "chat_sessions")? {
            storage::save_chat_session_detail(&self.database_path, &session)?;
        }
        let activity_events = manifest_vec::<ActivityEvent>(&manifest, "activity_events")?;
        storage::save_activity_events(&self.database_path, &activity_events)?;

        let imported_at = Utc::now().to_rfc3339();
        self.record_activity(
            "import",
            "导入本地产品档案",
            &format!("来源：{}", manifest_path.display()),
            Some("product_archive"),
            Some(&imported_at),
        );
        self.log_event(
            "import",
            &format!(
                "product archive imported from {} with backup {}",
                manifest_path.display(),
                backup_path.display()
            ),
        );
        let counts = self
            .get_traceability_snapshot(Some("global".to_string()), None)?
            .counts;

        Ok(ProductArchiveImportResult {
            source_path: manifest_path.display().to_string(),
            backup_path: backup_path.display().to_string(),
            imported_at,
            counts,
            warnings,
        })
    }

    fn bridge_inbox_dir(&self) -> PathBuf {
        self.storage_dir.join("bridge").join("inbox")
    }

    fn bridge_processed_dir(&self) -> PathBuf {
        self.storage_dir.join("bridge").join("processed")
    }

    fn ensure_workspace_bridge_inbox(&self) -> anyhow::Result<()> {
        let inbox_dir = self.bridge_inbox_dir();
        let processed_dir = self.bridge_processed_dir();
        fs::create_dir_all(&inbox_dir)
            .with_context(|| format!("failed to create bridge inbox dir {}", inbox_dir.display()))?;
        fs::create_dir_all(&processed_dir)
            .with_context(|| format!("failed to create bridge processed dir {}", processed_dir.display()))?;
        let readme_path = inbox_dir.join("README.md");
        if !readme_path.exists() {
            fs::write(&readme_path, render_workspace_bridge_inbox_readme()).with_context(|| {
                format!("failed to write bridge inbox README {}", readme_path.display())
            })?;
        }
        Ok(())
    }

    fn parse_workspace_bridge_inbox_file(
        &self,
        path: &Path,
    ) -> anyhow::Result<WorkspaceBridgeInboxRequest> {
        let text = fs::read_to_string(path)
            .with_context(|| format!("failed to read bridge inbox request {}", path.display()))?;
        let payload: WorkspaceBridgeInboxPayload = serde_json::from_str(&text)
            .with_context(|| format!("failed to parse bridge inbox request {}", path.display()))?;
        let file_stem = path
            .file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or("bridge-request");
        let id = normalized_optional(payload.id).unwrap_or_else(|| file_stem.to_string());
        let source = normalized_optional(payload.source).unwrap_or_else(|| "外部工具".to_string());
        let workspace_id = normalized_optional(payload.workspace_id);
        let context_kind = normalized_optional(payload.context_kind)
            .or_else(|| workspace_id.as_ref().map(|_| "workspace".to_string()))
            .unwrap_or_else(|| "general".to_string());
        let context_id = normalized_optional(payload.context_id)
            .or_else(|| workspace_id.clone())
            .unwrap_or_else(|| "general".to_string());
        let goal = normalized_optional(payload.goal)
            .unwrap_or_else(|| "根据外部编辑器上下文生成确认式行动草稿".to_string());
        let selected_file_paths = payload
            .selected_file_paths
            .unwrap_or_default()
            .into_iter()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .take(12)
            .collect::<Vec<_>>();
        let created_at = normalized_optional(payload.created_at)
            .or_else(|| {
                fs::metadata(path)
                    .and_then(|metadata| metadata.modified())
                    .ok()
                    .map(|time| chrono::DateTime::<Utc>::from(time).to_rfc3339())
            })
            .unwrap_or_else(|| Utc::now().to_rfc3339());

        Ok(WorkspaceBridgeInboxRequest {
            id,
            source,
            workspace_id,
            context_kind,
            context_id,
            goal,
            selected_file_paths,
            created_at,
            file_path: path.display().to_string(),
            status: "pending".to_string(),
            error: None,
        })
    }

    pub fn storage_dir_path(&self) -> PathBuf {
        self.storage_dir.clone()
    }

    pub fn logs_dir_path(&self) -> PathBuf {
        self.logs_dir.clone()
    }

    pub fn clipboard_temp_path(&self) -> PathBuf {
        self.storage_dir.join(".clipboard-report.tmp")
    }

    pub fn log_event(&self, area: &str, message: &str) {
        let _ = append_log(&self.logs_dir.join("codelens-next.log"), area, message);
    }

    pub fn log_ai_task_event(
        &self,
        request_id: &str,
        task: &str,
        phase: &str,
        elapsed_ms: u128,
        chunk_count: u64,
        source: Option<&str>,
        error_code: Option<&str>,
    ) {
        self.log_event(
            "ai_task",
            &format!(
                "request_id={} task={} phase={} elapsed_ms={} chunks={} source={} error_code={}",
                safe_log_token(request_id),
                safe_log_token(task),
                safe_log_token(phase),
                elapsed_ms,
                chunk_count,
                source.map(safe_log_token).unwrap_or_else(|| "-".to_string()),
                error_code
                    .map(safe_log_token)
                    .unwrap_or_else(|| "-".to_string()),
            ),
        );
    }

    fn record_activity(
        &self,
        event_type: &str,
        title: &str,
        detail: &str,
        entity_kind: Option<&str>,
        entity_id: Option<&str>,
    ) {
        if let Err(err) = storage::record_activity_event(
            &self.database_path,
            event_type,
            title,
            detail,
            entity_kind,
            entity_id,
        ) {
            self.log_event("activity", &format!("activity record failed: {err}"));
        }
    }

    fn build_agent_task(&self, request: AgentPlanRequest) -> anyhow::Result<AgentTask> {
        let now = Utc::now().to_rfc3339();
        let id = Uuid::new_v4().to_string();
        let goal = request
            .goal
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("围绕当前上下文生成确认式行动草稿");
        let context_summary = self.agent_context_summary(&request)?;
        let selected_file_paths = request
            .selected_file_paths
            .iter()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .take(12)
            .collect::<Vec<_>>();
        let step_specs = vec![
            (
                "确认目标与边界",
                format!("先阅读上下文，确认本轮目标是：{goal}。当前行动草稿采用人工确认式执行，不自动修改业务代码。"),
                "如果目标过大，需要拆成更小的验证点，避免一次性改动不可控。",
                "建议补丁：暂无。此步骤只输出检查清单。",
            ),
            (
                "定位关键文件与风险",
                format!("基于上下文提炼关键文件、问题和依赖关系。\n\n{context_summary}"),
                "如果代码地图不完整，计划应标注需要人工确认的文件。",
                "建议补丁：在真正执行前列出待查看文件和预期影响。",
            ),
            (
                "设计最小修复路径",
                "按“先测试或复现、再小步修改、最后回归”的顺序拆解任务。优先处理高风险 finding、复杂度热点和缺少错误提示的路径。".to_string(),
                "不要把重构、功能新增和样式调整混在一个执行批次里。",
                "建议补丁：为每个步骤准备独立提交说明和回滚点。",
            ),
            (
                "制定验证清单",
                "列出需要运行的本地检查：Rust tests、前端 build、Tauri release build、隔离检查，以及相关页面的中文巡检。".to_string(),
                "如果电脑负载过高，应先跳过 release 编译，只做轻量检查。",
                "建议补丁：更新测试记录，不写入被导入的用户项目。",
            ),
        ];
        let steps = step_specs
            .into_iter()
            .enumerate()
            .map(|(index, (title, detail, risk, suggested_patch))| AgentStep {
                id: Uuid::new_v4().to_string(),
                task_id: id.clone(),
                position: index + 1,
                title: title.to_string(),
                detail,
                risk: risk.to_string(),
                suggested_patch: suggested_patch.to_string(),
                status: "planned".to_string(),
            })
            .collect::<Vec<_>>();

        let task_dir = format!(".codelens-agent/tasks/{}", id.chars().take(8).collect::<String>());
        let operation_specs = vec![
            (
                format!("{task_dir}/plan.md"),
                "生成行动草稿计划",
                "记录目标、上下文、候选文件、步骤拆解、风险和验证路线。",
                render_agent_operation_markdown(goal, &context_summary, &selected_file_paths),
            ),
            (
                format!("{task_dir}/checklist.md"),
                "生成执行确认清单",
                "把人工确认、应用前检查、应用后验证和回滚点拆成可勾选清单。",
                render_agent_checklist_markdown(goal, &steps, &selected_file_paths),
            ),
            (
                format!("{task_dir}/context.json"),
                "生成上下文清单",
                "保存本次行动草稿的上下文类型、上下文编号、候选文件和生成时间，方便后续追踪。",
                render_agent_context_manifest(&id, &request, goal, &context_summary, &selected_file_paths, &now)?,
            ),
        ];
        let operations = operation_specs
            .into_iter()
            .map(|(path, title, preview, replacement)| AgentFileOperation {
                id: Uuid::new_v4().to_string(),
                task_id: id.clone(),
                path,
                operation: "create_or_replace".to_string(),
                title: title.to_string(),
                preview: preview.to_string(),
                replacement,
                status: "pending".to_string(),
                confirmed: false,
                backup_path: None,
                applied_at: None,
                error: None,
            })
            .collect::<Vec<_>>();

        Ok(AgentTask {
            id,
            context_kind: request.context_kind,
            context_id: request.context_id,
            title: format!("行动草稿：{goal}"),
            summary: format!("这是一个确认式行动草稿，包含 {} 个步骤和 {} 个待确认文件操作。", steps.len(), operations.len()),
            status: "planned".to_string(),
            selected_file_paths,
            apply_summary: "等待用户逐项确认后写入。".to_string(),
            created_at: now.clone(),
            updated_at: now,
            steps,
            operations,
        })
    }

    fn workspace_root_for_agent_task(&self, task: &AgentTask) -> anyhow::Result<PathBuf> {
        match task.context_kind.as_str() {
            "workspace" => Ok(PathBuf::from(storage::get_workspace(&self.database_path, &task.context_id)?.summary.root_path)),
            "file" => {
                let (workspace_id, _) = context_file_id(&task.context_id)
                    .ok_or_else(|| anyhow!("文件上下文格式不正确：{}", task.context_id))?;
                Ok(PathBuf::from(storage::get_workspace(&self.database_path, &workspace_id)?.summary.root_path))
            }
            "finding" => {
                let finding = storage::list_findings(&self.database_path, None, None, None, None)?
                    .into_iter()
                    .find(|item| item.id == task.context_id)
                    .ok_or_else(|| anyhow!("未找到问题：{}", task.context_id))?;
                Ok(PathBuf::from(storage::get_workspace(&self.database_path, &finding.workspace_id)?.summary.root_path))
            }
            "report" => {
                let report = storage::get_report(&self.database_path, &task.context_id)?;
                let workspace_id = workspace_id_from_report(&report)
                    .ok_or_else(|| anyhow!("报告没有关联工作区，无法安全应用文件操作。"))?;
                Ok(PathBuf::from(storage::get_workspace(&self.database_path, &workspace_id)?.summary.root_path))
            }
            _ => Err(anyhow!("当前行动草稿没有可写入的工作区上下文。")),
        }
    }

    fn apply_agent_operation(
        &self,
        root: &Path,
        backup_dir: &Path,
        operation: &AgentFileOperation,
    ) -> anyhow::Result<(Option<PathBuf>, String)> {
        let target = safe_agent_target(root, &operation.path)?;
        let backup_path = if target.exists() {
            let backup_path = backup_dir.join(safe_backup_name(&operation.path));
            if let Some(parent) = backup_path.parent() {
                fs::create_dir_all(parent)?;
            }
            fs::copy(&target, &backup_path)?;
            Some(backup_path)
        } else {
            None
        };
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(&target, &operation.replacement)?;
        Ok((
            backup_path,
            format!("已应用 {}，目标：{}", operation.title, target.display()),
        ))
    }

    fn agent_context_summary(&self, request: &AgentPlanRequest) -> anyhow::Result<String> {
        match request.context_kind.as_str() {
            "workspace" => {
                let detail = storage::get_workspace(&self.database_path, &request.context_id)?;
                Ok(format!(
                    "工作区 {}，{} 个文件，{} 行，语言分布：{}。",
                    detail.summary.name,
                    detail.summary.file_count,
                    detail.summary.total_lines,
                    detail.summary.language_summary
                ))
            }
            "finding" => {
                let finding = storage::list_findings(&self.database_path, None, None, None, None)?
                    .into_iter()
                    .find(|item| item.id == request.context_id)
                    .ok_or_else(|| anyhow!("未找到问题：{}", request.context_id))?;
                Ok(format!(
                    "问题：{}；文件：{}；严重程度：{}；建议：{}。",
                    finding.title, finding.file_path, finding.severity, finding.suggestion
                ))
            }
            "file" => {
                let (workspace_id, file_path) = context_file_id(&request.context_id)
                    .ok_or_else(|| anyhow!("文件上下文格式不正确：{}", request.context_id))?;
                let detail = storage::get_workspace(&self.database_path, &workspace_id)?;
                let file = detail
                    .files
                    .into_iter()
                    .find(|item| item.path == file_path)
                    .ok_or_else(|| anyhow!("未找到文件：{file_path}"))?;
                Ok(format!(
                    "文件：{}；语言：{}；行数：{}；复杂度：{}；风险：{}。",
                    file.path,
                    file.language,
                    file.metrics.total_lines,
                    file.metrics.complexity_score,
                    file.metrics.risk_count
                ))
            }
            "report" => {
                let report = storage::get_report(&self.database_path, &request.context_id)?;
                Ok(format!(
                    "报告：{}；类型：{}；摘要：{}。",
                    report.title, report.report_type, report.summary
                ))
            }
            _ => Ok("未选择具体上下文，按通用项目审查流程生成计划。".to_string()),
        }
    }

    fn chat_context(&self, request: &ChatStreamRequest) -> Option<String> {
        match (request.context_kind.as_deref(), request.context_id.as_deref()) {
            (Some("workspace"), Some(id)) => storage::get_workspace(&self.database_path, id)
                .ok()
                .map(|detail| {
                    format!(
                        "Workspace: {}\nRoot: {}\nFiles: {}\nLines: {}\nLanguages: {}\nHot files:\n{}",
                        detail.summary.name,
                        detail.summary.root_path,
                        detail.summary.file_count,
                        detail.summary.total_lines,
                        detail.summary.language_summary,
                        detail
                            .files
                            .iter()
                            .take(12)
                            .map(|file| format!(
                                "- {} ({}) complexity {} risks {}",
                                file.path,
                                file.language,
                                file.metrics.complexity_score,
                                file.metrics.risk_count
                            ))
                            .collect::<Vec<_>>()
                            .join("\n")
                    )
                }),
            (Some("file"), Some(id)) => context_file_id(id).and_then(|(workspace_id, file_path)| {
                storage::get_workspace(&self.database_path, &workspace_id)
                    .ok()
                    .and_then(|detail| {
                        detail
                            .files
                            .into_iter()
                            .find(|file| file.path == file_path)
                            .map(|file| {
                                format!(
                                    "File: {}\nLanguage: {}\nLines: {}\nComplexity: {}\n\n```text\n{}\n```",
                                    file.path,
                                    file.language,
                                    file.metrics.total_lines,
                                    file.metrics.complexity_score,
                                    file.content.chars().take(10_000).collect::<String>()
                                )
                            })
                    })
            }),
            (Some("finding"), Some(id)) => storage::list_findings(&self.database_path, None, None, None, None)
                .ok()
                .and_then(|items| {
                    items.into_iter().find(|item| item.id == id).map(|finding| {
                        format!(
                            "Finding: {}\nSeverity: {}\nCategory: {}\nFile: {}{}\nDetail: {}\nSuggestion: {}",
                            finding.title,
                            finding.severity,
                            finding.category,
                            finding.file_path,
                            finding
                                .line_start
                                .map(|line| format!(":{line}"))
                                .unwrap_or_default(),
                            finding.detail,
                            finding.suggestion
                        )
                    })
                }),
            (Some("report"), Some(id)) => storage::get_report(&self.database_path, id)
                .ok()
                .map(|report| format!("Report: {}\n{}\n\n{}", report.title, report.summary, report.full_report)),
            (Some("agent_task"), Some(id)) => storage::get_agent_task(&self.database_path, id)
                .ok()
                .map(|task| {
                    format!(
                        "Action Draft: {}\nStatus: {}\nSummary: {}\nSteps:\n{}\nOperations:\n{}",
                        task.title,
                        task.status,
                        task.summary,
                        task.steps
                            .iter()
                            .map(|step| format!("- {}. {}: {}", step.position, step.title, step.detail))
                            .collect::<Vec<_>>()
                            .join("\n"),
                        task.operations
                            .iter()
                            .map(|operation| format!("- {} [{}] {}", operation.path, operation.status, operation.preview))
                            .collect::<Vec<_>>()
                            .join("\n")
                    )
                }),
            _ => request.context_report_id.as_deref().and_then(|report_id| {
                storage::get_report(&self.database_path, report_id)
                    .ok()
                    .map(|report| report.summary)
            }),
        }
    }

    fn build_project_report(&self, request: &ProjectAnalyzeRequest) -> anyhow::Result<ReportDetail> {
        let report_id = Uuid::new_v4().to_string();
        let mut report_files = Vec::new();
        let mut all_risks = Vec::new();
        let mut languages = BTreeSet::new();
        let mut total_metrics = ReportMetrics {
            total_lines: 0,
            non_empty_lines: 0,
            comment_lines: 0,
            complexity_score: 0,
            risk_count: 0,
            suggestion_count: 0,
        };

        for file in &request.files {
            let language = file
                .language
                .as_deref()
                .filter(|value| !value.trim().is_empty() && *value != "auto")
                .map(str::to_string)
                .unwrap_or_else(|| analysis::detect_language(&file.content));
            languages.insert(language.clone());
            let metrics = analysis::metrics_for_code(&file.content);
            let risks = analysis::local_risks_for_code(&file.content);
            total_metrics.total_lines += metrics.total_lines;
            total_metrics.non_empty_lines += metrics.non_empty_lines;
            total_metrics.comment_lines += metrics.comment_lines;
            total_metrics.complexity_score += metrics.complexity_score;
            total_metrics.risk_count += risks.len();
            for risk in &risks {
                all_risks.push(format!("{}: {risk}", file.path));
            }
            report_files.push(ReportFile {
                id: Uuid::new_v4().to_string(),
                report_id: report_id.clone(),
                path: file.path.clone(),
                language,
                code_excerpt: analysis::code_excerpt(&file.content),
                metrics,
                risks,
            });
        }

        let suggestions = vec![
            "优先重构复杂度最高的文件。".to_string(),
            "围绕高风险分支和外部输入处理补充回归测试。".to_string(),
            "根据文件概览把审查工作拆成更小的检查点。".to_string(),
        ];
        total_metrics.suggestion_count = suggestions.len();
        let risk_count = all_risks.len();
        let risk_level = analysis::risk_level(risk_count, total_metrics.complexity_score).to_string();
        let language = if languages.len() == 1 {
            languages.into_iter().next().unwrap_or_else(|| "Plain Text".to_string())
        } else {
            "Mixed".to_string()
        };
        let title = request
            .title
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| format!("{} 项目分析", request.project_name));
        let summary = format!(
            "已分析 {} 个文件、{} 行有效代码，总复杂度评分为 {}，风险等级为 {}。",
            report_files.len(),
            total_metrics.non_empty_lines,
            total_metrics.complexity_score,
            risk_level
        );
        let full_report = render_project_local_report(&summary, &report_files, &all_risks, &suggestions);
        Ok(ReportDetail {
            id: report_id,
            title,
            language,
            code_excerpt: report_files
                .iter()
                .take(8)
                .map(|file| format!("{} ({})", file.path, file.language))
                .collect::<Vec<_>>()
                .join("\n"),
            summary,
            full_report,
            analysis_source: "local".to_string(),
            report_type: "project".to_string(),
            risk_level,
            file_count: report_files.len(),
            metadata_json: json!({
                "project_name": request.project_name,
                "workspace_id": request.workspace_id
            })
            .to_string(),
            risks: all_risks,
            suggestions,
            metrics: total_metrics,
            files: report_files,
            created_at: Utc::now().to_rfc3339(),
        })
    }

    async fn try_stream_llm_report<F>(
        &self,
        use_llm: bool,
        title: &str,
        prompt: &str,
        report: &mut ReportDetail,
        mut on_chunk: F,
    ) -> anyhow::Result<Vec<String>>
    where
        F: FnMut(&str) -> anyhow::Result<()> + Send,
    {
        let settings = self.settings()?;
        let api_key = storage::load_api_key(&self.database_path)?;
        let mut warnings = Vec::new();
        if use_llm && settings.llm_state == "configured" {
            if let Some(key) = api_key.filter(|value| !value.trim().is_empty()) {
                let messages = llm::report_messages(title, prompt);
                match llm::stream_chat(&settings, &key, &messages, |chunk| {
                    on_chunk(chunk)?;
                    Ok(())
                })
                .await
                {
                    Ok(text) => {
                        report.full_report = text;
                        report.analysis_source = "llm".to_string();
                        return Ok(warnings);
                    }
                    Err(err) => {
                        self.log_event("llm", &format!("streaming report failed: {err}"));
                        warnings.push(format!("LLM failed, local report was used: {err}"));
                        report.analysis_source = "local_fallback".to_string();
                    }
                }
            }
        } else if use_llm && settings.llm_state == "missing_key" {
            warnings.push("尚未配置 API Key；本次直接使用本地报告。".to_string());
        }

        stream_text(&report.full_report, &mut on_chunk)?;
        Ok(warnings)
    }

    fn apply_retry_report_id(
        &self,
        report: &mut ReportDetail,
        retry_report_id: Option<&str>,
    ) -> anyhow::Result<()> {
        let Some(id) = retry_report_id.map(str::trim).filter(|value| !value.is_empty()) else {
            return Ok(());
        };
        let existing = storage::get_report(&self.database_path, id)
            .with_context(|| format!("无法重试不存在的报告：{id}"))?;
        if existing.report_type != report.report_type {
            return Err(anyhow!(
                "重试报告类型不匹配：期望 {}，实际 {}。",
                report.report_type,
                existing.report_type
            ));
        }
        report.id = existing.id;
        report.created_at = existing.created_at;
        for file in &mut report.files {
            file.report_id = report.id.clone();
        }
        Ok(())
    }

    fn validate_project_retry_scope(
        &self,
        retry_report_id: Option<&str>,
        expected_workspace_id: Option<&str>,
    ) -> anyhow::Result<()> {
        let Some(id) = retry_report_id.map(str::trim).filter(|value| !value.is_empty()) else {
            return Ok(());
        };
        let existing = storage::get_report(&self.database_path, id)
            .with_context(|| format!("无法重试不存在的报告：{id}"))?;
        let existing_workspace_id = serde_json::from_str::<serde_json::Value>(
            &existing.metadata_json,
        )
        .ok()
        .and_then(|value| {
            value
                .get("workspace_id")
                .and_then(serde_json::Value::as_str)
                .map(str::to_string)
        });
        let expected_workspace_id = expected_workspace_id
            .map(str::trim)
            .filter(|value| !value.is_empty());
        if existing_workspace_id.as_deref() != expected_workspace_id {
            return Err(anyhow!("重试报告不属于当前工作区或项目作用域。"));
        }
        Ok(())
    }
}

fn append_log(path: &Path, area: &str, message: &str) -> anyhow::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let mut file = OpenOptions::new().create(true).append(true).open(path)?;
    writeln!(file, "{} [{}] {}", Utc::now().to_rfc3339(), area, message)?;
    Ok(())
}

fn stream_text<F>(value: &str, on_chunk: &mut F) -> anyhow::Result<()>
where
    F: FnMut(&str) -> anyhow::Result<()>,
{
    for chunk in value.as_bytes().chunks(480) {
        on_chunk(&String::from_utf8_lossy(chunk))?;
    }
    Ok(())
}

fn safe_log_token(value: &str) -> String {
    value
        .chars()
        .take(96)
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.' | ':') {
                character
            } else {
                '_'
            }
        })
        .collect()
}

fn chat_title(message: &str) -> String {
    let mut title = message.lines().next().unwrap_or("新对话").trim().to_string();
    if title.len() > 48 {
        title.truncate(48);
        title.push_str("...");
    }
    if title.is_empty() {
        "新对话".to_string()
    } else {
        title
    }
}

fn project_prompt(request: &ProjectAnalyzeRequest, report: &ReportDetail) -> String {
    let files = request
        .files
        .iter()
        .take(30)
        .map(|file| {
            format!(
                "File: {}\nLanguage: {}\n```text\n{}\n```",
                file.path,
                file.language.clone().unwrap_or_else(|| "auto".to_string()),
                file.content.chars().take(4_000).collect::<String>()
            )
        })
        .collect::<Vec<_>>()
        .join("\n\n");
    format!(
        "项目：{}\n本地摘要：{}\n本地风险：{}\n\n{}",
        request.project_name,
        report.summary,
        report.risks.iter().take(20).cloned().collect::<Vec<_>>().join("; "),
        files
    )
}

fn diff_prompt(request: &DiffAnalyzeRequest, report: &ReportDetail) -> String {
    format!(
        "本地摘要：{}\n本地风险：{}\n\n旧版本（{}）\n```text\n{}\n```\n\n新版本（{}）\n```text\n{}\n```",
        report.summary,
        report.risks.join("; "),
        request.before_label,
        request.before_code.chars().take(8_000).collect::<String>(),
        request.after_label,
        request.after_code.chars().take(8_000).collect::<String>()
    )
}

fn workspace_prompt(detail: &WorkspaceDetail, report: &ReportDetail) -> String {
    let files = detail
        .files
        .iter()
        .take(40)
        .map(|file| {
            format!(
                "- {}：{} 行，复杂度 {}，风险 {}，hash {}",
                file.path,
                file.metrics.total_lines,
                file.metrics.complexity_score,
                file.metrics.risk_count,
                file.content_hash
            )
        })
        .collect::<Vec<_>>()
        .join("\n");
    format!(
        "工作区：{}\n根目录：{}\n语言分布：{}\n本地摘要：{}\n本地风险：{}\n\n已索引文件：\n{}",
        detail.summary.name,
        detail.summary.root_path,
        detail.summary.language_summary,
        report.summary,
        report.risks.iter().take(30).cloned().collect::<Vec<_>>().join("; "),
        files
    )
}

fn context_file_id(value: &str) -> Option<(String, String)> {
    let (workspace_id, file_path) = value.split_once("::")?;
    if workspace_id.trim().is_empty() || file_path.trim().is_empty() {
        None
    } else {
        Some((workspace_id.to_string(), file_path.to_string()))
    }
}

fn workspace_id_from_report(report: &ReportDetail) -> Option<String> {
    let value = serde_json::from_str::<serde_json::Value>(&report.metadata_json).ok()?;
    value
        .get("workspace_id")
        .and_then(|item| item.as_str())
        .map(str::to_string)
}

fn stable_hash(value: &str) -> u64 {
    let mut hasher = DefaultHasher::new();
    value.hash(&mut hasher);
    hasher.finish()
}

fn safe_backup_name(value: &str) -> PathBuf {
    let cleaned = value
        .chars()
        .map(|ch| match ch {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
            ch if ch.is_control() => '_',
            ch => ch,
        })
        .collect::<String>();
    PathBuf::from(if cleaned.is_empty() { "agent-backup.txt".to_string() } else { cleaned })
}

fn safe_agent_target(root: &Path, operation_path: &str) -> anyhow::Result<PathBuf> {
    let root = root.canonicalize().unwrap_or_else(|_| root.to_path_buf());
    let relative = Path::new(operation_path);
    if relative.is_absolute() || operation_path.contains("..") {
        return Err(anyhow!("拒绝应用不安全路径：{operation_path}"));
    }
    let target = root.join(relative);
    if !target.starts_with(&root) {
        return Err(anyhow!("目标路径不在工作区内：{}", target.display()));
    }
    Ok(target)
}

fn render_agent_operation_markdown(goal: &str, context_summary: &str, selected_file_paths: &[String]) -> String {
    let files = if selected_file_paths.is_empty() {
        "- 暂未选择候选文件，请在写入前人工确认上下文。".to_string()
    } else {
        selected_file_paths
            .iter()
            .map(|path| format!("- {path}"))
            .collect::<Vec<_>>()
            .join("\n")
    };
    format!(
        "# 行动执行草稿\n\n## 目标\n{goal}\n\n## 上下文摘要\n{context_summary}\n\n## 候选文件\n{files}\n\n## 建议执行步骤\n1. 先阅读候选文件，确认问题是否可复现。\n2. 小步修改，避免一次性重构多个模块。\n3. 为核心路径补充成功和失败用例。\n4. 运行本地测试、前端构建和隔离检查。\n\n## 安全边界\n本文件由 CodeLens Pro Next v1.0 在用户确认后写入。真正修改业务文件前，请先复制本草稿中的步骤并人工确认影响范围。\n"
    )
}

fn render_agent_checklist_markdown(goal: &str, steps: &[AgentStep], selected_file_paths: &[String]) -> String {
    let files = if selected_file_paths.is_empty() {
        "- [ ] 人工补充需要阅读的候选文件".to_string()
    } else {
        selected_file_paths
            .iter()
            .map(|path| format!("- [ ] 阅读 `{path}`"))
            .collect::<Vec<_>>()
            .join("\n")
    };
    let step_checks = steps
        .iter()
        .map(|step| format!("- [ ] {}：{}", step.title, step.detail.replace('\n', " ")))
        .collect::<Vec<_>>()
        .join("\n");
    format!(
        "# 行动草稿确认清单\n\n## 目标\n{goal}\n\n## 上下文确认\n{files}\n\n## 步骤确认\n{step_checks}\n\n## 写入前检查\n- [ ] 确认本任务不会越界修改无关文件。\n- [ ] 确认已经理解回滚方式和备份目录。\n- [ ] 确认需要运行的测试或构建命令。\n\n## 写入后验证\n- [ ] 运行相关测试或构建。\n- [ ] 检查页面中文文案和关键交互。\n- [ ] 将结论写入每日日志或知识卡片。\n\n## 回滚提示\n如果写入结果不符合预期，优先在 CodeLens Pro Next 的行动草稿操作中执行回滚；若备份文件存在，也可以人工恢复备份。\n"
    )
}

fn render_agent_context_manifest(
    task_id: &str,
    request: &AgentPlanRequest,
    goal: &str,
    context_summary: &str,
    selected_file_paths: &[String],
    generated_at: &str,
) -> anyhow::Result<String> {
    Ok(serde_json::to_string_pretty(&json!({
        "product": "CodeLens Pro Next",
        "kind": "agent_context_manifest",
        "task_id": task_id,
        "goal": goal,
        "context_kind": &request.context_kind,
        "context_id": &request.context_id,
        "context_summary": context_summary,
        "selected_file_paths": selected_file_paths,
        "generated_at": generated_at,
        "safety": {
            "requires_manual_confirmation": true,
            "business_files_are_not_modified_by_default": true,
            "writes_are_limited_to_codelens_agent_directory": true
        }
    }))?)
}

fn render_local_card_material(card: &LearningCard) -> String {
    let tags = if card.tags.is_empty() {
        "未设置标签".to_string()
    } else {
        card.tags.join("、")
    };
    format!(
        "# {}\n\n## 学习目标\n理解这张卡片背后的代码审查知识点，并能在自己的项目中识别类似问题。\n\n## 原始内容\n{}\n\n## 复习提示\n- 先用自己的话解释问题发生的位置和影响。\n- 找一个相似文件，检查是否存在同类模式。\n- 写一个最小测试或检查步骤，验证修复后行为没有回退。\n\n## 标签\n{}\n",
        card.title, card.content, tags
    )
}

fn render_learning_cards_markdown(
    cards: &[LearningCard],
    materials: &[CardMaterial],
    status: Option<&str>,
    tag: Option<&str>,
) -> String {
    let generated_at = Utc::now().to_rfc3339();
    let status_label = status
        .filter(|value| !value.is_empty() && *value != "all")
        .map(card_status_label)
        .unwrap_or("全部状态");
    let tag_label = tag.filter(|value| !value.is_empty()).unwrap_or("全部标签");
    let mut output = format!(
        "# CodeLens Pro Next 知识卡片组\n\n- 导出时间：{}\n- 状态筛选：{}\n- 标签筛选：{}\n- 卡片数量：{}\n\n",
        generated_at,
        status_label,
        tag_label,
        cards.len()
    );
    if cards.is_empty() {
        output.push_str("当前筛选条件下没有知识卡片。\n");
        return output;
    }
    for (index, card) in cards.iter().enumerate() {
        let tags = if card.tags.is_empty() {
            "未设置标签".to_string()
        } else {
            card.tags.join("、")
        };
        let source = if card.finding_id.is_some() {
            "问题来源"
        } else if card.workspace_id.is_some() {
            "项目来源"
        } else {
            "手动创建"
        };
        output.push_str(&format!(
            "## {}. {}\n\n- 状态：{}\n- 来源：{}\n- 标签：{}\n- 创建时间：{}\n- 更新时间：{}\n\n{}\n\n",
            index + 1,
            card.title,
            card_status_label(&card.status),
            source,
            tags,
            card.created_at,
            card.updated_at,
            card.content
        ));
        let related_materials = materials
            .iter()
            .filter(|material| material.card_id == card.id)
            .take(3)
            .collect::<Vec<_>>();
        if !related_materials.is_empty() {
            output.push_str("### 已生成学习材料\n\n");
            for material in related_materials {
                output.push_str(&format!(
                    "- {}（{}，{}）\n",
                    material.title,
                    material.source,
                    material.created_at
                ));
            }
            output.push('\n');
        }
    }
    output
}

fn card_status_label(value: &str) -> &str {
    match value {
        "new" => "未掌握",
        "reviewing" => "复习中",
        "mastered" => "已掌握",
        _ => value,
    }
}

fn render_daily_log(summary: &DailySummary) -> String {
    let highlights = summary
        .highlights
        .iter()
        .map(|item| format!("- {item}"))
        .collect::<Vec<_>>()
        .join("\n");
    format!(
        "# {} 学习日志\n\n## 今日数据\n- 报告：{} 份\n- 对话消息：{} 条\n- 新增问题：{} 个\n- 知识卡片：{} 张\n- 行动草稿：{} 个\n- 活动记录：{} 条\n\n## 关键活动\n{}\n\n## 今日复盘\n今天的重点是把代码审查结果继续沉淀为可复用知识。建议从最高风险问题或最新报告中选择 1 个点做深入复习，并确认是否已经形成问题、卡片或日志记录。\n\n## 明日建议\n- 复查未解决问题清单。\n- 从一张未掌握卡片开始复习。\n- 必要时把复杂问题整理成确认式行动草稿；默认只写入 `.codelens-agent`。\n",
        summary.date,
        summary.report_count,
        summary.chat_message_count,
        summary.finding_count,
        summary.card_count,
        summary.agent_task_count,
        summary.activity_count,
        highlights
    )
}

fn render_daily_log_export(log: &DailyLog) -> String {
    format!(
        "# {}\n\n- 日期：{}\n- 创建时间：{}\n- 更新时间：{}\n\n{}\n",
        log.title,
        log.date,
        log.created_at,
        log.updated_at,
        log.content
    )
}

fn build_project_guide(detail: &WorkspaceDetail, code_map: &CodeMap) -> ProjectGuide {
    let generated_at = Utc::now().to_rfc3339();
    let languages = code_map
        .languages
        .iter()
        .map(|item| format!("{} {} 个文件", item.language, item.file_count))
        .collect::<Vec<_>>()
        .join("，");
    let architecture = code_map
        .languages
        .iter()
        .map(|item| ProjectGuideItem {
            title: format!("{} 模块面", item.language),
            detail: format!(
                "当前工作区中有 {} 个 {} 文件，共 {} 行。建议先按语言边界理解入口、数据流和测试位置。",
                item.file_count, item.language, item.total_lines
            ),
            path: None,
        })
        .collect::<Vec<_>>();
    let reading_order = code_map
        .hotspot_files
        .iter()
        .take(8)
        .enumerate()
        .map(|(index, file)| ProjectGuideItem {
            title: format!("第 {} 步：阅读 {}", index + 1, file.path),
            detail: format!(
                "该文件复杂度 {}，风险 {}。先看入口函数和外部依赖，再看异常分支。",
                file.complexity_score, file.risk_count
            ),
            path: Some(file.path.clone()),
        })
        .collect::<Vec<_>>();
    let key_files = detail
        .files
        .iter()
        .take(10)
        .map(|file| ProjectGuideItem {
            title: file.path.clone(),
            detail: format!(
                "{} 文件，{} 行，复杂度 {}，风险 {}。",
                file.language, file.metrics.total_lines, file.metrics.complexity_score, file.metrics.risk_count
            ),
            path: Some(file.path.clone()),
        })
        .collect::<Vec<_>>();
    ProjectGuide {
        workspace_id: detail.summary.id.clone(),
        title: format!("{} 项目导览", detail.summary.name),
        summary: format!(
            "{} 包含 {} 个文件、{} 行代码。语言分布：{}。导览基于本地轻量索引生成，适合快速讲清项目结构和阅读顺序。",
            detail.summary.name,
            detail.summary.file_count,
            detail.summary.total_lines,
            if languages.is_empty() { detail.summary.language_summary.clone() } else { languages }
        ),
        architecture,
        reading_order,
        key_files,
        generated_at,
    }
}

fn render_project_local_report(
    summary: &str,
    files: &[ReportFile],
    risks: &[String],
    suggestions: &[String],
) -> String {
    let file_lines = files
        .iter()
        .map(|file| {
            format!(
                "- {}：{} 行，复杂度 {}，风险 {}",
                file.path, file.metrics.total_lines, file.metrics.complexity_score, file.risks.len()
            )
        })
        .collect::<Vec<_>>()
        .join("\n");
    let risk_lines = risks
        .iter()
        .take(40)
        .map(|item| format!("- {item}"))
        .collect::<Vec<_>>()
        .join("\n");
    let suggestion_lines = suggestions
        .iter()
        .map(|item| format!("- {item}"))
        .collect::<Vec<_>>()
        .join("\n");

    format!(
        "# 项目分析报告\n\n## 摘要\n{summary}\n\n## 文件概览\n{file_lines}\n\n## 主要风险\n{risk_lines}\n\n## 优先建议\n{suggestion_lines}\n"
    )
}

fn safe_file_stem(value: &str) -> String {
    let cleaned = value
        .chars()
        .map(|ch| match ch {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
            ch if ch.is_control() => '_',
            ch => ch,
        })
        .collect::<String>()
        .trim()
        .trim_matches('.')
        .to_string();

    if cleaned.is_empty() {
        "report".to_string()
    } else {
        cleaned.chars().take(80).collect()
    }
}

fn normalized_optional(value: Option<String>) -> Option<String> {
    value
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
}

fn invalid_bridge_inbox_request(path: &Path, error: String) -> WorkspaceBridgeInboxRequest {
    let id = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("invalid-request")
        .to_string();
    WorkspaceBridgeInboxRequest {
        id,
        source: "解析失败".to_string(),
        workspace_id: None,
        context_kind: "invalid".to_string(),
        context_id: "invalid".to_string(),
        goal: "该桥接请求无法解析，请检查 JSON 格式。".to_string(),
        selected_file_paths: Vec::new(),
        created_at: fs::metadata(path)
            .and_then(|metadata| metadata.modified())
            .ok()
            .map(|time| chrono::DateTime::<Utc>::from(time).to_rfc3339())
            .unwrap_or_else(|| Utc::now().to_rfc3339()),
        file_path: path.display().to_string(),
        status: "invalid".to_string(),
        error: Some(error),
    }
}

fn render_workspace_bridge_inbox_readme() -> &'static str {
    r#"# CodeLens Pro Next 桥接收件箱

外部编辑器或本地脚本可以把 JSON 请求写入本目录，桌面端会在行动草稿页的高级区域中读取这些请求，并由用户确认后生成行动草稿。

## 请求示例

```json
{
  "schema": "codelens.bridge_inbox.v1",
  "id": "optional-stable-id",
  "source": "VS Code",
  "workspace_id": "可选：CodeLens 工作区 ID",
  "context_kind": "workspace",
  "context_id": "工作区、文件、问题或报告 ID",
  "goal": "请基于当前文件生成重构计划",
  "selected_file_paths": ["src/main.ts"],
  "created_at": "2026-07-07T10:00:00+08:00"
}
```

## 安全约定

- 收件箱请求只会生成行动草稿，不会直接修改用户项目。
- `selected_file_paths` 最多取前 12 个文件作为上下文。
- 处理后的请求会移动到 `storage/bridge/processed/`。
- API Key、密钥和源码正文不应写入该 JSON。
"#
}

fn render_workspace_bridge_readme(status: &WorkspaceBridgeStatus, generated_at: &str) -> String {
    let selected_files = if status.selected_file_paths.is_empty() {
        "- 暂未选择文件".to_string()
    } else {
        status
            .selected_file_paths
            .iter()
            .map(|path| format!("- `{path}`"))
            .collect::<Vec<_>>()
            .join("\n")
    };
    let candidate_files = status
        .candidate_files
        .iter()
        .take(20)
        .map(|file| {
            format!(
                "- `{}`：{}，{} 行，复杂度 {}，风险 {}{}",
                file.path,
                file.language,
                file.total_lines,
                file.complexity_score,
                file.risk_count,
                if file.selected { "，已选中" } else { "" }
            )
        })
        .collect::<Vec<_>>()
        .join("\n");

    format!(
        "# CodeLens Pro Next 工作区桥接清单\n\n生成时间：{generated_at}\n\n## 工作区\n- 名称：{}\n- 路径：{}\n- 状态：{}\n- 桥接版本：{}\n- 最近心跳：{}\n- 最近同步：{}\n\n## 已选择的行动草稿上下文文件\n{}\n\n## 候选文件 Top 20\n{}\n\n## 给外部编辑器或本地脚本的约定\n- `manifest.json` 是机器可读清单，可读取 `selected_file_paths` 作为行动草稿上下文入口。\n- 最新清单会同步到 `storage/bridge/current/manifest.json`，外部工具可以固定读取这个路径。\n- 该清单只包含路径、语言、行数、复杂度和风险计数，不包含源码正文。\n- 外部工具可以根据路径打开真实项目文件，但写入前应回到 CodeLens Pro Next 的行动草稿页做人工确认。\n- 当前桌面端不会主动修改导入项目，除非用户在行动草稿页勾选并确认文件操作。\n",
        status.workspace_name,
        status.workspace_root,
        status.status,
        status.plugin_version,
        if status.heartbeat_at.is_empty() { "暂无" } else { &status.heartbeat_at },
        status.updated_at,
        selected_files,
        if candidate_files.is_empty() { "- 暂无候选文件".to_string() } else { candidate_files }
    )
}

fn render_product_archive_index(manifest: &serde_json::Value, generated_at: &str) -> String {
    let counts = &manifest["counts"];
    let latest_report = manifest["reports"]
        .as_array()
        .and_then(|items| items.first())
        .map(|item| {
            format!(
                "{}｜{}｜{}",
                item["title"].as_str().unwrap_or("未命名报告"),
                item["report_type"].as_str().unwrap_or("报告"),
                item["created_at"].as_str().unwrap_or("")
            )
        })
        .unwrap_or_else(|| "暂无报告".to_string());
    let latest_workspace = manifest["workspaces"]
        .as_array()
        .and_then(|items| items.first())
        .map(|item| {
            let summary = &item["summary"];
            format!(
                "{}｜{} 个文件｜{}",
                summary["name"].as_str().unwrap_or("未命名工作区"),
                summary["file_count"].as_u64().unwrap_or(0),
                summary["root_path"].as_str().unwrap_or("")
            )
        })
        .unwrap_or_else(|| "暂无工作区".to_string());
    let unresolved_findings = manifest["findings"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|item| {
            let status = item["status"].as_str().unwrap_or("open");
            status != "resolved" && status != "ignored"
        })
        .count();
    let pending_action_drafts = manifest["agent_tasks"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|item| {
            let status = item["status"].as_str().unwrap_or("planned");
            status != "applied" && status != "rolled_back"
        })
        .count();
    let latest_log = manifest["daily_logs"]
        .as_array()
        .and_then(|items| items.first())
        .map(|item| format!("{}｜{}", item["date"].as_str().unwrap_or(""), item["title"].as_str().unwrap_or("未命名日志")))
        .unwrap_or_else(|| "暂无每日日志".to_string());
    let reports = manifest["reports"]
        .as_array()
        .into_iter()
        .flatten()
        .take(12)
        .map(|item| {
            format!(
                "- {}｜{}｜{}",
                item["title"].as_str().unwrap_or("未命名报告"),
                item["report_type"].as_str().unwrap_or("报告"),
                item["created_at"].as_str().unwrap_or("")
            )
        })
        .collect::<Vec<_>>()
        .join("\n");
    let workspaces = manifest["workspaces"]
        .as_array()
        .into_iter()
        .flatten()
        .take(12)
        .map(|item| {
            let summary = &item["summary"];
            format!(
                "- {}｜{} 个文件｜{}",
                summary["name"].as_str().unwrap_or("未命名工作区"),
                summary["file_count"].as_u64().unwrap_or(0),
                summary["root_path"].as_str().unwrap_or("")
            )
        })
        .collect::<Vec<_>>()
        .join("\n");
    let gaps = manifest["traceability"]["gaps"]
        .as_array()
        .into_iter()
        .flatten()
        .take(8)
        .map(|item| format!("- {}", item.as_str().unwrap_or("")))
        .collect::<Vec<_>>()
        .join("\n");
    let next_actions = manifest["traceability"]["next_actions"]
        .as_array()
        .into_iter()
        .flatten()
        .take(8)
        .map(|item| format!("- {}", item.as_str().unwrap_or("")))
        .collect::<Vec<_>>()
        .join("\n");
    format!(
        "# CodeLens Pro Next 本地产品档案\n\n生成时间：{generated_at}\n\n## 数据总览\n- 工作区：{}\n- 报告：{}\n- 问题：{}\n- 知识卡片：{}\n- AI 对话：{}\n- 每日日志：{}\n- 行动草稿：{}\n- 活动记录：{}\n\n## 主线闭环状态\n- 最近工作区：{}\n- 最新报告：{}\n- 未解决问题：{} 个\n- 知识卡片：{} 张\n- 最新日志：{}\n- 待确认行动草稿：{} 个\n\n## 最近报告\n{}\n\n## 工作区\n{}\n\n## 闭环缺口\n{}\n\n## 下一步动作\n{}\n\n## 文件说明\n- `manifest.json`：完整结构化数据，未包含 API Key 明文。\n- `index.md`：当前人工可读摘要。\n",
        counts["workspaces"].as_u64().unwrap_or(0),
        counts["reports"].as_u64().unwrap_or(0),
        counts["findings"].as_u64().unwrap_or(0),
        counts["cards"].as_u64().unwrap_or(0),
        counts["chats"].as_u64().unwrap_or(0),
        counts["daily_logs"].as_u64().unwrap_or(0),
        counts["agent_tasks"].as_u64().unwrap_or(0),
        counts["activity_events"].as_u64().unwrap_or(0),
        latest_workspace,
        latest_report,
        unresolved_findings,
        counts["cards"].as_u64().unwrap_or(0),
        latest_log,
        pending_action_drafts,
        if reports.is_empty() { "- 暂无报告".to_string() } else { reports },
        if workspaces.is_empty() { "- 暂无工作区".to_string() } else { workspaces },
        if gaps.is_empty() { "- 暂无明显缺口".to_string() } else { gaps },
        if next_actions.is_empty() { "- 暂无建议动作".to_string() } else { next_actions },
    )
}

fn render_markdown_export(report: &ReportDetail) -> String {
    let risks = report
        .risks
        .iter()
        .map(|item| format!("- {item}"))
        .collect::<Vec<_>>()
        .join("\n");
    let suggestions = report
        .suggestions
        .iter()
        .map(|item| format!("- {item}"))
        .collect::<Vec<_>>()
        .join("\n");
    let files = report
        .files
        .iter()
        .map(|file| {
            format!(
                "- {} ({}) lines={}, complexity={}",
                file.path, file.language, file.metrics.total_lines, file.metrics.complexity_score
            )
        })
        .collect::<Vec<_>>()
        .join("\n");

    format!(
        "# {}\n\n- 类型：{}\n- 风险：{}\n- 语言：{}\n- 来源：{}\n- 创建时间：{}\n\n## 摘要\n{}\n\n## 文件\n{}\n\n## 指标\n- 总行数：{}\n- 有效行：{}\n- 注释行：{}\n- 复杂度评分：{}\n\n## 风险点\n{}\n\n## 建议\n{}\n\n## 完整报告\n{}\n",
        report.title,
        report.report_type,
        report.risk_level,
        report.language,
        report.analysis_source,
        report.created_at,
        report.summary,
        if files.is_empty() { "- 暂无文件详情".to_string() } else { files },
        report.metrics.total_lines,
        report.metrics.non_empty_lines,
        report.metrics.comment_lines,
        report.metrics.complexity_score,
        risks,
        suggestions,
        report.full_report
    )
}

fn render_agent_task_markdown(task: &AgentTask) -> String {
    let selected_files = task
        .selected_file_paths
        .iter()
        .map(|path| format!("- `{path}`"))
        .collect::<Vec<_>>()
        .join("\n");
    let steps = task
        .steps
        .iter()
        .map(|step| {
            format!(
                "### {}. {}\n\n{}\n\n- 风险：{}\n- 建议补丁：{}\n- 状态：{}",
                step.position, step.title, step.detail, step.risk, step.suggested_patch, step.status
            )
        })
        .collect::<Vec<_>>()
        .join("\n\n");
    let operations = task
        .operations
        .iter()
        .map(|operation| {
            format!(
                "### {}\n\n- 路径：`{}`\n- 类型：{}\n- 状态：{}\n- 已确认：{}\n- 备份：{}\n- 写入时间：{}\n- 错误：{}\n\n{}\n\n```text\n{}\n```",
                operation.title,
                operation.path,
                operation.operation,
                operation.status,
                if operation.confirmed { "是" } else { "否" },
                operation.backup_path.as_deref().unwrap_or("暂无"),
                operation.applied_at.as_deref().unwrap_or("暂无"),
                operation.error.as_deref().unwrap_or("无"),
                operation.preview,
                operation.replacement
            )
        })
        .collect::<Vec<_>>()
        .join("\n\n");

    format!(
        "# {}\n\n- 上下文类型：{}\n- 上下文 ID：{}\n- 状态：{}\n- 创建时间：{}\n- 更新时间：{}\n\n## 摘要\n{}\n\n## 写入结果\n{}\n\n## 上下文文件\n{}\n\n## 执行步骤\n{}\n\n## 待确认文件操作\n{}\n\n## 人工检查清单\n- 确认上下文文件确实覆盖本次问题范围。\n- 确认每个文件操作只写入预期路径，且没有越权路径。\n- 写入后检查备份路径和错误信息。\n- 真正修改业务代码前，先运行对应测试、构建和隔离检查。\n",
        task.title,
        task.context_kind,
        task.context_id,
        task.status,
        task.created_at,
        task.updated_at,
        task.summary,
        if task.apply_summary.is_empty() { "尚未写入任何操作。".to_string() } else { task.apply_summary.clone() },
        if selected_files.is_empty() { "- 暂无上下文文件".to_string() } else { selected_files },
        if steps.is_empty() { "暂无步骤。".to_string() } else { steps },
        if operations.is_empty() { "暂无文件操作。".to_string() } else { operations }
    )
}

fn render_html_export(report: &ReportDetail) -> String {
    let body = render_markdown_export(report)
        .lines()
        .map(|line| {
            if let Some(text) = line.strip_prefix("# ") {
                format!("<h1>{}</h1>", html_escape(text))
            } else if let Some(text) = line.strip_prefix("## ") {
                format!("<h2>{}</h2>", html_escape(text))
            } else if let Some(text) = line.strip_prefix("- ") {
                format!("<li>{}</li>", html_escape(text))
            } else if line.trim().is_empty() {
                String::new()
            } else {
                format!("<p>{}</p>", html_escape(line))
            }
        })
        .collect::<Vec<_>>()
        .join("\n");
    format!(
        "<!doctype html><html><head><meta charset=\"utf-8\"><title>{}</title><style>body{{font-family:Segoe UI,Arial,sans-serif;max-width:960px;margin:40px auto;line-height:1.6;color:#172033}}h1,h2{{color:#0f766e}}li{{margin:4px 0}}code,pre{{background:#f3f4f6;padding:2px 4px;border-radius:4px}}</style></head><body>{}</body></html>",
        html_escape(&report.title),
        body
    )
}

fn html_escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

fn manifest_vec<T: DeserializeOwned>(manifest: &Value, key: &str) -> anyhow::Result<Vec<T>> {
    match manifest.get(key) {
        Some(value) => serde_json::from_value(value.clone())
            .with_context(|| format!("failed to parse archive field {key}")),
        None => Ok(Vec::new()),
    }
}

impl CoreApp {
    fn backup_database(&self, label: &str) -> anyhow::Result<PathBuf> {
        let backup_dir = self.storage_dir.join("backups");
        fs::create_dir_all(&backup_dir)
            .with_context(|| format!("failed to create backup dir {}", backup_dir.display()))?;
        let backup_path = backup_dir.join(format!(
            "codelens-next-{}-{}.sqlite",
            label,
            Utc::now().format("%Y%m%d-%H%M%S")
        ));
        if self.database_path.exists() {
            fs::copy(&self.database_path, &backup_path).with_context(|| {
                format!(
                    "failed to backup database from {} to {}",
                    self.database_path.display(),
                    backup_path.display()
                )
            })?;
        } else {
            fs::write(&backup_path, b"").with_context(|| {
                format!("failed to create empty backup {}", backup_path.display())
            })?;
        }
        Ok(backup_path)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_root() -> PathBuf {
        if let Ok(root) = std::env::var("CODELENS_TEST_ROOT") {
            return PathBuf::from(root).join(uuid::Uuid::new_v4().to_string());
        }
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("..")
            .join(".cache")
            .join("core-tests")
            .join(uuid::Uuid::new_v4().to_string())
    }

    #[test]
    fn initializes_storage_and_logs() {
        let root = test_root();
        let app = CoreApp::initialize(&root).expect("core app initializes");
        assert!(app.storage_dir_path().exists());
        assert!(app.logs_dir_path().join("codelens-next.log").exists());
        let connection = rusqlite::Connection::open(&app.database_path).expect("open database");
        let version: i64 = connection
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .expect("user_version");
        assert_eq!(version, 6);
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn saves_settings_without_exposing_key() {
        let root = test_root();
        let app = CoreApp::initialize(&root).expect("core app initializes");
        let settings = app
            .save_settings(SettingsUpdate {
                enable_llm: true,
                api_base: "https://example.test/v1".to_string(),
                model: "sample-model".to_string(),
                api_key: Some("secret-key".to_string()),
                clear_api_key: false,
            })
            .expect("settings save");

        assert!(settings.enable_llm);
        assert!(settings.api_key_set);
        assert_eq!(settings.model, "sample-model");
        let profiles = app.list_model_profiles().expect("model profiles");
        assert!(profiles.iter().any(|item| item.model == "deepseek-chat"));
        let profile = app
            .save_model_profile(ModelProfileInput {
                id: None,
                name: "长期本地使用".to_string(),
                api_base: "https://models.example/v1".to_string(),
                model: "review-model".to_string(),
                note: "不保存 API Key 的模型档案。".to_string(),
                is_default: true,
            })
            .expect("save model profile");
        assert_eq!(profile.model, "review-model");
        let profiles = app.list_model_profiles().expect("model profiles after save");
        assert!(profiles.iter().any(|item| item.is_default && item.id == profile.id));
        let profiles = app
            .delete_model_profile(profile.id.clone())
            .expect("delete model profile");
        assert!(!profiles.iter().any(|item| item.id == profile.id));
        let log_text = fs::read_to_string(app.logs_dir_path().join("codelens-next.log")).unwrap();
        assert!(!log_text.contains("secret-key"));
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn validates_settings_transactionally_and_preserves_existing_key() {
        let root = test_root();
        let app = CoreApp::initialize(&root).expect("core app initializes");

        let missing_key = app.save_settings(SettingsUpdate {
            enable_llm: true,
            api_base: "https://example.test/v1".to_string(),
            model: "review-model".to_string(),
            api_key: None,
            clear_api_key: false,
        });
        assert!(missing_key.is_err());
        assert_eq!(app.settings().expect("default settings").llm_state, "disabled");

        let configured = app
            .save_settings(SettingsUpdate {
                enable_llm: true,
                api_base: "https://example.test/v1".to_string(),
                model: "review-model".to_string(),
                api_key: Some("stored-secret".to_string()),
                clear_api_key: false,
            })
            .expect("valid settings");
        assert_eq!(configured.llm_state, "configured");

        let retained = app
            .save_settings(SettingsUpdate {
                enable_llm: true,
                api_base: "https://draft.example/v1".to_string(),
                model: "draft-model".to_string(),
                api_key: Some("   ".to_string()),
                clear_api_key: false,
            })
            .expect("blank key retains stored key");
        assert!(retained.api_key_set);
        assert_eq!(retained.model, "draft-model");
        let explicit_blank_key = futures::executor::block_on(app.test_llm_connection(
            LlmTestRequest {
                api_base: retained.api_base.clone(),
                model: retained.model.clone(),
                api_key: Some(String::new()),
            },
        ))
        .expect("test explicit blank key");
        assert!(!explicit_blank_key.ok);
        assert_eq!(explicit_blank_key.error_code.as_deref(), Some("configuration"));

        let reopened = CoreApp::initialize(&root).expect("reopen configured app");
        let persisted = reopened.settings().expect("persisted settings");
        assert_eq!(persisted.llm_state, "configured");
        assert_eq!(persisted.api_base, "https://draft.example/v1");
        assert_eq!(persisted.model, "draft-model");

        for (api_base, model) in [
            ("file:///tmp/model", "draft-model"),
            ("https://draft.example/v1", ""),
        ] {
            assert!(app
                .save_settings(SettingsUpdate {
                    enable_llm: true,
                    api_base: api_base.to_string(),
                    model: model.to_string(),
                    api_key: None,
                    clear_api_key: false,
                })
                .is_err());
        }
        let after_failed_updates = app.settings().expect("settings after rollback");
        assert_eq!(after_failed_updates.api_base, "https://draft.example/v1");
        assert_eq!(after_failed_updates.model, "draft-model");

        let cleared = app
            .save_settings(SettingsUpdate {
                enable_llm: true,
                api_base: after_failed_updates.api_base,
                model: after_failed_updates.model,
                api_key: None,
                clear_api_key: true,
            })
            .expect("clear key");
        assert!(!cleared.enable_llm);
        assert!(!cleared.api_key_set);
        assert_eq!(cleared.llm_state, "disabled");
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn saves_chat_exchange_atomically() {
        let root = test_root();
        let app = CoreApp::initialize(&root).expect("core app initializes");
        let session_id = storage::save_chat_exchange(
            &app.database_path,
            None,
            "原子对话".to_string(),
            None,
            "用户问题",
            "助手回答",
        )
        .expect("save exchange");
        let session = app.get_chat_session(session_id).expect("load session");
        assert_eq!(session.messages.len(), 2);
        assert_eq!(session.messages[0].role, "user");
        assert_eq!(session.messages[1].role, "assistant");

        assert!(storage::save_chat_exchange(
            &app.database_path,
            None,
            "不完整对话".to_string(),
            None,
            "用户问题",
            "",
        )
        .is_err());
        assert_eq!(app.list_chat_sessions(None).expect("sessions").len(), 1);
        fs::remove_dir_all(root).ok();
    }

    #[tokio::test(flavor = "current_thread")]
    async fn model_failure_falls_back_for_review_without_saving_partial_chat() {
        let root = test_root();
        let app = CoreApp::initialize(&root).expect("core app initializes");
        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("reserve local port");
        let address = listener.local_addr().expect("local address");
        drop(listener);
        app.save_settings(SettingsUpdate {
            enable_llm: true,
            api_base: format!("http://{address}/v1"),
            model: "unavailable-model".to_string(),
            api_key: Some("test-only-key".to_string()),
            clear_api_key: false,
        })
        .expect("save unavailable mock settings");

        let review = app
            .analyze_code(AnalysisRequest {
                code: "function sample() { return 1; }".to_string(),
                language: Some("TypeScript".to_string()),
                title: None,
                source_label: Some("src/sample.ts".to_string()),
                mode_group: Some("function".to_string()),
                mode: Some("risk_review".to_string()),
                mode_label: Some("风险审查".to_string()),
                use_llm: Some(true),
                retry_report_id: None,
            })
            .await
            .expect("review falls back");
        assert_eq!(review.report.analysis_source, "local_fallback");
        assert!(!review.warnings.is_empty());

        let chat = app
            .send_chat_message_stream(
                ChatStreamRequest {
                    session_id: None,
                    message: "this prompt must not be persisted".to_string(),
                    context_report_id: None,
                    context_kind: None,
                    context_id: None,
                },
                |_| Ok(()),
            )
            .await;
        assert!(chat.is_err());
        assert!(app.list_chat_sessions(None).expect("chat sessions").is_empty());
        let log_text = fs::read_to_string(app.logs_dir_path().join("codelens-next.log"))
            .expect("read log");
        assert!(!log_text.contains("this prompt must not be persisted"));
        assert!(!log_text.contains("test-only-key"));
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn retry_overwrites_same_report_id_without_creating_duplicate() {
        let root = test_root();
        let app = CoreApp::initialize(&root).expect("core app initializes");
        let request = |code: &str, retry_report_id: Option<String>| AnalysisRequest {
            code: code.to_string(),
            language: Some("TypeScript".to_string()),
            title: Some("可重试报告".to_string()),
            source_label: Some("src/retry.ts".to_string()),
            mode_group: Some("function".to_string()),
            mode: Some("risk_review".to_string()),
            mode_label: Some("风险审查".to_string()),
            use_llm: Some(false),
            retry_report_id,
        };
        let first = futures::executor::block_on(app.analyze_code(request("const a = 1;", None)))
            .expect("first report")
            .report;
        let retried = futures::executor::block_on(app.analyze_code(request(
            "const a = unsafeInput;",
            Some(first.id.clone()),
        )))
        .expect("retried report")
        .report;
        assert_eq!(retried.id, first.id);
        assert_eq!(app.list_reports(None).expect("reports").len(), 1);
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn exports_report_markdown_and_html() {
        let root = test_root();
        let app = CoreApp::initialize(&root).expect("core app initializes");
        let report = analysis::analyze_locally(&AnalysisRequest {
            code: "function sample() { return 1; }".to_string(),
            language: Some("JavaScript".to_string()),
            title: Some("样例报告".to_string()),
            source_label: None,
            mode_group: Some("function".to_string()),
            mode: Some("risk_review".to_string()),
            mode_label: Some("风险审查".to_string()),
            use_llm: Some(false),
            retry_report_id: None,
        });
        storage::save_report(&app.database_path, &report).expect("report save");

        let md_path = app
            .export_report_markdown(report.id.clone())
            .expect("report export");
        let html_path = app.export_report_html(report.id.clone()).expect("html export");
        assert!(fs::read_to_string(md_path).unwrap().contains("# 样例报告"));
        assert!(fs::read_to_string(html_path).unwrap().contains("<h1>样例报告</h1>"));
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn renames_reports_with_persistence_and_unique_suffix() {
        let root = test_root();
        let app = CoreApp::initialize(&root).expect("core app initializes");
        let first = analysis::analyze_locally(&AnalysisRequest {
            code: "function first() { return 1; }".to_string(),
            language: Some("JavaScript".to_string()),
            title: Some("第一份报告".to_string()),
            source_label: None,
            mode_group: Some("function".to_string()),
            mode: Some("risk_review".to_string()),
            mode_label: Some("风险审查".to_string()),
            use_llm: Some(false),
            retry_report_id: None,
        });
        let second = analysis::analyze_locally(&AnalysisRequest {
            code: "function second() { return 2; }".to_string(),
            language: Some("JavaScript".to_string()),
            title: Some("第二份报告".to_string()),
            source_label: None,
            mode_group: Some("function".to_string()),
            mode: Some("risk_review".to_string()),
            mode_label: Some("风险审查".to_string()),
            use_llm: Some(false),
            retry_report_id: None,
        });
        storage::save_report(&app.database_path, &first).expect("save first report");
        storage::save_report(&app.database_path, &second).expect("save second report");

        let renamed = app
            .rename_report(first.id.clone(), "登录风险审查".to_string())
            .expect("rename first report");
        assert_eq!(renamed.title, "登录风险审查");
        assert_eq!(app.get_report(first.id).expect("reload first report").title, "登录风险审查");

        let duplicate = app
            .rename_report(second.id, "登录风险审查".to_string())
            .expect("rename second report");
        assert_eq!(duplicate.title, "登录风险审查（2）");
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn project_report_persists_files() {
        let root = test_root();
        let app = CoreApp::initialize(&root).expect("core app initializes");
        let request = ProjectAnalyzeRequest {
            project_name: "样例项目".to_string(),
            workspace_id: None,
            title: None,
            files: vec![ProjectFileInput {
                path: "src/main.ts".to_string(),
                content: "function sample(){ return 1; }".to_string(),
                language: Some("TypeScript".to_string()),
            }],
            use_llm: Some(false),
            retry_report_id: None,
        };
        let mut report = app.build_project_report(&request).expect("project report");
        report.full_report.push_str("\n");
        storage::save_report(&app.database_path, &report).expect("save report");
        let loaded = app.get_report(report.id).expect("load report");
        assert_eq!(loaded.report_type, "project");
        assert_eq!(loaded.files.len(), 1);
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn chat_session_roundtrip() {
        let root = test_root();
        let app = CoreApp::initialize(&root).expect("core app initializes");
        let session_id = storage::save_chat_exchange(
            &app.database_path,
            None,
            "Hello".to_string(),
            None,
            "hello",
            "hello back",
        )
        .expect("session");
        let session = app.get_chat_session(session_id).expect("load session");
        assert_eq!(session.messages.len(), 2);
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn deleting_report_clears_owned_artifacts_and_preserves_follow_up_records() {
        let root = test_root();
        let app = CoreApp::initialize(&root).expect("core app initializes");
        let report = analysis::analyze_locally(&AnalysisRequest {
            code: "function eraseReport() { return 1; }".to_string(),
            language: Some("TypeScript".to_string()),
            title: Some("删除关联测试".to_string()),
            source_label: None,
            mode_group: Some("function".to_string()),
            mode: Some("risk_review".to_string()),
            mode_label: Some("风险审查".to_string()),
            use_llm: Some(false),
            retry_report_id: None,
        });
        storage::save_report(&app.database_path, &report).expect("save report");
        let summaries = app.list_reports_filtered(None, None).expect("list reports");
        assert_eq!(summaries[0].review_focus.as_deref(), Some("风险审查"));

        let candidate_id = Uuid::new_v4().to_string();
        let connection = rusqlite::Connection::open(&app.database_path).expect("open database");
        connection.execute(
            r#"
            INSERT INTO learning_card_candidates (
                id, source_kind, source_id, workspace_id, report_id, finding_id, title, content,
                tags_json, difficulty, status, dedupe_key, created_at
            )
            VALUES (?1, 'report', ?2, NULL, ?2, NULL, '待审核候选', '候选内容', '[]', 'medium', 'pending', ?3, ?4)
            "#,
            rusqlite::params![candidate_id, &report.id, Uuid::new_v4().to_string(), Utc::now().to_rfc3339()],
        ).expect("save candidate");
        drop(connection);

        let chat_id = storage::save_chat_exchange(
            &app.database_path,
            None,
            "报告追问".to_string(),
            Some(report.id.clone()),
            "报告重点是什么？",
            "请先处理高优先级项。",
        ).expect("save chat");
        let task = AgentTask {
            id: Uuid::new_v4().to_string(),
            context_kind: "report".to_string(),
            context_id: report.id.clone(),
            title: "报告行动草稿".to_string(),
            summary: "保留草稿但解除报告入口。".to_string(),
            status: "planned".to_string(),
            selected_file_paths: Vec::new(),
            apply_summary: String::new(),
            created_at: Utc::now().to_rfc3339(),
            updated_at: Utc::now().to_rfc3339(),
            steps: Vec::new(),
            operations: Vec::new(),
        };
        storage::save_agent_task(&app.database_path, &task).expect("save agent task");
        storage::record_activity_event(
            &app.database_path,
            "report_created",
            "删除关联测试",
            "本地分析报告",
            Some("report"),
            Some(&report.id),
        ).expect("save report activity");

        app.delete_report(report.id.clone()).expect("delete report");
        assert!(app.get_report(report.id.clone()).is_err());
        assert_eq!(app.get_chat_session(chat_id).expect("load chat").context_report_id, None);
        assert_eq!(storage::get_agent_task(&app.database_path, &task.id).expect("load task").context_kind, "deleted_report");

        let connection = rusqlite::Connection::open(&app.database_path).expect("open database after delete");
        let candidate_count: i64 = connection.query_row("SELECT COUNT(*) FROM learning_card_candidates WHERE report_id = ?1", rusqlite::params![&report.id], |row| row.get(0)).expect("candidate count");
        let activity_count: i64 = connection.query_row("SELECT COUNT(*) FROM activity_events WHERE entity_kind = 'report' AND entity_id = ?1", rusqlite::params![&report.id], |row| row.get(0)).expect("activity count");
        assert_eq!(candidate_count, 0);
        assert_eq!(activity_count, 0);
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn workspace_review_loop_roundtrip() {
        let root = test_root();
        let source = root.join("source");
        fs::create_dir_all(source.join("src")).expect("source dir");
        fs::write(
            source.join("src").join("main.ts"),
            "import { helper } from './helper';\nexport function sample(input: string) {\n  // TODO: sanitize\n  document.body.innerHTML = input;\n  return helper(input);\n}\n",
        )
        .expect("write main");
        fs::write(
            source.join("src").join("helper.ts"),
            "export function helper(value: string) {\n  return value.trim();\n}\n",
        )
        .expect("write helper");

        let app = CoreApp::initialize(&root).expect("core app initializes");
        let workspace = app
            .import_workspace_from_path(source.clone())
            .expect("workspace import");
        assert_eq!(workspace.summary.file_count, 2);
        assert!(workspace.summary.total_lines > 0);

        let code_map = app
            .get_code_map(workspace.summary.id.clone())
            .expect("code map");
        assert!(!code_map.symbols.is_empty());
        assert!(!code_map.dependencies.is_empty());

        let first_review = futures::executor::block_on(app.analyze_workspace_stream(
            workspace.summary.id.clone(),
            Some(false),
            None,
            |_| Ok(()),
        ))
        .expect("first workspace review");
        assert!(app
            .validate_project_retry_scope(
                Some(&first_review.report.id),
                Some(&workspace.summary.id),
            )
            .is_ok());
        assert!(app
            .validate_project_retry_scope(Some(&first_review.report.id), Some("other-workspace"))
            .is_err());
        assert!(app
            .validate_project_retry_scope(Some(&first_review.report.id), None)
            .is_err());
        let first_review_findings = app
            .list_findings(None, None, None, Some(first_review.report.id.clone()))
            .expect("first review findings");
        assert!(!first_review_findings.is_empty());
        let preserved_finding = app
            .update_finding_status(first_review_findings[0].id.clone(), "reviewing".to_string())
            .expect("mark report finding");
        let preserved_cards = app
            .create_cards_from_findings(vec![preserved_finding.id.clone()])
            .expect("create linked card");
        assert_eq!(preserved_cards[0].finding_id.as_deref(), Some(preserved_finding.id.as_str()));
        let retried_review = futures::executor::block_on(app.analyze_workspace_stream(
            workspace.summary.id.clone(),
            Some(false),
            Some(first_review.report.id.clone()),
            |_| Ok(()),
        ))
        .expect("retried workspace review");
        let retried_findings = app
            .list_findings(None, None, None, Some(retried_review.report.id.clone()))
            .expect("retried findings");
        assert_eq!(retried_review.report.id, first_review.report.id);
        assert_eq!(retried_findings.len(), first_review_findings.len());
        assert!(retried_findings
            .iter()
            .any(|finding| finding.id == preserved_finding.id && finding.status == "reviewing"));
        let cards_after_retry = app
            .list_learning_cards(Some(workspace.summary.id.clone()), None, None)
            .expect("cards after retry");
        assert!(cards_after_retry
            .iter()
            .any(|card| card.id == preserved_cards[0].id
                && card.finding_id.as_deref() == Some(preserved_finding.id.as_str())));

        let findings = app
            .list_findings(Some(workspace.summary.id.clone()), Some("open".to_string()), None, None)
            .expect("findings");
        assert!(!findings.is_empty());
        let updated = app
            .update_finding_status(findings[0].id.clone(), "reviewing".to_string())
            .expect("finding status update");
        assert_eq!(updated.status, "reviewing");

        let cards = app
            .create_cards_from_findings(findings.iter().map(|item| item.id.clone()).collect())
            .expect("cards");
        assert!(!cards.is_empty());
        let card = app
            .update_learning_card(cards[0].id.clone(), "mastered".to_string())
            .expect("card status update");
        assert_eq!(card.status, "mastered");

        let rescanned = app
            .rescan_workspace(workspace.summary.id.clone())
            .expect("rescan");
        assert_eq!(rescanned.summary.id, workspace.summary.id);
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn v05_learning_log_agent_and_activity_roundtrip() {
        let root = test_root();
        let source = root.join("source");
        fs::create_dir_all(source.join("src")).expect("source dir");
        fs::write(
            source.join("src").join("main.ts"),
            "export function render(input: string) {\n  document.body.innerHTML = input;\n}\n",
        )
        .expect("write source");

        let app = CoreApp::initialize(&root).expect("core app initializes");
        let workspace = app.import_workspace_from_path(source).expect("workspace import");
        let guide = app
            .generate_project_guide(workspace.summary.id.clone())
            .expect("guide");
        assert!(guide.summary.contains("项目"));

        let findings = app
            .list_findings(Some(workspace.summary.id.clone()), Some("open".to_string()), None, None)
            .expect("findings");
        let cards = app
            .create_cards_from_findings(findings.iter().map(|item| item.id.clone()).collect())
            .expect("cards");
        assert!(!cards.is_empty());

        let material = futures::executor::block_on(
            app.generate_card_material(cards[0].id.clone(), Some(false)),
        )
        .expect("material");
        assert!(material.content.contains("学习目标"));

        let task = app
            .create_agent_plan(AgentPlanRequest {
                context_kind: "workspace".to_string(),
                context_id: workspace.summary.id.clone(),
                goal: Some("复查高风险问题".to_string()),
                selected_file_paths: vec!["src\\main.ts".to_string()],
            })
            .expect("agent plan");
        assert_eq!(task.steps.len(), 4);

        let today = Utc::now().format("%Y-%m-%d").to_string();
        let draft = app.generate_daily_log(today.clone()).expect("daily draft");
        let saved = app
            .save_daily_log(today, draft.title, draft.content)
            .expect("daily save");
        assert!(saved.content.contains("今日数据"));
        let daily_export = app
            .export_daily_log_markdown(saved.date.clone())
            .expect("daily export");
        assert!(fs::read_to_string(daily_export).unwrap().contains("学习日志"));

        let activity = app.get_activity_summary().expect("activity");
        assert!(activity.workspace_count >= 1);
        assert!(activity.agent_task_count >= 1);
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn v06_agent_apply_bridge_candidates_and_learning_center_roundtrip() {
        let root = test_root();
        let source = root.join("source");
        fs::create_dir_all(source.join("src")).expect("source dir");
        fs::write(
            source.join("src").join("main.ts"),
            "export function render(input: string) {\n  document.body.innerHTML = input;\n}\n",
        )
        .expect("write main");

        let app = CoreApp::initialize(&root).expect("core app initializes");
        let workspace = app
            .import_workspace_from_path(source.clone())
            .expect("workspace import");
        let selected_file = workspace.files[0].path.clone();

        let bridge = app
            .get_workspace_bridge_status(Some(workspace.summary.id.clone()))
            .expect("bridge status");
        assert!(bridge.connected);
        assert!(!bridge.candidate_files.is_empty());

        let bridge = app
            .update_workspace_bridge_selection(workspace.summary.id.clone(), vec![selected_file.clone()])
            .expect("bridge selection");
        assert_eq!(bridge.selected_file_paths, vec![selected_file.clone()]);
        let bridge_manifest = app
            .export_workspace_bridge_manifest(Some(workspace.summary.id.clone()))
            .expect("bridge manifest export");
        assert_eq!(bridge_manifest.selected_file_count, 1);
        assert!(bridge_manifest.candidate_file_count >= 1);
        let bridge_manifest_text = fs::read_to_string(&bridge_manifest.manifest_path)
            .expect("bridge manifest text");
        assert!(bridge_manifest_text.contains("codelens.workspace_bridge.v1"));
        assert!(fs::read_to_string(&bridge_manifest.current_manifest_path)
            .expect("current bridge manifest text")
            .contains("codelens.workspace_bridge.v1"));
        assert!(fs::read_to_string(&bridge_manifest.readme_path)
            .expect("bridge readme text")
            .contains("工作区桥接清单"));
        assert!(fs::read_to_string(&bridge_manifest.current_readme_path)
            .expect("current bridge readme text")
            .contains("工作区桥接清单"));

        let task = app
            .create_agent_plan(AgentPlanRequest {
                context_kind: "workspace".to_string(),
                context_id: workspace.summary.id.clone(),
                goal: Some("生成可追踪执行草稿".to_string()),
                selected_file_paths: bridge.selected_file_paths.clone(),
            })
            .expect("agent plan");
        assert!(task.operations.len() >= 3);
        assert_eq!(task.selected_file_paths, vec![selected_file]);

        let result = app
            .apply_agent_plan(AgentApplyRequest {
                task_id: task.id.clone(),
                operation_ids: task.operations.iter().map(|item| item.id.clone()).collect(),
                confirm: true,
            })
            .expect("apply agent plan");
        assert_eq!(result.applied_count, task.operations.len());
        assert_eq!(result.task.status, "applied");
        assert!(source.join(&task.operations[0].path).exists());
        let rollback_operation = result.task.operations[0].clone();
        let rolled_back = app
            .rollback_agent_operation(result.task.id.clone(), rollback_operation.id.clone())
            .expect("rollback agent operation");
        assert!(rolled_back.operations.iter().any(|item| item.status == "rolled_back"));
        assert!(!source.join(&rollback_operation.path).exists());
        let exported_agent = app
            .export_agent_task_markdown(rolled_back.id.clone())
            .expect("agent export");
        let exported_agent_text = fs::read_to_string(exported_agent).expect("agent export text");
        assert!(exported_agent_text.contains("行动草稿"));
        assert!(exported_agent_text.contains("人工检查清单"));

        let request = ProjectAnalyzeRequest {
            project_name: workspace.summary.name.clone(),
            workspace_id: Some(workspace.summary.id.clone()),
            title: Some("候选卡片报告".to_string()),
            files: workspace
                .files
                .iter()
                .map(|file| ProjectFileInput {
                    path: file.path.clone(),
                    content: file.content.clone(),
                    language: Some(file.language.clone()),
                })
                .collect(),
            use_llm: Some(false),
            retry_report_id: None,
        };
        let mut report = app.build_project_report(&request).expect("report");
        report.metadata_json = json!({ "workspace_id": workspace.summary.id }).to_string();
        storage::save_report(&app.database_path, &report).expect("save report");
        let report_findings = workspace::build_findings(&workspace.files[0], Some(report.id.clone()));
        storage::replace_findings_for_report(&app.database_path, &report.id, &report_findings)
            .expect("save report findings");
        let linked_findings = app
            .list_findings(None, None, None, Some(report.id.clone()))
            .expect("linked report findings");
        assert!(!linked_findings.is_empty());
        assert!(linked_findings.iter().all(|item| item.report_id.as_deref() == Some(report.id.as_str())));

        let candidates = app
            .generate_card_candidates_from_report(report.id.clone())
            .expect("candidates");
        assert!(!candidates.is_empty());
        let candidate_cards = app
            .approve_learning_card_candidates(vec![candidates[0].id.clone()])
            .expect("approve candidates");
        assert_eq!(candidate_cards.len(), 1);
        let finding_cards = app
            .create_cards_from_findings(linked_findings.iter().map(|item| item.id.clone()).collect())
            .expect("finding cards");
        assert!(!finding_cards.is_empty());
        let card_export = app
            .export_learning_cards_markdown(None, None, None)
            .expect("learning cards export");
        let card_export_text = fs::read_to_string(card_export).expect("learning cards export text");
        assert!(card_export_text.contains("知识卡片组"));
        assert!(card_export_text.contains(&candidate_cards[0].title));

        let report_task = app
            .create_agent_plan(AgentPlanRequest {
                context_kind: "report".to_string(),
                context_id: report.id.clone(),
                goal: Some("围绕报告生成闭环执行计划".to_string()),
                selected_file_paths: vec!["src\\main.ts".to_string()],
            })
            .expect("report agent plan");
        assert_eq!(report_task.context_id, report.id);

        let _chat_id = storage::save_chat_exchange(
            &app.database_path,
            None,
            "围绕报告追问".to_string(),
            Some(report.id.clone()),
            "解释这份报告的最高优先级。",
            "请先从报告的高风险项开始。",
        )
        .expect("report chat session");

        let today = Utc::now().format("%Y-%m-%d").to_string();
        let draft = app.generate_daily_log(today.clone()).expect("daily draft");
        app.save_daily_log(
            today.clone(),
            draft.title,
            format!("{}\n\n## 关联报告\n- {}", draft.content, report.title),
        )
        .expect("daily log with report");

        let traceability = app
            .get_traceability_snapshot(Some("report".to_string()), Some(report.id.clone()))
            .expect("report traceability");
        assert_eq!(traceability.counts.reports, 1);
        assert!(traceability.counts.workspaces >= 1);
        assert!(traceability.counts.findings >= 1);
        assert!(traceability.counts.cards >= 1);
        assert!(traceability.counts.chats >= 1);
        assert!(traceability.counts.agent_tasks >= 1);
        assert!(traceability.counts.daily_logs >= 1);
        assert!(traceability.nodes.iter().any(|item| item.kind == "card"));
        assert!(traceability.links.iter().any(|item| item.label == "生成计划"));

        let center = app
            .get_learning_center(today.clone(), today[..7].to_string())
            .expect("learning center");
        assert!(!center.calendar.is_empty());
        assert!(!center.recent_agent_tasks.is_empty());

        app.save_settings(SettingsUpdate {
            enable_llm: true,
            api_base: "https://example.test/v1".to_string(),
            model: "archive-test-model".to_string(),
            api_key: Some("do-not-export-this-key".to_string()),
            clear_api_key: false,
        })
        .expect("settings with secret");
        let archive = app.export_product_archive().expect("product archive");
        let index_text = fs::read_to_string(&archive.index_path).expect("archive index");
        let manifest_text = fs::read_to_string(&archive.manifest_path).expect("archive manifest");
        assert!(PathBuf::from(&archive.export_dir).exists());
        assert!(index_text.contains("本地产品档案"));
        assert!(manifest_text.contains("\"api_key_set\": true"));
        assert!(!index_text.contains("do-not-export-this-key"));
        assert!(!manifest_text.contains("do-not-export-this-key"));
        assert!(archive.counts.reports >= 1);
        assert!(archive.counts.workspaces >= 1);
        assert!(archive.counts.findings >= 1);
        assert!(archive.counts.cards >= 1);
        assert!(archive.counts.agent_tasks >= 1);

        let import_root = test_root();
        let import_app = CoreApp::initialize(&import_root).expect("import app initializes");
        let imported = import_app
            .import_product_archive_from_path(&archive.manifest_path)
            .expect("import product archive");
        assert!(PathBuf::from(&imported.backup_path).exists());
        assert!(imported.warnings.is_empty());
        assert!(imported.counts.reports >= 1);
        assert!(imported.counts.workspaces >= 1);
        assert!(imported.counts.findings >= 1);
        assert!(imported.counts.cards >= 1);
        assert!(imported.counts.agent_tasks >= 1);
        assert!(!fs::read_to_string(import_app.logs_dir_path().join("codelens-next.log"))
            .unwrap()
            .contains("do-not-export-this-key"));
        fs::remove_dir_all(import_root).ok();
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn bridge_inbox_request_creates_agent_plan_and_moves_to_processed() {
        let root = test_root();
        let source = root.join("source");
        fs::create_dir_all(source.join("src")).expect("source dir");
        fs::write(
            source.join("src").join("main.ts"),
            "export function sanitize(input: string) {\n  return input.trim();\n}\n",
        )
        .expect("write source");

        let app = CoreApp::initialize(&root).expect("core app initializes");
        let workspace = app
            .import_workspace_from_path(source.clone())
            .expect("workspace import");
        let selected_file = workspace.files[0].path.clone();

        let inbox_dir = app.storage_dir_path().join("bridge").join("inbox");
        fs::create_dir_all(&inbox_dir).expect("inbox dir");
        let request_path = inbox_dir.join("vscode-request.json");
        fs::write(
            &request_path,
            serde_json::to_string_pretty(&json!({
                "schema": "codelens.bridge_inbox.v1",
                "id": "vscode-request",
                "source": "VS Code",
                "workspace_id": workspace.summary.id,
                "context_kind": "workspace",
                "context_id": workspace.summary.id,
                "goal": "基于编辑器选中文件生成重构计划",
                "selected_file_paths": [selected_file]
            }))
            .expect("request json"),
        )
        .expect("write request");

        let inbox = app.list_workspace_bridge_inbox().expect("list inbox");
        assert!(inbox.iter().any(|item| item.id == "vscode-request"));
        assert!(inbox_dir.join("README.md").exists());

        let result = app
            .create_agent_plan_from_bridge_inbox("vscode-request".to_string())
            .expect("agent from inbox");
        assert_eq!(result.request.status, "processed");
        assert_eq!(result.task.context_kind, "workspace");
        assert_eq!(result.task.selected_file_paths.len(), 1);
        assert!(result.task.title.contains("编辑器选中文件"));
        assert!(!request_path.exists());
        assert!(PathBuf::from(&result.request.file_path).exists());
        assert!(result.request.file_path.contains("processed"));

        let inbox_after = app.list_workspace_bridge_inbox().expect("list inbox after");
        assert!(!inbox_after.iter().any(|item| item.id == "vscode-request"));
        fs::remove_dir_all(root).ok();
    }

    #[test]
    #[ignore = "invoked only by the Windows installer acceptance harness"]
    fn release_installer_acceptance_fixture() {
        const FIXTURE_KEY: &str = "codelens-release-acceptance-key";
        let home = std::env::var("CODELENS_RELEASE_FIXTURE_HOME")
            .map(PathBuf::from)
            .expect("CODELENS_RELEASE_FIXTURE_HOME is required");
        let mode = std::env::var("CODELENS_RELEASE_FIXTURE_MODE")
            .expect("CODELENS_RELEASE_FIXTURE_MODE is required");

        match mode.as_str() {
            "seed" => {
                let source = home.join("acceptance-source");
                fs::create_dir_all(source.join("src")).expect("fixture source dir");
                fs::write(
                    source.join("src").join("main.ts"),
                    "export function releaseAcceptance(value: string) { return value.trim(); }\n",
                )
                .expect("fixture source file");

                let app = CoreApp::initialize(&home).expect("fixture app initializes");
                let settings = app
                    .save_settings(SettingsUpdate {
                        enable_llm: true,
                        api_base: "https://release-acceptance.invalid/v1".to_string(),
                        model: "release-acceptance-model".to_string(),
                        api_key: Some(FIXTURE_KEY.to_string()),
                        clear_api_key: false,
                    })
                    .expect("fixture settings");
                assert_eq!(settings.llm_state, "configured");
                app.save_model_profile(ModelProfileInput {
                    id: None,
                    name: "发布验收模型".to_string(),
                    api_base: "https://release-acceptance.invalid/v1".to_string(),
                    model: "release-acceptance-model".to_string(),
                    note: "安装升级数据保留验收".to_string(),
                    is_default: true,
                })
                .expect("fixture model profile");
                app.import_workspace_from_path(source)
                    .expect("fixture workspace import");
                futures::executor::block_on(app.analyze_code(AnalysisRequest {
                    code: "export const releaseAcceptance = true;".to_string(),
                    language: Some("TypeScript".to_string()),
                    title: Some("发布验收报告".to_string()),
                    source_label: Some("src/main.ts".to_string()),
                    mode_group: Some("function".to_string()),
                    mode: Some("risk_review".to_string()),
                    mode_label: Some("风险审查".to_string()),
                    use_llm: Some(false),
                    retry_report_id: None,
                }))
                .expect("fixture report");
                storage::save_chat_exchange(
                    &app.database_path,
                    None,
                    "发布验收对话".to_string(),
                    None,
                    "升级后是否仍然存在？",
                    "该会话用于验证安装升级后的本地数据保留。",
                )
                .expect("fixture chat");
                fs::write(
                    home.join("storage").join("release-acceptance.marker"),
                    "v1.1.0",
                )
                    .expect("fixture marker");
            }
            "verify" => {
                let app = CoreApp::initialize(&home).expect("fixture app reopens");
                let settings = app.settings().expect("fixture settings reload");
                assert!(settings.enable_llm);
                assert!(settings.api_key_set);
                assert_eq!(settings.llm_state, "configured");
                assert_eq!(settings.model, "release-acceptance-model");
                assert_eq!(storage::load_api_key(&app.database_path).expect("fixture key reload").as_deref(), Some(FIXTURE_KEY));
                assert!(app.list_model_profiles().expect("fixture profiles").iter().any(|item| item.name == "发布验收模型"));
                assert!(app.list_workspaces(None).expect("fixture workspaces").iter().any(|item| item.name == "acceptance-source"));
                assert!(app.list_reports(None).expect("fixture reports").iter().any(|item| item.title == "发布验收报告"));
                assert!(app.list_chat_sessions(None).expect("fixture chats").iter().any(|item| item.title == "发布验收对话"));
                assert_eq!(
                    fs::read_to_string(
                        home.join("storage").join("release-acceptance.marker")
                    )
                    .expect("fixture marker reload"),
                    "v1.1.0"
                );
            }
            other => panic!("unsupported CODELENS_RELEASE_FIXTURE_MODE: {other}"),
        }
    }
}
