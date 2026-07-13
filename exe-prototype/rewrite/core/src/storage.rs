use std::collections::HashSet;
use std::fs;
use std::path::Path;

use anyhow::{anyhow, Context};
use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};
use uuid::Uuid;

use crate::workspace::{self, WorkspaceScan};
use crate::models::{
    ActivityConstellationData, ActivityDay, ActivityEvent, ActivityGalaxyData, ActivityLink,
    ActivityNode, ActivityStarItem, ActivityStarRoute, ActivitySummary, AgentFileOperation,
    AgentStep, AgentTask, CardMaterial, ChatMessageItem, ChatSessionDetail, ChatSessionSummary,
    CodeMap, CodeSymbol, DailyLog, DailySummary, FileDependency, Finding, LearningCalendarItem,
    LearningCard, LearningCardCandidate, LearningCardCreate, ModelProfile, ModelProfileInput,
    ProjectGuide, ProjectGuideItem, ReportDetail, ReportFile, ReportMetrics, ReportSummary,
    Settings, SettingsUpdate, TraceabilityCounts, TraceabilityLink, TraceabilityNode,
    TraceabilitySnapshot, WorkspaceBridgeStatus, WorkspaceDetail, WorkspaceFile, WorkspaceSummary,
};

const SCHEMA_VERSION: i64 = 6;

pub fn init_database(path: &Path) -> anyhow::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }

    let should_backup = path.exists() && path.metadata().map(|item| item.len() > 0).unwrap_or(false);
    let connection = Connection::open(path)
        .with_context(|| format!("failed to open SQLite database {}", path.display()))?;
    let version: i64 = connection.query_row("PRAGMA user_version", [], |row| row.get(0))?;

    if should_backup && version < SCHEMA_VERSION {
        backup_database(path)?;
    }

    connection.execute_batch(
        r#"
        PRAGMA journal_mode = WAL;
        PRAGMA foreign_keys = ON;

        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS reports (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            language TEXT NOT NULL,
            code_excerpt TEXT NOT NULL,
            summary TEXT NOT NULL,
            full_report TEXT NOT NULL,
            analysis_source TEXT NOT NULL,
            risks_json TEXT NOT NULL,
            suggestions_json TEXT NOT NULL,
            metrics_json TEXT NOT NULL,
            created_at TEXT NOT NULL
        );
        "#,
    )?;

    add_column_if_missing(
        &connection,
        "reports",
        "report_type",
        "ALTER TABLE reports ADD COLUMN report_type TEXT NOT NULL DEFAULT 'single'",
    )?;
    add_column_if_missing(
        &connection,
        "reports",
        "risk_level",
        "ALTER TABLE reports ADD COLUMN risk_level TEXT NOT NULL DEFAULT 'low'",
    )?;
    add_column_if_missing(
        &connection,
        "reports",
        "file_count",
        "ALTER TABLE reports ADD COLUMN file_count INTEGER NOT NULL DEFAULT 1",
    )?;
    add_column_if_missing(
        &connection,
        "reports",
        "metadata_json",
        "ALTER TABLE reports ADD COLUMN metadata_json TEXT NOT NULL DEFAULT '{}'",
    )?;

    connection.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS report_files (
            id TEXT PRIMARY KEY,
            report_id TEXT NOT NULL,
            path TEXT NOT NULL,
            language TEXT NOT NULL,
            code_excerpt TEXT NOT NULL,
            metrics_json TEXT NOT NULL,
            risks_json TEXT NOT NULL,
            FOREIGN KEY(report_id) REFERENCES reports(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_report_files_report_id ON report_files(report_id);
        CREATE INDEX IF NOT EXISTS idx_reports_created_at ON reports(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_reports_type_created_at ON reports(report_type, created_at DESC);

        CREATE TABLE IF NOT EXISTS chat_sessions (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            context_report_id TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS chat_messages (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY(session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_chat_sessions_updated_at ON chat_sessions(updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_chat_messages_session_id ON chat_messages(session_id, created_at);
        CREATE TABLE IF NOT EXISTS workspaces (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            root_path TEXT NOT NULL,
            file_count INTEGER NOT NULL,
            total_lines INTEGER NOT NULL,
            language_summary TEXT NOT NULL,
            skipped_json TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS workspace_files (
            id TEXT PRIMARY KEY,
            workspace_id TEXT NOT NULL,
            path TEXT NOT NULL,
            language TEXT NOT NULL,
            content_hash TEXT NOT NULL,
            content TEXT NOT NULL,
            metrics_json TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            UNIQUE(workspace_id, path),
            FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS code_symbols (
            id TEXT PRIMARY KEY,
            workspace_id TEXT NOT NULL,
            file_path TEXT NOT NULL,
            name TEXT NOT NULL,
            kind TEXT NOT NULL,
            line INTEGER NOT NULL,
            signature TEXT NOT NULL,
            FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS file_dependencies (
            id TEXT PRIMARY KEY,
            workspace_id TEXT NOT NULL,
            source_path TEXT NOT NULL,
            target TEXT NOT NULL,
            kind TEXT NOT NULL,
            line INTEGER NOT NULL,
            FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS findings (
            id TEXT PRIMARY KEY,
            workspace_id TEXT NOT NULL,
            report_id TEXT,
            file_path TEXT NOT NULL,
            severity TEXT NOT NULL,
            category TEXT NOT NULL,
            title TEXT NOT NULL,
            detail TEXT NOT NULL,
            line_start INTEGER,
            line_end INTEGER,
            suggestion TEXT NOT NULL,
            status TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
            FOREIGN KEY(report_id) REFERENCES reports(id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS learning_cards (
            id TEXT PRIMARY KEY,
            finding_id TEXT,
            workspace_id TEXT,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            tags_json TEXT NOT NULL,
            status TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY(finding_id) REFERENCES findings(id) ON DELETE SET NULL,
            FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_workspace_files_workspace_path ON workspace_files(workspace_id, path);
        CREATE INDEX IF NOT EXISTS idx_code_symbols_workspace ON code_symbols(workspace_id, file_path);
        CREATE INDEX IF NOT EXISTS idx_file_dependencies_workspace ON file_dependencies(workspace_id, source_path);
        CREATE INDEX IF NOT EXISTS idx_findings_workspace_status ON findings(workspace_id, status, severity);
        CREATE INDEX IF NOT EXISTS idx_learning_cards_workspace_status ON learning_cards(workspace_id, status);
        CREATE TABLE IF NOT EXISTS daily_logs (
            id TEXT PRIMARY KEY,
            log_date TEXT NOT NULL UNIQUE,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS activity_events (
            id TEXT PRIMARY KEY,
            event_type TEXT NOT NULL,
            title TEXT NOT NULL,
            detail TEXT NOT NULL,
            entity_kind TEXT,
            entity_id TEXT,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS agent_tasks (
            id TEXT PRIMARY KEY,
            context_kind TEXT NOT NULL,
            context_id TEXT NOT NULL,
            title TEXT NOT NULL,
            summary TEXT NOT NULL,
            status TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS agent_steps (
            id TEXT PRIMARY KEY,
            task_id TEXT NOT NULL,
            position INTEGER NOT NULL,
            title TEXT NOT NULL,
            detail TEXT NOT NULL,
            risk TEXT NOT NULL,
            suggested_patch TEXT NOT NULL,
            status TEXT NOT NULL,
            FOREIGN KEY(task_id) REFERENCES agent_tasks(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS card_materials (
            id TEXT PRIMARY KEY,
            card_id TEXT NOT NULL,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            source TEXT NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY(card_id) REFERENCES learning_cards(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS project_guides (
            workspace_id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            summary TEXT NOT NULL,
            architecture_json TEXT NOT NULL,
            reading_order_json TEXT NOT NULL,
            key_files_json TEXT NOT NULL,
            generated_at TEXT NOT NULL,
            FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS agent_file_operations (
            id TEXT PRIMARY KEY,
            task_id TEXT NOT NULL,
            path TEXT NOT NULL,
            operation TEXT NOT NULL,
            title TEXT NOT NULL,
            preview TEXT NOT NULL,
            replacement TEXT NOT NULL,
            status TEXT NOT NULL,
            confirmed INTEGER NOT NULL DEFAULT 0,
            backup_path TEXT,
            applied_at TEXT,
            error TEXT,
            FOREIGN KEY(task_id) REFERENCES agent_tasks(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS workspace_bridge_snapshots (
            workspace_id TEXT PRIMARY KEY,
            workspace_name TEXT NOT NULL,
            workspace_root TEXT NOT NULL,
            candidate_files_json TEXT NOT NULL,
            selected_file_paths_json TEXT NOT NULL,
            heartbeat_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            plugin_version TEXT NOT NULL,
            status TEXT NOT NULL,
            message TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS learning_card_candidates (
            id TEXT PRIMARY KEY,
            source_kind TEXT NOT NULL,
            source_id TEXT NOT NULL,
            workspace_id TEXT,
            report_id TEXT,
            finding_id TEXT,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            tags_json TEXT NOT NULL,
            difficulty TEXT NOT NULL,
            status TEXT NOT NULL,
            dedupe_key TEXT NOT NULL UNIQUE,
            created_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_daily_logs_date ON daily_logs(log_date DESC);
        CREATE INDEX IF NOT EXISTS idx_activity_events_created_at ON activity_events(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_activity_events_type ON activity_events(event_type, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_agent_tasks_updated_at ON agent_tasks(updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_card_materials_card_id ON card_materials(card_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_agent_file_operations_task ON agent_file_operations(task_id, status);
        CREATE INDEX IF NOT EXISTS idx_learning_card_candidates_status ON learning_card_candidates(status, created_at DESC);
        PRAGMA user_version = 6;
        "#,
    )?;
    add_column_if_missing(
        &connection,
        "agent_tasks",
        "selected_file_paths_json",
        "ALTER TABLE agent_tasks ADD COLUMN selected_file_paths_json TEXT NOT NULL DEFAULT '[]'",
    )?;
    add_column_if_missing(
        &connection,
        "agent_tasks",
        "apply_summary",
        "ALTER TABLE agent_tasks ADD COLUMN apply_summary TEXT NOT NULL DEFAULT ''",
    )?;
    Ok(())
}

pub fn check_database(path: &Path) -> anyhow::Result<()> {
    let connection = Connection::open(path)?;
    connection.query_row("SELECT 1", [], |_| Ok(()))?;
    Ok(())
}

pub fn load_public_settings(path: &Path) -> anyhow::Result<Settings> {
    let connection = Connection::open(path)?;
    let defaults = Settings::default();
    let enable_llm = get_setting(&connection, "enable_llm")?
        .map(|value| value == "true")
        .unwrap_or(defaults.enable_llm);
    let api_base = get_setting(&connection, "api_base")?.unwrap_or(defaults.api_base);
    let model = get_setting(&connection, "model")?.unwrap_or(defaults.model);
    let api_key_set = get_setting(&connection, "llm_api_key")?
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false);

    Ok(Settings {
        enable_llm,
        api_base,
        model,
        api_key_set,
    })
}

pub fn load_api_key(path: &Path) -> anyhow::Result<Option<String>> {
    let connection = Connection::open(path)?;
    get_setting(&connection, "llm_api_key")
}

pub fn save_settings(path: &Path, update: SettingsUpdate) -> anyhow::Result<()> {
    let connection = Connection::open(path)?;
    let defaults = Settings::default();
    let api_base = if update.api_base.trim().is_empty() {
        defaults.api_base.as_str()
    } else {
        update.api_base.trim()
    };
    let model = if update.model.trim().is_empty() {
        defaults.model.as_str()
    } else {
        update.model.trim()
    };

    set_setting(
        &connection,
        "enable_llm",
        if update.enable_llm { "true" } else { "false" },
    )?;
    set_setting(&connection, "api_base", api_base)?;
    set_setting(&connection, "model", model)?;

    if update.clear_api_key {
        connection.execute("DELETE FROM settings WHERE key = 'llm_api_key'", [])?;
    } else if let Some(api_key) = update.api_key {
        let trimmed = api_key.trim();
        if !trimmed.is_empty() {
            set_setting(&connection, "llm_api_key", trimmed)?;
        }
    }

    Ok(())
}

pub fn list_model_profiles(path: &Path) -> anyhow::Result<Vec<ModelProfile>> {
    let connection = Connection::open(path)?;
    load_model_profiles_from_connection(&connection)
}

pub fn save_model_profile(path: &Path, input: ModelProfileInput) -> anyhow::Result<ModelProfile> {
    let connection = Connection::open(path)?;
    let mut profiles = load_model_profiles_from_connection(&connection)?;
    let now = Utc::now().to_rfc3339();
    let id = input
        .id
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    let existing_created_at = profiles
        .iter()
        .find(|item| item.id == id)
        .map(|item| item.created_at.clone())
        .unwrap_or_else(|| now.clone());
    let profile = ModelProfile {
        id: id.clone(),
        name: input.name.trim().to_string(),
        api_base: input.api_base.trim().to_string(),
        model: input.model.trim().to_string(),
        note: input.note.trim().to_string(),
        is_default: input.is_default,
        created_at: existing_created_at,
        updated_at: now,
    };
    if profile.name.is_empty() {
        return Err(anyhow!("模型档案名称不能为空。"));
    }
    if profile.api_base.is_empty() || profile.model.is_empty() {
        return Err(anyhow!("模型档案需要 API Base 和模型名。"));
    }
    profiles.retain(|item| item.id != id);
    if profile.is_default {
        for item in &mut profiles {
            item.is_default = false;
        }
    }
    profiles.push(profile.clone());
    profiles.sort_by(|left, right| {
        right
            .is_default
            .cmp(&left.is_default)
            .then_with(|| right.updated_at.cmp(&left.updated_at))
    });
    save_model_profiles_to_connection(&connection, &profiles)?;
    Ok(profile)
}

pub fn delete_model_profile(path: &Path, id: &str) -> anyhow::Result<Vec<ModelProfile>> {
    let connection = Connection::open(path)?;
    let mut profiles = load_model_profiles_from_connection(&connection)?;
    profiles.retain(|item| item.id != id);
    save_model_profiles_to_connection(&connection, &profiles)?;
    Ok(profiles)
}

pub fn save_report(path: &Path, report: &ReportDetail) -> anyhow::Result<()> {
    let mut connection = Connection::open(path)?;
    let tx = connection.transaction()?;
    let risks_json = serde_json::to_string(&report.risks)?;
    let suggestions_json = serde_json::to_string(&report.suggestions)?;
    let metrics_json = serde_json::to_string(&report.metrics)?;

    tx.execute(
        r#"
        INSERT OR REPLACE INTO reports (
            id, title, language, code_excerpt, summary, full_report, analysis_source,
            risks_json, suggestions_json, metrics_json, report_type, risk_level, file_count,
            metadata_json, created_at
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)
        "#,
        params![
            report.id,
            report.title,
            report.language,
            report.code_excerpt,
            report.summary,
            report.full_report,
            report.analysis_source,
            risks_json,
            suggestions_json,
            metrics_json,
            report.report_type,
            report.risk_level,
            report.file_count as i64,
            report.metadata_json,
            report.created_at
        ],
    )?;

    tx.execute("DELETE FROM report_files WHERE report_id = ?1", params![report.id])?;
    for file in &report.files {
        tx.execute(
            r#"
            INSERT INTO report_files (
                id, report_id, path, language, code_excerpt, metrics_json, risks_json
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
            "#,
            params![
                file.id,
                file.report_id,
                file.path,
                file.language,
                file.code_excerpt,
                serde_json::to_string(&file.metrics)?,
                serde_json::to_string(&file.risks)?
            ],
        )?;
    }

    tx.commit()?;
    Ok(())
}

pub fn list_reports(path: &Path, query: Option<String>) -> anyhow::Result<Vec<ReportSummary>> {
    list_reports_filtered(path, query, None)
}

pub fn list_reports_filtered(
    path: &Path,
    query: Option<String>,
    report_type: Option<String>,
) -> anyhow::Result<Vec<ReportSummary>> {
    let connection = Connection::open(path)?;
    let query = query.unwrap_or_default();
    let trimmed = query.trim();
    let report_type = report_type
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty() && *value != "all")
        .map(str::to_string);

    let mut sql = String::from(
        r#"
        SELECT id, title, language, summary, analysis_source, report_type, risk_level,
               file_count, created_at, metrics_json, metadata_json
        FROM reports
        "#,
    );
    let mut clauses = Vec::new();
    if !trimmed.is_empty() {
        clauses.push("(title LIKE :query OR language LIKE :query OR summary LIKE :query)");
    }
    if report_type.is_some() {
        clauses.push("report_type = :report_type");
    }
    if !clauses.is_empty() {
        sql.push_str(" WHERE ");
        sql.push_str(&clauses.join(" AND "));
    }
    sql.push_str(" ORDER BY created_at DESC LIMIT 300");

    let like = format!("%{trimmed}%");
    let mut statement = connection.prepare(&sql)?;
    let rows = match (trimmed.is_empty(), report_type.as_deref()) {
        (true, None) => statement.query_map([], row_to_summary)?.collect::<Result<Vec<_>, _>>()?,
        (false, None) => statement
            .query_map(rusqlite::named_params! { ":query": like }, row_to_summary)?
            .collect::<Result<Vec<_>, _>>()?,
        (true, Some(kind)) => statement
            .query_map(rusqlite::named_params! { ":report_type": kind }, row_to_summary)?
            .collect::<Result<Vec<_>, _>>()?,
        (false, Some(kind)) => statement
            .query_map(
                rusqlite::named_params! { ":query": like, ":report_type": kind },
                row_to_summary,
            )?
            .collect::<Result<Vec<_>, _>>()?,
    };

    Ok(rows)
}

pub fn get_report(path: &Path, id: &str) -> anyhow::Result<ReportDetail> {
    let connection = Connection::open(path)?;
    let mut report = connection
        .query_row(
            r#"
            SELECT id, title, language, code_excerpt, summary, full_report, analysis_source,
                   risks_json, suggestions_json, metrics_json, report_type, risk_level,
                   file_count, metadata_json, created_at
            FROM reports
            WHERE id = ?1
            "#,
            params![id],
            |row| row_to_detail(row),
        )
        .optional()?
        .ok_or_else(|| anyhow!("report not found: {id}"))?;
    report.files = list_report_files_for_connection(&connection, id)?;
    Ok(report)
}

pub fn unique_report_title(path: &Path, requested: &str, current_id: Option<&str>) -> anyhow::Result<String> {
    let base = requested.split_whitespace().collect::<Vec<_>>().join(" ");
    if base.is_empty() {
        return Err(anyhow!("报告标题不能为空。"));
    }
    let base = base.chars().take(60).collect::<String>();
    let connection = Connection::open(path)?;
    let excluded_id = current_id.unwrap_or("");
    let mut candidate = base.clone();
    let mut counter = 2usize;
    loop {
        let exists = connection
            .query_row(
                "SELECT 1 FROM reports WHERE title = ?1 AND (?2 = '' OR id != ?2) LIMIT 1",
                params![candidate, excluded_id],
                |_| Ok(()),
            )
            .optional()?
            .is_some();
        if !exists {
            return Ok(candidate);
        }
        let suffix = format!("（{counter}）");
        let max_len = 60usize.saturating_sub(suffix.chars().count());
        candidate = format!("{}{}", base.chars().take(max_len).collect::<String>(), suffix);
        counter += 1;
    }
}

pub fn rename_report(path: &Path, id: &str, title: &str) -> anyhow::Result<ReportDetail> {
    let next_title = unique_report_title(path, title, Some(id))?;
    let connection = Connection::open(path)?;
    let changed = connection.execute("UPDATE reports SET title = ?1 WHERE id = ?2", params![next_title, id])?;
    if changed == 0 {
        return Err(anyhow!("report not found: {id}"));
    }
    get_report(path, id)
}

pub fn delete_report(path: &Path, id: &str) -> anyhow::Result<()> {
    let mut connection = Connection::open(path)?;
    connection.execute_batch("PRAGMA foreign_keys = ON;")?;
    let tx = connection.transaction()?;
    let exists = tx
        .query_row("SELECT 1 FROM reports WHERE id = ?1", params![id], |_| Ok(()))
        .optional()?
        .is_some();
    if !exists {
        return Err(anyhow!("report not found: {id}"));
    }

    // Preserve user-authored follow-up data while removing report-owned artifacts and dead links.
    tx.execute(
        "DELETE FROM learning_card_candidates WHERE report_id = ?1 OR (source_kind = 'report' AND source_id = ?1)",
        params![id],
    )?;
    tx.execute(
        "UPDATE chat_sessions SET context_report_id = NULL WHERE context_report_id = ?1",
        params![id],
    )?;
    tx.execute(
        "UPDATE agent_tasks SET context_kind = 'deleted_report', updated_at = ?2 WHERE context_kind = 'report' AND context_id = ?1",
        params![id, Utc::now().to_rfc3339()],
    )?;
    tx.execute(
        "DELETE FROM activity_events WHERE entity_kind = 'report' AND entity_id = ?1",
        params![id],
    )?;
    tx.execute("DELETE FROM reports WHERE id = ?1", params![id])?;
    tx.commit()?;
    Ok(())
}

pub fn upsert_chat_session(
    path: &Path,
    session_id: Option<String>,
    title: String,
    context_report_id: Option<String>,
) -> anyhow::Result<String> {
    let connection = Connection::open(path)?;
    let now = Utc::now().to_rfc3339();
    if let Some(id) = session_id {
        let exists = connection
            .query_row(
                "SELECT id FROM chat_sessions WHERE id = ?1",
                params![id],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        if exists.is_some() {
            connection.execute(
                "UPDATE chat_sessions SET title = ?1, context_report_id = ?2, updated_at = ?3 WHERE id = ?4",
                params![title, context_report_id, now, id],
            )?;
            return Ok(id);
        }
    }

    let id = Uuid::new_v4().to_string();
    connection.execute(
        "INSERT INTO chat_sessions (id, title, context_report_id, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![id, title, context_report_id, now, now],
    )?;
    Ok(id)
}

pub fn save_chat_message(
    path: &Path,
    session_id: &str,
    role: &str,
    content: &str,
) -> anyhow::Result<ChatMessageItem> {
    let connection = Connection::open(path)?;
    let now = Utc::now().to_rfc3339();
    let item = ChatMessageItem {
        id: Uuid::new_v4().to_string(),
        session_id: session_id.to_string(),
        role: role.to_string(),
        content: content.to_string(),
        created_at: now.clone(),
    };
    connection.execute(
        "INSERT INTO chat_messages (id, session_id, role, content, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![item.id, item.session_id, item.role, item.content, item.created_at],
    )?;
    connection.execute(
        "UPDATE chat_sessions SET updated_at = ?1 WHERE id = ?2",
        params![now, session_id],
    )?;
    Ok(item)
}

pub fn save_chat_session_detail(path: &Path, detail: &ChatSessionDetail) -> anyhow::Result<()> {
    let mut connection = Connection::open(path)?;
    let tx = connection.transaction()?;
    tx.execute("DELETE FROM chat_messages WHERE session_id = ?1", params![detail.id])?;
    tx.execute(
        r#"
        INSERT OR REPLACE INTO chat_sessions (id, title, context_report_id, created_at, updated_at)
        VALUES (?1, ?2, ?3, ?4, ?5)
        "#,
        params![
            detail.id,
            detail.title,
            detail.context_report_id,
            detail.created_at,
            detail.updated_at
        ],
    )?;
    for message in &detail.messages {
        tx.execute(
            r#"
            INSERT OR REPLACE INTO chat_messages (id, session_id, role, content, created_at)
            VALUES (?1, ?2, ?3, ?4, ?5)
            "#,
            params![
                message.id,
                detail.id,
                message.role,
                message.content,
                message.created_at
            ],
        )?;
    }
    tx.commit()?;
    Ok(())
}

pub fn list_chat_sessions(
    path: &Path,
    query: Option<String>,
) -> anyhow::Result<Vec<ChatSessionSummary>> {
    let connection = Connection::open(path)?;
    let query = query.unwrap_or_default();
    let trimmed = query.trim();
    let like = format!("%{trimmed}%");
    let sql = if trimmed.is_empty() {
        r#"
        SELECT s.id, s.title, s.context_report_id, s.created_at, s.updated_at, COUNT(m.id)
        FROM chat_sessions s
        LEFT JOIN chat_messages m ON m.session_id = s.id
        GROUP BY s.id
        ORDER BY s.updated_at DESC
        LIMIT 200
        "#
    } else {
        r#"
        SELECT s.id, s.title, s.context_report_id, s.created_at, s.updated_at, COUNT(m.id)
        FROM chat_sessions s
        LEFT JOIN chat_messages m ON m.session_id = s.id
        WHERE s.title LIKE ?1
        GROUP BY s.id
        ORDER BY s.updated_at DESC
        LIMIT 200
        "#
    };
    let mut statement = connection.prepare(sql)?;
    let rows = if trimmed.is_empty() {
        statement
            .query_map([], row_to_chat_summary)?
            .collect::<Result<Vec<_>, _>>()?
    } else {
        statement
            .query_map(params![like], row_to_chat_summary)?
            .collect::<Result<Vec<_>, _>>()?
    };
    Ok(rows)
}

pub fn get_chat_session(path: &Path, id: &str) -> anyhow::Result<ChatSessionDetail> {
    let connection = Connection::open(path)?;
    let mut detail = connection
        .query_row(
            "SELECT id, title, context_report_id, created_at, updated_at FROM chat_sessions WHERE id = ?1",
            params![id],
            |row| {
                Ok(ChatSessionDetail {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    context_report_id: row.get(2)?,
                    messages: Vec::new(),
                    created_at: row.get(3)?,
                    updated_at: row.get(4)?,
                })
            },
        )
        .optional()?
        .ok_or_else(|| anyhow!("chat session not found: {id}"))?;
    detail.messages = list_chat_messages_for_connection(&connection, id)?;
    Ok(detail)
}

pub fn delete_chat_session(path: &Path, id: &str) -> anyhow::Result<()> {
    let connection = Connection::open(path)?;
    connection.execute("DELETE FROM chat_sessions WHERE id = ?1", params![id])?;
    Ok(())
}

pub fn save_workspace_scan(path: &Path, scan: &WorkspaceScan) -> anyhow::Result<WorkspaceDetail> {
    let mut connection = Connection::open(path)?;
    connection.execute_batch("PRAGMA foreign_keys = ON;")?;
    let existing_created_at = connection
        .query_row(
            "SELECT created_at FROM workspaces WHERE id = ?1",
            params![scan.detail.summary.id],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    let mut detail = scan.detail.clone();
    if let Some(created_at) = existing_created_at {
        detail.summary.created_at = created_at;
    }

    let tx = connection.transaction()?;
    tx.execute(
        r#"
        INSERT INTO workspaces (
            id, name, root_path, file_count, total_lines, language_summary,
            skipped_json, created_at, updated_at
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
        ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            root_path = excluded.root_path,
            file_count = excluded.file_count,
            total_lines = excluded.total_lines,
            language_summary = excluded.language_summary,
            skipped_json = excluded.skipped_json,
            updated_at = excluded.updated_at
        "#,
        params![
            detail.summary.id,
            detail.summary.name,
            detail.summary.root_path,
            detail.summary.file_count as i64,
            detail.summary.total_lines as i64,
            detail.summary.language_summary,
            serde_json::to_string(&detail.skipped)?,
            detail.summary.created_at,
            detail.summary.updated_at
        ],
    )?;

    tx.execute(
        "DELETE FROM workspace_files WHERE workspace_id = ?1",
        params![detail.summary.id],
    )?;
    tx.execute(
        "DELETE FROM code_symbols WHERE workspace_id = ?1",
        params![detail.summary.id],
    )?;
    tx.execute(
        "DELETE FROM file_dependencies WHERE workspace_id = ?1",
        params![detail.summary.id],
    )?;
    tx.execute(
        "DELETE FROM findings WHERE workspace_id = ?1",
        params![detail.summary.id],
    )?;

    for file in &detail.files {
        tx.execute(
            r#"
            INSERT INTO workspace_files (
                id, workspace_id, path, language, content_hash, content, metrics_json, updated_at
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
            "#,
            params![
                file.id,
                file.workspace_id,
                file.path,
                file.language,
                file.content_hash,
                file.content,
                serde_json::to_string(&file.metrics)?,
                file.updated_at
            ],
        )?;
    }

    for symbol in &scan.symbols {
        tx.execute(
            r#"
            INSERT INTO code_symbols (
                id, workspace_id, file_path, name, kind, line, signature
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
            "#,
            params![
                symbol.id,
                symbol.workspace_id,
                symbol.file_path,
                symbol.name,
                symbol.kind,
                symbol.line as i64,
                symbol.signature
            ],
        )?;
    }

    for dependency in &scan.dependencies {
        tx.execute(
            r#"
            INSERT INTO file_dependencies (
                id, workspace_id, source_path, target, kind, line
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6)
            "#,
            params![
                dependency.id,
                dependency.workspace_id,
                dependency.source_path,
                dependency.target,
                dependency.kind,
                dependency.line as i64
            ],
        )?;
    }

    for finding in &scan.findings {
        insert_finding_tx(&tx, finding)?;
    }

    tx.commit()?;
    Ok(detail)
}

pub fn list_workspaces(path: &Path, query: Option<String>) -> anyhow::Result<Vec<WorkspaceSummary>> {
    let connection = Connection::open(path)?;
    let query = query.unwrap_or_default();
    let trimmed = query.trim();
    let like = format!("%{trimmed}%");
    let sql = if trimmed.is_empty() {
        r#"
        SELECT id, name, root_path, file_count, total_lines, language_summary, created_at, updated_at
        FROM workspaces
        ORDER BY updated_at DESC
        LIMIT 200
        "#
    } else {
        r#"
        SELECT id, name, root_path, file_count, total_lines, language_summary, created_at, updated_at
        FROM workspaces
        WHERE name LIKE ?1 OR root_path LIKE ?1 OR language_summary LIKE ?1
        ORDER BY updated_at DESC
        LIMIT 200
        "#
    };
    let mut statement = connection.prepare(sql)?;
    let rows = if trimmed.is_empty() {
        statement
            .query_map([], row_to_workspace_summary)?
            .collect::<Result<Vec<_>, _>>()?
    } else {
        statement
            .query_map(params![like], row_to_workspace_summary)?
            .collect::<Result<Vec<_>, _>>()?
    };
    Ok(rows)
}

pub fn get_workspace(path: &Path, id: &str) -> anyhow::Result<WorkspaceDetail> {
    let connection = Connection::open(path)?;
    let (summary, skipped_json): (WorkspaceSummary, String) = connection
        .query_row(
            r#"
            SELECT id, name, root_path, file_count, total_lines, language_summary,
                   skipped_json, created_at, updated_at
            FROM workspaces
            WHERE id = ?1
            "#,
            params![id],
            |row| {
                Ok((
                    WorkspaceSummary {
                        id: row.get(0)?,
                        name: row.get(1)?,
                        root_path: row.get(2)?,
                        file_count: row.get::<_, i64>(3)?.max(0) as usize,
                        total_lines: row.get::<_, i64>(4)?.max(0) as usize,
                        language_summary: row.get(5)?,
                        created_at: row.get(7)?,
                        updated_at: row.get(8)?,
                    },
                    row.get(6)?,
                ))
            },
        )
        .optional()?
        .ok_or_else(|| anyhow!("workspace not found: {id}"))?;
    let skipped = serde_json::from_str(&skipped_json).unwrap_or_default();
    let files = list_workspace_files_for_connection(&connection, id)?;
    Ok(WorkspaceDetail {
        summary,
        files,
        skipped,
    })
}

pub fn delete_workspace(path: &Path, id: &str) -> anyhow::Result<()> {
    let connection = Connection::open(path)?;
    connection.execute_batch("PRAGMA foreign_keys = ON;")?;
    connection.execute("DELETE FROM workspaces WHERE id = ?1", params![id])?;
    Ok(())
}

pub fn get_code_map(path: &Path, workspace_id: &str) -> anyhow::Result<CodeMap> {
    let connection = Connection::open(path)?;
    let files = list_workspace_files_for_connection(&connection, workspace_id)?;
    if files.is_empty() {
        return Err(anyhow!("workspace has no indexed files: {workspace_id}"));
    }
    let symbols = list_symbols_for_connection(&connection, workspace_id)?;
    let dependencies = list_dependencies_for_connection(&connection, workspace_id)?;
    Ok(workspace::build_code_map(workspace_id, &files, symbols, dependencies))
}

pub fn save_findings(path: &Path, findings: &[Finding]) -> anyhow::Result<()> {
    let mut connection = Connection::open(path)?;
    let tx = connection.transaction()?;
    for finding in findings {
        insert_finding_tx(&tx, finding)?;
    }
    tx.commit()?;
    Ok(())
}

pub fn list_findings(
    path: &Path,
    workspace_id: Option<String>,
    status: Option<String>,
    severity: Option<String>,
    report_id: Option<String>,
) -> anyhow::Result<Vec<Finding>> {
    let connection = Connection::open(path)?;
    let sql = String::from(
        r#"
        SELECT id, workspace_id, report_id, file_path, severity, category, title, detail,
               line_start, line_end, suggestion, status, created_at, updated_at
        FROM findings
        WHERE (:workspace_id IS NULL OR workspace_id = :workspace_id)
          AND (:status IS NULL OR status = :status)
          AND (:severity IS NULL OR severity = :severity)
          AND (:report_id IS NULL OR report_id = :report_id)
        ORDER BY CASE severity WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, updated_at DESC
        LIMIT 500
        "#,
    );
    let workspace_id = normalized_filter(workspace_id);
    let status = normalized_filter(status);
    let severity = normalized_filter(severity);
    let report_id = normalized_filter(report_id);

    let mut statement = connection.prepare(&sql)?;
    let rows = statement
        .query_map(
            rusqlite::named_params! {
                ":workspace_id": workspace_id.as_deref(),
                ":status": status.as_deref(),
                ":severity": severity.as_deref(),
                ":report_id": report_id.as_deref()
            },
            row_to_finding,
        )?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

pub fn update_finding_status(path: &Path, id: &str, status: &str) -> anyhow::Result<Finding> {
    let connection = Connection::open(path)?;
    let clean_status = normalize_status(status, &["open", "reviewing", "resolved", "ignored"], "open");
    connection.execute(
        "UPDATE findings SET status = ?1, updated_at = ?2 WHERE id = ?3",
        params![clean_status, Utc::now().to_rfc3339(), id],
    )?;
    connection
        .query_row(
            r#"
            SELECT id, workspace_id, report_id, file_path, severity, category, title, detail,
                   line_start, line_end, suggestion, status, created_at, updated_at
            FROM findings
            WHERE id = ?1
            "#,
            params![id],
            row_to_finding,
        )
        .optional()?
        .ok_or_else(|| anyhow!("finding not found: {id}"))
}

pub fn create_cards_from_findings(path: &Path, finding_ids: Vec<String>) -> anyhow::Result<Vec<LearningCard>> {
    let connection = Connection::open(path)?;
    let findings = load_findings_for_cards(&connection, finding_ids)?;
    let mut cards = Vec::new();
    for finding in findings {
        let exists = connection
            .query_row(
                "SELECT id FROM learning_cards WHERE finding_id = ?1",
                params![finding.id],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        if exists.is_some() {
            continue;
        }
        let now = Utc::now().to_rfc3339();
        let tags = vec![
            finding.severity.clone(),
            finding.category.clone(),
            file_tag(&finding.file_path),
        ];
        let card = LearningCard {
            id: Uuid::new_v4().to_string(),
            finding_id: Some(finding.id.clone()),
            workspace_id: Some(finding.workspace_id.clone()),
            title: format!("Review: {}", finding.title),
            content: format!(
                "{}\n\nSuggested practice: {}\n\nSource: {}{}",
                finding.detail,
                finding.suggestion,
                finding.file_path,
                finding
                    .line_start
                    .map(|line| format!(":{line}"))
                    .unwrap_or_default()
            ),
            tags,
            status: "new".to_string(),
            created_at: now.clone(),
            updated_at: now,
        };
        insert_learning_card(&connection, &card)?;
        cards.push(card);
    }
    Ok(cards)
}

pub fn list_learning_cards(
    path: &Path,
    workspace_id: Option<String>,
    status: Option<String>,
    tag: Option<String>,
) -> anyhow::Result<Vec<LearningCard>> {
    let connection = Connection::open(path)?;
    let workspace_id = normalized_filter(workspace_id);
    let status = normalized_filter(status);
    let sql = String::from(
        r#"
        SELECT id, finding_id, workspace_id, title, content, tags_json, status, created_at, updated_at
        FROM learning_cards
        WHERE (:workspace_id IS NULL OR workspace_id = :workspace_id)
          AND (:status IS NULL OR status = :status)
        ORDER BY updated_at DESC
        LIMIT 500
        "#,
    );
    let mut statement = connection.prepare(&sql)?;
    let mut rows = statement
        .query_map(
            rusqlite::named_params! {
                ":workspace_id": workspace_id.as_deref(),
                ":status": status.as_deref()
            },
            row_to_learning_card,
        )?
        .collect::<Result<Vec<_>, _>>()?;
    if let Some(tag) = normalized_filter(tag) {
        rows.retain(|card| card.tags.iter().any(|item| item.eq_ignore_ascii_case(&tag)));
    }
    Ok(rows)
}

pub fn update_learning_card(path: &Path, id: &str, status: &str) -> anyhow::Result<LearningCard> {
    let connection = Connection::open(path)?;
    let clean_status = normalize_status(status, &["new", "reviewing", "mastered"], "new");
    connection.execute(
        "UPDATE learning_cards SET status = ?1, updated_at = ?2 WHERE id = ?3",
        params![clean_status, Utc::now().to_rfc3339(), id],
    )?;
    connection
        .query_row(
            r#"
            SELECT id, finding_id, workspace_id, title, content, tags_json, status, created_at, updated_at
            FROM learning_cards
            WHERE id = ?1
            "#,
            params![id],
            row_to_learning_card,
        )
        .optional()?
        .ok_or_else(|| anyhow!("learning card not found: {id}"))
}

pub fn save_learning_cards(path: &Path, cards: &[LearningCard]) -> anyhow::Result<usize> {
    let connection = Connection::open(path)?;
    let mut imported = 0;
    for card in cards {
        insert_learning_card(&connection, card)?;
        imported += 1;
    }
    Ok(imported)
}

pub fn delete_learning_card(path: &Path, id: &str) -> anyhow::Result<()> {
    let connection = Connection::open(path)?;
    connection.execute("DELETE FROM learning_cards WHERE id = ?1", params![id])?;
    Ok(())
}

pub fn create_learning_card(path: &Path, input: LearningCardCreate) -> anyhow::Result<LearningCard> {
    let connection = Connection::open(path)?;
    let now = Utc::now().to_rfc3339();
    let tags = input
        .tags
        .into_iter()
        .map(|tag| tag.trim().to_string())
        .filter(|tag| !tag.is_empty())
        .collect::<Vec<_>>();
    let card = LearningCard {
        id: Uuid::new_v4().to_string(),
        finding_id: input.finding_id.filter(|value| !value.trim().is_empty()),
        workspace_id: input.workspace_id.filter(|value| !value.trim().is_empty()),
        title: if input.title.trim().is_empty() {
            "手动知识卡片".to_string()
        } else {
            input.title.trim().to_string()
        },
        content: input.content.trim().to_string(),
        tags: if tags.is_empty() { vec!["manual".to_string()] } else { tags },
        status: "new".to_string(),
        created_at: now.clone(),
        updated_at: now,
    };
    insert_learning_card(&connection, &card)?;
    Ok(card)
}

pub fn get_learning_card(path: &Path, id: &str) -> anyhow::Result<LearningCard> {
    let connection = Connection::open(path)?;
    connection
        .query_row(
            r#"
            SELECT id, finding_id, workspace_id, title, content, tags_json, status, created_at, updated_at
            FROM learning_cards
            WHERE id = ?1
            "#,
            params![id],
            row_to_learning_card,
        )
        .optional()?
        .ok_or_else(|| anyhow!("未找到知识卡片：{id}"))
}

pub fn save_card_material(path: &Path, material: &CardMaterial) -> anyhow::Result<()> {
    let connection = Connection::open(path)?;
    connection.execute(
        r#"
        INSERT OR REPLACE INTO card_materials (id, card_id, title, content, source, created_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6)
        "#,
        params![
            material.id,
            material.card_id,
            material.title,
            material.content,
            material.source,
            material.created_at
        ],
    )?;
    Ok(())
}

pub fn save_card_materials(path: &Path, materials: &[CardMaterial]) -> anyhow::Result<usize> {
    let mut imported = 0;
    for material in materials {
        save_card_material(path, material)?;
        imported += 1;
    }
    Ok(imported)
}

pub fn list_card_materials(path: &Path, card_id: Option<String>) -> anyhow::Result<Vec<CardMaterial>> {
    let connection = Connection::open(path)?;
    let card_id = normalized_filter(card_id);
    let mut statement = connection.prepare(
        r#"
        SELECT id, card_id, title, content, source, created_at
        FROM card_materials
        WHERE (:card_id IS NULL OR card_id = :card_id)
        ORDER BY created_at DESC
        LIMIT 300
        "#,
    )?;
    let rows = statement
        .query_map(
            rusqlite::named_params! { ":card_id": card_id.as_deref() },
            row_to_card_material,
        )?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

pub fn get_daily_summary(path: &Path, date: &str) -> anyhow::Result<DailySummary> {
    let connection = Connection::open(path)?;
    let date = normalize_date(date);
    let like = format!("{date}%");
    let report_count = count_where_like(&connection, "reports", "created_at", &like)?;
    let chat_message_count = count_where_like(&connection, "chat_messages", "created_at", &like)?;
    let finding_count = count_where_like(&connection, "findings", "created_at", &like)?;
    let card_count = count_where_like(&connection, "learning_cards", "created_at", &like)?;
    let agent_task_count = count_where_like(&connection, "agent_tasks", "created_at", &like)?;
    let activity_count = count_where_like(&connection, "activity_events", "created_at", &like)?;
    let mut highlights = recent_activity_for_day(&connection, &like)?
        .into_iter()
        .map(|event| format!("{}：{}", event_type_label(&event.event_type), event.title))
        .collect::<Vec<_>>();
    if highlights.is_empty() {
        highlights.push("今天还没有记录活动，可以先导入工作区或生成一份报告。".to_string());
    }

    Ok(DailySummary {
        date,
        report_count,
        chat_message_count,
        finding_count,
        card_count,
        agent_task_count,
        activity_count,
        highlights,
    })
}

pub fn save_daily_log(path: &Path, date: &str, title: &str, content: &str) -> anyhow::Result<DailyLog> {
    let connection = Connection::open(path)?;
    let date = normalize_date(date);
    let now = Utc::now().to_rfc3339();
    let existing = connection
        .query_row(
            "SELECT id, created_at FROM daily_logs WHERE log_date = ?1",
            params![date],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()?;
    let (id, created_at) = existing.unwrap_or_else(|| (Uuid::new_v4().to_string(), now.clone()));
    let title = if title.trim().is_empty() {
        format!("{date} 学习日志")
    } else {
        title.trim().to_string()
    };
    connection.execute(
        r#"
        INSERT INTO daily_logs (id, log_date, title, content, created_at, updated_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6)
        ON CONFLICT(log_date) DO UPDATE SET
            title = excluded.title,
            content = excluded.content,
            updated_at = excluded.updated_at
        "#,
        params![id, date, title, content, created_at, now],
    )?;
    get_daily_log_by_date(&connection, &date)
}

pub fn list_daily_logs(path: &Path) -> anyhow::Result<Vec<DailyLog>> {
    let connection = Connection::open(path)?;
    let mut statement = connection.prepare(
        r#"
        SELECT id, log_date, title, content, created_at, updated_at
        FROM daily_logs
        ORDER BY log_date DESC
        LIMIT 200
        "#,
    )?;
    let rows = statement
        .query_map([], row_to_daily_log)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

pub fn save_project_guide(path: &Path, guide: &ProjectGuide) -> anyhow::Result<()> {
    let connection = Connection::open(path)?;
    connection.execute(
        r#"
        INSERT INTO project_guides (
            workspace_id, title, summary, architecture_json, reading_order_json,
            key_files_json, generated_at
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
        ON CONFLICT(workspace_id) DO UPDATE SET
            title = excluded.title,
            summary = excluded.summary,
            architecture_json = excluded.architecture_json,
            reading_order_json = excluded.reading_order_json,
            key_files_json = excluded.key_files_json,
            generated_at = excluded.generated_at
        "#,
        params![
            guide.workspace_id,
            guide.title,
            guide.summary,
            serde_json::to_string(&guide.architecture)?,
            serde_json::to_string(&guide.reading_order)?,
            serde_json::to_string(&guide.key_files)?,
            guide.generated_at
        ],
    )?;
    Ok(())
}

pub fn get_project_guide(path: &Path, workspace_id: &str) -> anyhow::Result<ProjectGuide> {
    let connection = Connection::open(path)?;
    connection
        .query_row(
            r#"
            SELECT workspace_id, title, summary, architecture_json, reading_order_json,
                   key_files_json, generated_at
            FROM project_guides
            WHERE workspace_id = ?1
            "#,
            params![workspace_id],
            row_to_project_guide,
        )
        .optional()?
        .ok_or_else(|| anyhow!("当前工作区还没有项目导览，请先生成导览。"))
}

pub fn list_project_guides(path: &Path) -> anyhow::Result<Vec<ProjectGuide>> {
    let connection = Connection::open(path)?;
    let mut statement = connection.prepare(
        r#"
        SELECT workspace_id, title, summary, architecture_json, reading_order_json,
               key_files_json, generated_at
        FROM project_guides
        ORDER BY generated_at DESC
        LIMIT 200
        "#,
    )?;
    let rows = statement
        .query_map([], row_to_project_guide)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

pub fn save_agent_task(path: &Path, task: &AgentTask) -> anyhow::Result<()> {
    let mut connection = Connection::open(path)?;
    let tx = connection.transaction()?;
    tx.execute("DELETE FROM agent_steps WHERE task_id = ?1", params![task.id])?;
    tx.execute("DELETE FROM agent_file_operations WHERE task_id = ?1", params![task.id])?;
    tx.execute(
        r#"
        INSERT OR REPLACE INTO agent_tasks (
            id, context_kind, context_id, title, summary, status, selected_file_paths_json,
            apply_summary, created_at, updated_at
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
        "#,
        params![
            task.id,
            task.context_kind,
            task.context_id,
            task.title,
            task.summary,
            task.status,
            serde_json::to_string(&task.selected_file_paths)?,
            task.apply_summary,
            task.created_at,
            task.updated_at
        ],
    )?;
    for step in &task.steps {
        tx.execute(
            r#"
            INSERT INTO agent_steps (
                id, task_id, position, title, detail, risk, suggested_patch, status
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
            "#,
            params![
                step.id,
                step.task_id,
                step.position as i64,
                step.title,
                step.detail,
                step.risk,
                step.suggested_patch,
                step.status
            ],
        )?;
    }
    for operation in &task.operations {
        insert_agent_operation_tx(&tx, operation)?;
    }
    tx.commit()?;
    Ok(())
}

pub fn list_agent_tasks(path: &Path) -> anyhow::Result<Vec<AgentTask>> {
    let connection = Connection::open(path)?;
    let mut statement = connection.prepare(
        r#"
        SELECT id, context_kind, context_id, title, summary, status,
               selected_file_paths_json, apply_summary, created_at, updated_at
        FROM agent_tasks
        ORDER BY updated_at DESC
        LIMIT 200
        "#,
    )?;
    let mut tasks = statement.query_map([], row_to_agent_task_without_steps)?.collect::<Result<Vec<_>, _>>()?;
    for task in &mut tasks {
        task.steps = list_agent_steps_for_connection(&connection, &task.id)?;
        task.operations = list_agent_operations_for_connection(&connection, &task.id)?;
    }
    Ok(tasks)
}

pub fn get_agent_task(path: &Path, id: &str) -> anyhow::Result<AgentTask> {
    let connection = Connection::open(path)?;
    let mut task = connection
        .query_row(
            r#"
            SELECT id, context_kind, context_id, title, summary, status,
                   selected_file_paths_json, apply_summary, created_at, updated_at
            FROM agent_tasks
            WHERE id = ?1
            "#,
            params![id],
            row_to_agent_task_without_steps,
        )
        .optional()?
        .ok_or_else(|| anyhow!("未找到行动草稿：{id}"))?;
    task.steps = list_agent_steps_for_connection(&connection, id)?;
    task.operations = list_agent_operations_for_connection(&connection, id)?;
    Ok(task)
}

pub fn delete_agent_task(path: &Path, id: &str) -> anyhow::Result<()> {
    let connection = Connection::open(path)?;
    connection.execute_batch("PRAGMA foreign_keys = ON;")?;
    connection.execute("DELETE FROM agent_tasks WHERE id = ?1", params![id])?;
    Ok(())
}

pub fn update_agent_operation_result(
    path: &Path,
    operation_id: &str,
    status: &str,
    confirmed: bool,
    backup_path: Option<String>,
    applied_at: Option<String>,
    error: Option<String>,
) -> anyhow::Result<()> {
    let connection = Connection::open(path)?;
    connection.execute(
        r#"
        UPDATE agent_file_operations
        SET status = ?1, confirmed = ?2, backup_path = ?3, applied_at = ?4, error = ?5
        WHERE id = ?6
        "#,
        params![status, if confirmed { 1 } else { 0 }, backup_path, applied_at, error, operation_id],
    )?;
    Ok(())
}

pub fn update_agent_task_status(path: &Path, id: &str, status: &str, apply_summary: &str) -> anyhow::Result<()> {
    let connection = Connection::open(path)?;
    connection.execute(
        "UPDATE agent_tasks SET status = ?1, apply_summary = ?2, updated_at = ?3 WHERE id = ?4",
        params![status, apply_summary, Utc::now().to_rfc3339(), id],
    )?;
    Ok(())
}

pub fn save_workspace_bridge_status(path: &Path, status: &WorkspaceBridgeStatus) -> anyhow::Result<()> {
    let connection = Connection::open(path)?;
    let Some(workspace_id) = status.workspace_id.as_deref() else {
        return Ok(());
    };
    connection.execute(
        r#"
        INSERT INTO workspace_bridge_snapshots (
            workspace_id, workspace_name, workspace_root, candidate_files_json,
            selected_file_paths_json, heartbeat_at, updated_at, plugin_version, status, message
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
        ON CONFLICT(workspace_id) DO UPDATE SET
            workspace_name = excluded.workspace_name,
            workspace_root = excluded.workspace_root,
            candidate_files_json = excluded.candidate_files_json,
            selected_file_paths_json = excluded.selected_file_paths_json,
            heartbeat_at = excluded.heartbeat_at,
            updated_at = excluded.updated_at,
            plugin_version = excluded.plugin_version,
            status = excluded.status,
            message = excluded.message
        "#,
        params![
            workspace_id,
            status.workspace_name,
            status.workspace_root,
            serde_json::to_string(&status.candidate_files)?,
            serde_json::to_string(&status.selected_file_paths)?,
            status.heartbeat_at,
            status.updated_at,
            status.plugin_version,
            status.status,
            status.message
        ],
    )?;
    Ok(())
}

pub fn load_workspace_bridge_selection(path: &Path, workspace_id: &str) -> anyhow::Result<Vec<String>> {
    let connection = Connection::open(path)?;
    let selected_json = connection
        .query_row(
            "SELECT selected_file_paths_json FROM workspace_bridge_snapshots WHERE workspace_id = ?1",
            params![workspace_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    Ok(selected_json
        .and_then(|value| serde_json::from_str::<Vec<String>>(&value).ok())
        .unwrap_or_default())
}

pub fn save_learning_card_candidates(
    path: &Path,
    candidates: &[LearningCardCandidate],
) -> anyhow::Result<Vec<LearningCardCandidate>> {
    let connection = Connection::open(path)?;
    let mut created = Vec::new();
    for candidate in candidates {
        let changed = connection.execute(
            r#"
            INSERT OR IGNORE INTO learning_card_candidates (
                id, source_kind, source_id, workspace_id, report_id, finding_id, title, content,
                tags_json, difficulty, status, dedupe_key, created_at
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
            "#,
            params![
                candidate.id,
                candidate.source_kind,
                candidate.source_id,
                candidate.workspace_id,
                candidate.report_id,
                candidate.finding_id,
                candidate.title,
                candidate.content,
                serde_json::to_string(&candidate.tags)?,
                candidate.difficulty,
                candidate.status,
                candidate.dedupe_key,
                candidate.created_at
            ],
        )?;
        if changed > 0 {
            created.push(candidate.clone());
        }
    }
    Ok(created)
}

pub fn list_learning_card_candidates(
    path: &Path,
    status: Option<String>,
    source_id: Option<String>,
) -> anyhow::Result<Vec<LearningCardCandidate>> {
    let connection = Connection::open(path)?;
    let status = normalized_filter(status);
    let source_id = normalized_filter(source_id);
    let mut statement = connection.prepare(
        r#"
        SELECT id, source_kind, source_id, workspace_id, report_id, finding_id, title, content,
               tags_json, difficulty, status, dedupe_key, created_at
        FROM learning_card_candidates
        WHERE (:status IS NULL OR status = :status)
          AND (:source_id IS NULL OR source_id = :source_id)
        ORDER BY created_at DESC
        LIMIT 300
        "#,
    )?;
    let rows = statement
        .query_map(
            rusqlite::named_params! {
                ":status": status.as_deref(),
                ":source_id": source_id.as_deref()
            },
            row_to_learning_card_candidate,
        )?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

pub fn approve_learning_card_candidates(
    path: &Path,
    candidate_ids: Vec<String>,
) -> anyhow::Result<Vec<LearningCard>> {
    let connection = Connection::open(path)?;
    let mut cards = Vec::new();
    for candidate_id in candidate_ids {
        let candidate = connection
            .query_row(
                r#"
                SELECT id, source_kind, source_id, workspace_id, report_id, finding_id, title, content,
                       tags_json, difficulty, status, dedupe_key, created_at
                FROM learning_card_candidates
                WHERE id = ?1
                "#,
                params![candidate_id],
                row_to_learning_card_candidate,
            )
            .optional()?;
        let Some(candidate) = candidate else {
            continue;
        };
        if candidate.status == "approved" {
            continue;
        }
        let card = create_learning_card(
            path,
            LearningCardCreate {
                finding_id: candidate.finding_id.clone(),
                workspace_id: candidate.workspace_id.clone(),
                title: candidate.title.clone(),
                content: candidate.content.clone(),
                tags: candidate.tags.clone(),
            },
        )?;
        connection.execute(
            "UPDATE learning_card_candidates SET status = 'approved' WHERE id = ?1",
            params![candidate.id],
        )?;
        cards.push(card);
    }
    Ok(cards)
}

pub fn reject_learning_card_candidate(path: &Path, id: &str) -> anyhow::Result<()> {
    let connection = Connection::open(path)?;
    connection.execute(
        "UPDATE learning_card_candidates SET status = 'rejected' WHERE id = ?1",
        params![id],
    )?;
    Ok(())
}

pub fn list_learning_calendar(path: &Path, month: &str) -> anyhow::Result<Vec<LearningCalendarItem>> {
    let prefix = if month.trim().len() >= 7 {
        month.trim()[..7].to_string()
    } else {
        Utc::now().format("%Y-%m").to_string()
    };
    let connection = Connection::open(path)?;
    let mut items = Vec::new();
    for day in 1..=31 {
        let date = format!("{prefix}-{day:02}");
        let parsed = chrono::NaiveDate::parse_from_str(&date, "%Y-%m-%d");
        if parsed.is_err() {
            continue;
        }
        let like = format!("{date}%");
        let has_log = connection
            .query_row(
                "SELECT id FROM daily_logs WHERE log_date = ?1",
                params![date],
                |row| row.get::<_, String>(0),
            )
            .optional()?
            .is_some();
        let activity_count = count_where_like(&connection, "activity_events", "created_at", &like)?;
        let report_count = count_where_like(&connection, "reports", "created_at", &like)?;
        let card_count = count_where_like(&connection, "learning_cards", "created_at", &like)?;
        let agent_task_count = count_where_like(&connection, "agent_tasks", "created_at", &like)?;
        items.push(LearningCalendarItem {
            date,
            has_log,
            activity_count,
            report_count,
            card_count,
            agent_task_count,
        });
    }
    Ok(items)
}

pub fn record_activity_event(
    path: &Path,
    event_type: &str,
    title: &str,
    detail: &str,
    entity_kind: Option<&str>,
    entity_id: Option<&str>,
) -> anyhow::Result<ActivityEvent> {
    let connection = Connection::open(path)?;
    let event = ActivityEvent {
        id: Uuid::new_v4().to_string(),
        event_type: event_type.to_string(),
        title: title.to_string(),
        detail: detail.to_string(),
        entity_kind: entity_kind.map(str::to_string),
        entity_id: entity_id.map(str::to_string),
        created_at: Utc::now().to_rfc3339(),
    };
    connection.execute(
        r#"
        INSERT INTO activity_events (
            id, event_type, title, detail, entity_kind, entity_id, created_at
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
        "#,
        params![
            event.id,
            event.event_type,
            event.title,
            event.detail,
            event.entity_kind,
            event.entity_id,
            event.created_at
        ],
    )?;
    Ok(event)
}

pub fn save_activity_events(path: &Path, events: &[ActivityEvent]) -> anyhow::Result<usize> {
    let connection = Connection::open(path)?;
    let mut imported = 0;
    for event in events {
        connection.execute(
            r#"
            INSERT OR REPLACE INTO activity_events (
                id, event_type, title, detail, entity_kind, entity_id, created_at
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
            "#,
            params![
                event.id,
                event.event_type,
                event.title,
                event.detail,
                event.entity_kind,
                event.entity_id,
                event.created_at
            ],
        )?;
        imported += 1;
    }
    Ok(imported)
}

pub fn get_activity_summary(path: &Path) -> anyhow::Result<ActivitySummary> {
    let connection = Connection::open(path)?;
    let report_count = count_table(&connection, "reports")?;
    let chat_count = count_table(&connection, "chat_messages")?;
    let card_count = count_table(&connection, "learning_cards")?;
    let workspace_count = count_table(&connection, "workspaces")?;
    let finding_count = count_table(&connection, "findings")?;
    let agent_task_count = count_table(&connection, "agent_tasks")?;
    let recent_events = list_recent_events_for_connection(&connection, 60)?;
    let daily_counts = list_daily_activity_counts(&connection)?;
    Ok(ActivitySummary {
        report_count,
        chat_count,
        card_count,
        workspace_count,
        finding_count,
        agent_task_count,
        recent_events,
        daily_counts,
    })
}

pub fn get_activity_galaxy_data(path: &Path) -> anyhow::Result<ActivityGalaxyData> {
    let summary = get_activity_summary(path)?;
    let mut nodes = vec![
        ActivityNode { id: "reports".to_string(), label: "历史报告".to_string(), group: "analysis".to_string(), weight: summary.report_count.max(1) },
        ActivityNode { id: "workspaces".to_string(), label: "工作区".to_string(), group: "analysis".to_string(), weight: summary.workspace_count.max(1) },
        ActivityNode { id: "findings".to_string(), label: "问题清单".to_string(), group: "review".to_string(), weight: summary.finding_count.max(1) },
        ActivityNode { id: "cards".to_string(), label: "知识卡片".to_string(), group: "learning".to_string(), weight: summary.card_count.max(1) },
        ActivityNode { id: "chats".to_string(), label: "AI 对话".to_string(), group: "ai".to_string(), weight: summary.chat_count.max(1) },
        ActivityNode { id: "agent".to_string(), label: "行动草稿".to_string(), group: "agent".to_string(), weight: summary.agent_task_count.max(1) },
    ];
    let connection = Connection::open(path)?;
    let daily_log_count = count_table(&connection, "daily_logs")?;
    let activity_count = count_table(&connection, "activity_events")?;
    nodes.push(ActivityNode { id: "logs".to_string(), label: "每日学习".to_string(), group: "logs".to_string(), weight: daily_log_count.max(1) });
    nodes.push(ActivityNode { id: "activity".to_string(), label: "活动轨迹".to_string(), group: "logs".to_string(), weight: activity_count.max(1) });

    let mut links = vec![
        ActivityLink { source: "workspaces".to_string(), target: "reports".to_string(), weight: summary.report_count.max(1) },
        ActivityLink { source: "reports".to_string(), target: "findings".to_string(), weight: summary.finding_count.max(1) },
        ActivityLink { source: "findings".to_string(), target: "cards".to_string(), weight: summary.card_count.max(1) },
        ActivityLink { source: "reports".to_string(), target: "chats".to_string(), weight: summary.chat_count.max(1) },
        ActivityLink { source: "findings".to_string(), target: "agent".to_string(), weight: summary.agent_task_count.max(1) },
    ];
    links.push(ActivityLink { source: "cards".to_string(), target: "logs".to_string(), weight: daily_log_count.max(1) });
    links.push(ActivityLink { source: "logs".to_string(), target: "activity".to_string(), weight: activity_count.max(1) });
    links.push(ActivityLink { source: "agent".to_string(), target: "activity".to_string(), weight: summary.agent_task_count.max(1) });

    let mut seen_node_ids = nodes.iter().map(|node| node.id.clone()).collect::<HashSet<_>>();
    for (index, event) in summary.recent_events.iter().take(48).enumerate() {
        let node_id = galaxy_node_id_for_event(event);
        if !seen_node_ids.insert(node_id.clone()) {
            continue;
        }
        let (group, hub_id) = galaxy_group_and_hub_for_event(event);
        let weight = recent_activity_weight(index);
        nodes.push(ActivityNode {
            id: node_id.clone(),
            label: compact_galaxy_label(&event.title, &event.detail),
            group: group.to_string(),
            weight,
        });
        links.push(ActivityLink {
            source: hub_id.to_string(),
            target: node_id,
            weight,
        });
    }
    Ok(ActivityGalaxyData { nodes, links })
}

pub fn get_activity_constellation(path: &Path, limit: Option<usize>) -> anyhow::Result<ActivityConstellationData> {
    let connection = Connection::open(path)?;
    let resolved_limit = limit.unwrap_or(300).clamp(1, 300);
    let events = list_recent_events_for_connection(&connection, resolved_limit)?;
    let code_line_count = total_workspace_lines(&connection)?;
    let items = events
        .into_iter()
        .enumerate()
        .map(|(index, event)| activity_star_from_event(event, index))
        .collect();
    Ok(ActivityConstellationData { items, code_line_count })
}

fn total_workspace_lines(connection: &Connection) -> anyhow::Result<usize> {
    let total: i64 = connection.query_row(
        "SELECT COALESCE(SUM(total_lines), 0) FROM workspaces",
        [],
        |row| row.get(0),
    )?;
    Ok(total.max(0) as usize)
}

fn activity_star_from_event(event: ActivityEvent, index: usize) -> ActivityStarItem {
    let kind = activity_star_kind(&event);
    let target_id = event.entity_id.clone().unwrap_or_else(|| event.id.clone());
    let route = activity_star_route(&kind, &target_id);
    ActivityStarItem {
        id: galaxy_node_id_for_event(&event),
        kind: kind.to_string(),
        kind_label: activity_star_kind_label(kind).to_string(),
        title: event.title,
        subtitle: event.detail,
        status: "active".to_string(),
        target_id,
        created_at: event.created_at,
        route: Some(route),
        weight: recent_activity_weight(index),
    }
}

fn activity_star_kind(event: &ActivityEvent) -> &'static str {
    let source = event.entity_kind.as_deref().unwrap_or(&event.event_type);
    match source {
        "workspace" => "workspace",
        "report" | "product_archive" => "report",
        "finding" => "finding",
        "learning_card" | "card" | "card_candidate" | "card_material" => "card",
        "daily_log" => "log",
        "chat" | "chat_session" => "chat",
        "agent" | "agent_task" => "agent",
        _ => match event.event_type.as_str() {
            "workspace" => "workspace",
            "report" | "guide" | "export" | "import" => "report",
            "finding" => "finding",
            "card" | "card_candidate" => "card",
            "daily_log" => "log",
            "chat" => "chat",
            "agent" => "agent",
            _ => "activity",
        },
    }
}

fn activity_star_kind_label(kind: &str) -> &'static str {
    match kind {
        "workspace" => "工作区",
        "report" => "报告",
        "finding" => "问题",
        "card" => "知识卡片",
        "log" => "每日日志",
        "chat" => "对话",
        "agent" => "行动草稿",
        _ => "活动",
    }
}

fn activity_star_route(kind: &str, target_id: &str) -> ActivityStarRoute {
    let page = match kind {
        "workspace" => "projects",
        "report" => "history",
        "finding" => "findings",
        "card" => "cards",
        "log" => "logs",
        "chat" => "chat",
        "agent" => "agent",
        _ => "galaxy",
    };
    ActivityStarRoute {
        page: Some(page.to_string()),
        target_id: Some(target_id.to_string()),
        session_id: (kind == "chat").then(|| target_id.to_string()),
        plan_id: (kind == "agent").then(|| target_id.to_string()),
        context_type: Some(activity_star_kind_label(kind).to_string()),
    }
}

fn galaxy_node_id_for_event(event: &ActivityEvent) -> String {
    match (event.entity_kind.as_deref(), event.entity_id.as_deref()) {
        (Some("report"), Some(id)) => format!("report:{id}"),
        (Some("workspace"), Some(id)) => format!("workspace:{id}"),
        (Some("finding"), Some(id)) => format!("finding:{id}"),
        (Some("learning_card"), Some(id)) => format!("card:{id}"),
        (Some("card_material"), Some(id)) => format!("card_material:{id}"),
        (Some("daily_log"), Some(id)) => format!("daily_log:{id}"),
        (Some("chat_session"), Some(id)) => format!("chat:{id}"),
        (Some("agent_task"), Some(id)) => format!("agent_task:{id}"),
        (Some(kind), Some(id)) => format!("{kind}:{id}"),
        _ => format!("event:{}", event.id),
    }
}

fn galaxy_group_and_hub_for_event(event: &ActivityEvent) -> (&'static str, &'static str) {
    let source = event.entity_kind.as_deref().unwrap_or(&event.event_type);
    match source {
        "workspace" => ("analysis", "workspaces"),
        "report" | "product_archive" => ("analysis", "reports"),
        "finding" => ("review", "findings"),
        "learning_card" | "card_material" => ("learning", "cards"),
        "daily_log" => ("logs", "logs"),
        "chat_session" => ("ai", "chats"),
        "agent_task" => ("agent", "agent"),
        _ => match event.event_type.as_str() {
            "workspace" => ("analysis", "workspaces"),
            "report" | "guide" | "export" | "import" => ("analysis", "reports"),
            "finding" => ("review", "findings"),
            "card" | "card_candidate" => ("learning", "cards"),
            "daily_log" => ("logs", "logs"),
            "chat" => ("ai", "chats"),
            "agent" => ("agent", "agent"),
            _ => ("logs", "activity"),
        },
    }
}

fn recent_activity_weight(index: usize) -> usize {
    6usize.saturating_sub(index / 10).max(1)
}

fn compact_galaxy_label(title: &str, detail: &str) -> String {
    let source = if detail.trim().is_empty() { title } else { detail };
    let cleaned = source.trim().replace('\n', " ");
    if cleaned.chars().count() <= 18 {
        cleaned
    } else {
        format!("{}…", cleaned.chars().take(18).collect::<String>())
    }
}

pub fn get_traceability_snapshot(
    path: &Path,
    scope_kind: Option<String>,
    scope_id: Option<String>,
) -> anyhow::Result<TraceabilitySnapshot> {
    let connection = Connection::open(path)?;
    let scope_kind = normalized_filter(scope_kind).unwrap_or_else(|| "global".to_string());
    let scope_id = normalized_filter(scope_id);
    match scope_kind.as_str() {
        "report" => {
            let report_id = scope_id.ok_or_else(|| anyhow!("缺少报告 ID，无法生成关联洞察。"))?;
            traceability_for_report(path, &connection, &report_id)
        }
        "workspace" => {
            let workspace_id = scope_id.ok_or_else(|| anyhow!("缺少工作区 ID，无法生成关联洞察。"))?;
            traceability_for_workspace(path, &connection, &workspace_id)
        }
        _ => traceability_global(&connection),
    }
}

fn traceability_for_report(
    path: &Path,
    connection: &Connection,
    report_id: &str,
) -> anyhow::Result<TraceabilitySnapshot> {
    let report = get_report(path, report_id)?;
    let workspace_id = workspace_id_from_metadata(&report.metadata_json);
    let workspace = workspace_id
        .as_deref()
        .and_then(|id| get_workspace_summary_for_connection(connection, id).ok().flatten());
    let findings = list_findings(path, None, None, None, Some(report_id.to_string()))?;
    let finding_ids = findings.iter().map(|item| item.id.clone()).collect::<Vec<_>>();
    let cards = list_cards_for_finding_ids_connection(connection, &finding_ids)?;
    let chats = list_chat_sessions_for_report_connection(connection, report_id)?;
    let mut agents = list_agent_tasks_for_context_connection(connection, "report", report_id)?;
    for finding in &findings {
        agents.extend(list_agent_tasks_for_context_connection(connection, "finding", &finding.id)?);
    }
    agents.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
    agents.dedup_by(|left, right| left.id == right.id);
    let daily_logs = list_daily_logs_like_connection(connection, &report.title)?;
    let events = list_activity_events_for_entity_connection(connection, Some("report"), Some(report_id), 12)?;

    let mut nodes = Vec::new();
    let mut links = Vec::new();
    let report_node = trace_node_id("report", &report.id);
    push_trace_node(
        &mut nodes,
        "report",
        &report.id,
        &report.title,
        &format!("{} · {} · {}", report_type_label(&report.report_type), risk_label(&report.risk_level), report.created_at),
        &report.risk_level,
        report.metrics.risk_count.max(1),
    );

    if let Some(workspace) = &workspace {
        push_trace_node(
            &mut nodes,
            "workspace",
            &workspace.id,
            &workspace.name,
            &format!("{} 个文件 · {} 行 · {}", workspace.file_count, workspace.total_lines, workspace.language_summary),
            "linked",
            workspace.file_count.max(1),
        );
        push_trace_link(&mut links, &trace_node_id("workspace", &workspace.id), &report_node, "生成报告", 1);
    }

    for finding in findings.iter().take(10) {
        let node_id = trace_node_id("finding", &finding.id);
        push_trace_node(
            &mut nodes,
            "finding",
            &finding.id,
            &finding.title,
            &format!("{} · {} · {}", finding.file_path, severity_label(&finding.severity), status_label(&finding.status)),
            &finding.status,
            severity_weight(&finding.severity),
        );
        push_trace_link(&mut links, &report_node, &node_id, "拆解问题", 1);
    }

    for card in cards.iter().take(10) {
        let node_id = trace_node_id("card", &card.id);
        push_trace_node(
            &mut nodes,
            "card",
            &card.id,
            &card.title,
            &format!("{} · {}", card.status, card.tags.join("、")),
            &card.status,
            1,
        );
        if let Some(finding_id) = &card.finding_id {
            push_trace_link(&mut links, &trace_node_id("finding", finding_id), &node_id, "沉淀卡片", 1);
        } else {
            push_trace_link(&mut links, &report_node, &node_id, "沉淀卡片", 1);
        }
    }

    for chat in chats.iter().take(6) {
        let node_id = trace_node_id("chat", &chat.id);
        push_trace_node(
            &mut nodes,
            "chat",
            &chat.id,
            &chat.title,
            &format!("{} 条消息 · {}", chat.message_count, chat.updated_at),
            "linked",
            chat.message_count.max(1),
        );
        push_trace_link(&mut links, &report_node, &node_id, "继续对话", chat.message_count.max(1));
    }

    for agent in agents.iter().take(8) {
        let node_id = trace_node_id("agent", &agent.id);
        push_trace_node(
            &mut nodes,
            "agent",
            &agent.id,
            &agent.title,
            &format!("{} · {} 个步骤 · {} 个文件操作", status_label(&agent.status), agent.steps.len(), agent.operations.len()),
            &agent.status,
            agent.operations.len().max(1),
        );
        let source = if agent.context_kind == "finding" {
            trace_node_id("finding", &agent.context_id)
        } else {
            report_node.clone()
        };
        push_trace_link(&mut links, &source, &node_id, "生成计划", 1);
    }

    for log in daily_logs.iter().take(4) {
        let node_id = trace_node_id("daily_log", &log.id);
        push_trace_node(
            &mut nodes,
            "daily_log",
            &log.id,
            &log.title,
            &format!("{} · {}", log.date, log.updated_at),
            "linked",
            1,
        );
        push_trace_link(&mut links, &report_node, &node_id, "写入日志", 1);
    }

    for event in events.iter().take(8) {
        push_trace_node(
            &mut nodes,
            "activity",
            &event.id,
            &event.title,
            &format!("{} · {}", event_type_label(&event.event_type), event.created_at),
            "recorded",
            1,
        );
    }

    let mut gaps = Vec::new();
    let mut next_actions = Vec::new();
    if workspace.is_none() {
        gaps.push("这份报告还没有关联工作区，后续 Agent 无法安全定位真实项目根目录。".to_string());
        next_actions.push("从项目页导入真实工作区，再生成工作区审查报告。".to_string());
    }
    if findings.is_empty() {
        gaps.push("报告尚未拆解为结构化问题，问题清单无法按状态追踪。".to_string());
        next_actions.push("基于工作区重新生成审查报告，让本地规则产出 findings。".to_string());
    }
    if cards.is_empty() {
        gaps.push("报告风险尚未沉淀为知识卡片。".to_string());
        next_actions.push("点击“生成知识卡片”，审核候选后写入学习系统。".to_string());
    }
    if chats.is_empty() {
        gaps.push("还没有围绕此报告继续追问。".to_string());
        next_actions.push("点击“围绕报告对话”，让 AI 解释关键风险和修复顺序。".to_string());
    }
    if agents.is_empty() {
        gaps.push("还没有为此报告生成可确认的行动草稿。".to_string());
        next_actions.push("点击“生成行动草稿”，把报告转成可审核的本地草稿。".to_string());
    }
    if daily_logs.is_empty() {
        gaps.push("报告尚未写入每日学习日志。".to_string());
        next_actions.push("点击“加入每日日志”，把审查结果沉淀到当天复盘。".to_string());
    }
    if gaps.is_empty() {
        next_actions.push("这份报告已经串起主要闭环，下一步可复查未解决问题或写入行动草稿。".to_string());
    }

    Ok(TraceabilitySnapshot {
        scope_kind: "report".to_string(),
        scope_id: Some(report.id),
        title: format!("报告闭环：{}", report.title),
        counts: TraceabilityCounts {
            workspaces: workspace.iter().count(),
            reports: 1,
            findings: findings.len(),
            cards: cards.len(),
            chats: chats.len(),
            daily_logs: daily_logs.len(),
            agent_tasks: agents.len(),
            activity_events: events.len(),
        },
        nodes,
        links,
        gaps,
        next_actions,
        generated_at: Utc::now().to_rfc3339(),
    })
}

fn traceability_for_workspace(
    path: &Path,
    connection: &Connection,
    workspace_id: &str,
) -> anyhow::Result<TraceabilitySnapshot> {
    let workspace = get_workspace_summary_for_connection(connection, workspace_id)?
        .ok_or_else(|| anyhow!("workspace not found: {workspace_id}"))?;
    let reports = list_reports_for_workspace_connection(connection, workspace_id)?;
    let findings = list_findings(path, Some(workspace_id.to_string()), None, None, None)?;
    let cards = list_learning_cards(path, Some(workspace_id.to_string()), None, None)?;
    let agents = list_agent_tasks_for_context_connection(connection, "workspace", workspace_id)?;
    let daily_logs = list_daily_logs_like_connection(connection, &workspace.name)?;
    let events = list_activity_events_for_entity_connection(connection, Some("workspace"), Some(workspace_id), 12)?;

    let mut nodes = Vec::new();
    let mut links = Vec::new();
    let workspace_node = trace_node_id("workspace", &workspace.id);
    push_trace_node(
        &mut nodes,
        "workspace",
        &workspace.id,
        &workspace.name,
        &format!("{} 个文件 · {} 行 · {}", workspace.file_count, workspace.total_lines, workspace.language_summary),
        "linked",
        workspace.file_count.max(1),
    );
    for report in reports.iter().take(10) {
        let node_id = trace_node_id("report", &report.id);
        push_trace_node(
            &mut nodes,
            "report",
            &report.id,
            &report.title,
            &format!("{} · {} · {} 个风险", report_type_label(&report.report_type), risk_label(&report.risk_level), report.risk_count),
            &report.risk_level,
            report.risk_count.max(1),
        );
        push_trace_link(&mut links, &workspace_node, &node_id, "生成报告", 1);
    }
    for finding in findings.iter().take(12) {
        let node_id = trace_node_id("finding", &finding.id);
        push_trace_node(
            &mut nodes,
            "finding",
            &finding.id,
            &finding.title,
            &format!("{} · {} · {}", finding.file_path, severity_label(&finding.severity), status_label(&finding.status)),
            &finding.status,
            severity_weight(&finding.severity),
        );
        if let Some(report_id) = &finding.report_id {
            push_trace_link(&mut links, &trace_node_id("report", report_id), &node_id, "拆解问题", 1);
        } else {
            push_trace_link(&mut links, &workspace_node, &node_id, "本地规则发现", 1);
        }
    }
    for card in cards.iter().take(12) {
        let node_id = trace_node_id("card", &card.id);
        push_trace_node(
            &mut nodes,
            "card",
            &card.id,
            &card.title,
            &format!("{} · {}", card.status, card.tags.join("、")),
            &card.status,
            1,
        );
        if let Some(finding_id) = &card.finding_id {
            push_trace_link(&mut links, &trace_node_id("finding", finding_id), &node_id, "沉淀卡片", 1);
        } else {
            push_trace_link(&mut links, &workspace_node, &node_id, "手动卡片", 1);
        }
    }
    for agent in agents.iter().take(8) {
        let node_id = trace_node_id("agent", &agent.id);
        push_trace_node(
            &mut nodes,
            "agent",
            &agent.id,
            &agent.title,
            &format!("{} · {} 个文件操作", status_label(&agent.status), agent.operations.len()),
            &agent.status,
            agent.operations.len().max(1),
        );
        push_trace_link(&mut links, &workspace_node, &node_id, "生成计划", 1);
    }
    for log in daily_logs.iter().take(4) {
        let node_id = trace_node_id("daily_log", &log.id);
        push_trace_node(
            &mut nodes,
            "daily_log",
            &log.id,
            &log.title,
            &format!("{} · {}", log.date, log.updated_at),
            "linked",
            1,
        );
        push_trace_link(&mut links, &workspace_node, &node_id, "写入日志", 1);
    }
    for event in events.iter().take(8) {
        push_trace_node(
            &mut nodes,
            "activity",
            &event.id,
            &event.title,
            &format!("{} · {}", event_type_label(&event.event_type), event.created_at),
            "recorded",
            1,
        );
    }

    let mut gaps = Vec::new();
    let mut next_actions = Vec::new();
    if reports.is_empty() {
        gaps.push("工作区还没有生成审查报告。".to_string());
        next_actions.push("在项目页点击“分析工作区”，先形成项目级报告。".to_string());
    }
    if findings.is_empty() {
        gaps.push("工作区尚未形成结构化问题清单。".to_string());
        next_actions.push("生成工作区审查报告后，进入问题清单更新状态。".to_string());
    }
    if cards.is_empty() {
        gaps.push("工作区问题还没有沉淀为知识卡片。".to_string());
        next_actions.push("从问题清单生成学习卡片，并标记掌握状态。".to_string());
    }
    if agents.is_empty() {
        gaps.push("工作区还没有行动草稿。".to_string());
        next_actions.push("选择高风险文件作为上下文，生成确认式行动草稿。".to_string());
    }
    if daily_logs.is_empty() {
        gaps.push("工作区还没有进入每日学习日志。".to_string());
        next_actions.push("在每日日志中记录本次审查结论和明日动作。".to_string());
    }
    if gaps.is_empty() {
        next_actions.push("工作区闭环完整，可以继续复查未解决问题或扩展 VS Code 桥接。".to_string());
    }

    Ok(TraceabilitySnapshot {
        scope_kind: "workspace".to_string(),
        scope_id: Some(workspace.id),
        title: format!("工作区闭环：{}", workspace.name),
        counts: TraceabilityCounts {
            workspaces: 1,
            reports: reports.len(),
            findings: findings.len(),
            cards: cards.len(),
            chats: 0,
            daily_logs: daily_logs.len(),
            agent_tasks: agents.len(),
            activity_events: events.len(),
        },
        nodes,
        links,
        gaps,
        next_actions,
        generated_at: Utc::now().to_rfc3339(),
    })
}

fn traceability_global(connection: &Connection) -> anyhow::Result<TraceabilitySnapshot> {
    let counts = TraceabilityCounts {
        workspaces: count_table(connection, "workspaces")?,
        reports: count_table(connection, "reports")?,
        findings: count_table(connection, "findings")?,
        cards: count_table(connection, "learning_cards")?,
        chats: count_table(connection, "chat_sessions")?,
        daily_logs: count_table(connection, "daily_logs")?,
        agent_tasks: count_table(connection, "agent_tasks")?,
        activity_events: count_table(connection, "activity_events")?,
    };
    let mut nodes = Vec::new();
    let mut links = Vec::new();
    push_trace_node(&mut nodes, "workspace", "all", "工作区", &format!("{} 个", counts.workspaces), "summary", counts.workspaces.max(1));
    push_trace_node(&mut nodes, "report", "all", "历史报告", &format!("{} 份", counts.reports), "summary", counts.reports.max(1));
    push_trace_node(&mut nodes, "finding", "all", "问题清单", &format!("{} 个", counts.findings), "summary", counts.findings.max(1));
    push_trace_node(&mut nodes, "card", "all", "知识卡片", &format!("{} 张", counts.cards), "summary", counts.cards.max(1));
    push_trace_node(&mut nodes, "chat", "all", "AI 对话", &format!("{} 个会话", counts.chats), "summary", counts.chats.max(1));
    push_trace_node(&mut nodes, "daily_log", "all", "每日日志", &format!("{} 篇", counts.daily_logs), "summary", counts.daily_logs.max(1));
    push_trace_node(&mut nodes, "agent", "all", "行动草稿", &format!("{} 个", counts.agent_tasks), "summary", counts.agent_tasks.max(1));
    push_trace_link(&mut links, "workspace:all", "report:all", "分析", counts.reports.max(1));
    push_trace_link(&mut links, "report:all", "finding:all", "拆解", counts.findings.max(1));
    push_trace_link(&mut links, "finding:all", "card:all", "沉淀", counts.cards.max(1));
    push_trace_link(&mut links, "report:all", "chat:all", "追问", counts.chats.max(1));
    push_trace_link(&mut links, "finding:all", "agent:all", "计划", counts.agent_tasks.max(1));
    push_trace_link(&mut links, "report:all", "daily_log:all", "复盘", counts.daily_logs.max(1));

    let mut gaps = Vec::new();
    let mut next_actions = Vec::new();
    if counts.workspaces == 0 {
        gaps.push("还没有导入真实项目工作区。".to_string());
        next_actions.push("先导入一个本地项目，建立代码索引和工作区。".to_string());
    }
    if counts.reports == 0 {
        gaps.push("还没有生成可追踪报告。".to_string());
        next_actions.push("对工作区生成项目级审查报告。".to_string());
    }
    if counts.cards == 0 {
        gaps.push("还没有学习卡片沉淀。".to_string());
        next_actions.push("从高风险问题或报告建议生成知识卡片。".to_string());
    }
    if counts.agent_tasks == 0 {
        gaps.push("还没有行动草稿。".to_string());
        next_actions.push("围绕工作区、问题或报告生成确认式行动草稿。".to_string());
    }
    if gaps.is_empty() {
        next_actions.push("全局闭环已经可用，下一步重点是验证真实项目长期使用体验。".to_string());
    }

    Ok(TraceabilitySnapshot {
        scope_kind: "global".to_string(),
        scope_id: None,
        title: "本地产品闭环总览".to_string(),
        counts,
        nodes,
        links,
        gaps,
        next_actions,
        generated_at: Utc::now().to_rfc3339(),
    })
}

fn backup_database(path: &Path) -> anyhow::Result<()> {
    let parent = path.parent().ok_or_else(|| anyhow!("database path has no parent"))?;
    let backup_dir = parent.join("backups");
    fs::create_dir_all(&backup_dir)?;
    let backup_path = backup_dir.join(format!(
        "codelens-next-{}.sqlite",
        Utc::now().format("%Y%m%d-%H%M%S")
    ));
    fs::copy(path, backup_path)?;
    Ok(())
}

fn add_column_if_missing(
    connection: &Connection,
    table: &str,
    column: &str,
    sql: &str,
) -> anyhow::Result<()> {
    if !table_has_column(connection, table, column)? {
        connection.execute(sql, [])?;
    }
    Ok(())
}

fn table_has_column(connection: &Connection, table: &str, column: &str) -> anyhow::Result<bool> {
    let mut statement = connection.prepare(&format!("PRAGMA table_info({table})"))?;
    let rows = statement.query_map([], |row| row.get::<_, String>(1))?;
    for row in rows {
        if row? == column {
            return Ok(true);
        }
    }
    Ok(false)
}

fn get_setting(connection: &Connection, key: &str) -> anyhow::Result<Option<String>> {
    connection
        .query_row(
            "SELECT value FROM settings WHERE key = ?1",
            params![key],
            |row| row.get(0),
        )
        .optional()
        .map_err(Into::into)
}

fn load_model_profiles_from_connection(connection: &Connection) -> anyhow::Result<Vec<ModelProfile>> {
    match get_setting(connection, "model_profiles_json")? {
        Some(value) if !value.trim().is_empty() => {
            let mut profiles = serde_json::from_str::<Vec<ModelProfile>>(&value)
                .context("failed to parse model profiles")?;
            profiles.sort_by(|left, right| {
                right
                    .is_default
                    .cmp(&left.is_default)
                    .then_with(|| right.updated_at.cmp(&left.updated_at))
            });
            Ok(profiles)
        }
        _ => Ok(default_model_profiles()),
    }
}

fn save_model_profiles_to_connection(connection: &Connection, profiles: &[ModelProfile]) -> anyhow::Result<()> {
    set_setting(connection, "model_profiles_json", &serde_json::to_string(profiles)?)?;
    Ok(())
}

fn default_model_profiles() -> Vec<ModelProfile> {
    let built_at = "1970-01-01T00:00:00Z".to_string();
    vec![
        ModelProfile {
            id: "builtin-deepseek-chat".to_string(),
            name: "DeepSeek Chat".to_string(),
            api_base: "https://api.deepseek.com/v1".to_string(),
            model: "deepseek-chat".to_string(),
            note: "适合中文代码审查、报告生成、项目导览和学习材料。".to_string(),
            is_default: true,
            created_at: built_at.clone(),
            updated_at: built_at.clone(),
        },
        ModelProfile {
            id: "builtin-openai-compatible".to_string(),
            name: "OpenAI Compatible".to_string(),
            api_base: "https://api.openai.com/v1".to_string(),
            model: "gpt-4.1-mini".to_string(),
            note: "适合 OpenAI-compatible 云端模型和通用对话接口。".to_string(),
            is_default: false,
            created_at: built_at.clone(),
            updated_at: built_at.clone(),
        },
        ModelProfile {
            id: "builtin-local-gateway".to_string(),
            name: "Local Gateway".to_string(),
            api_base: "http://127.0.0.1:11434/v1".to_string(),
            model: "local-model".to_string(),
            note: "适合本地模型网关、局域网代理或离线增强能力。".to_string(),
            is_default: false,
            created_at: built_at.clone(),
            updated_at: built_at,
        },
    ]
}

fn set_setting(connection: &Connection, key: &str, value: &str) -> anyhow::Result<()> {
    connection.execute(
        r#"
        INSERT INTO settings (key, value)
        VALUES (?1, ?2)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
        "#,
        params![key, value],
    )?;
    Ok(())
}

fn insert_finding_tx(tx: &rusqlite::Transaction<'_>, finding: &Finding) -> anyhow::Result<()> {
    tx.execute(
        r#"
        INSERT OR REPLACE INTO findings (
            id, workspace_id, report_id, file_path, severity, category, title, detail,
            line_start, line_end, suggestion, status, created_at, updated_at
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
        "#,
        params![
            finding.id,
            finding.workspace_id,
            finding.report_id,
            finding.file_path,
            finding.severity,
            finding.category,
            finding.title,
            finding.detail,
            finding.line_start.map(|value| value as i64),
            finding.line_end.map(|value| value as i64),
            finding.suggestion,
            finding.status,
            finding.created_at,
            finding.updated_at
        ],
    )?;
    Ok(())
}

fn insert_learning_card(connection: &Connection, card: &LearningCard) -> anyhow::Result<()> {
    connection.execute(
        r#"
        INSERT OR REPLACE INTO learning_cards (
            id, finding_id, workspace_id, title, content, tags_json, status, created_at, updated_at
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
        "#,
        params![
            card.id,
            card.finding_id,
            card.workspace_id,
            card.title,
            card.content,
            serde_json::to_string(&card.tags)?,
            card.status,
            card.created_at,
            card.updated_at
        ],
    )?;
    Ok(())
}

fn insert_agent_operation_tx(
    tx: &rusqlite::Transaction<'_>,
    operation: &AgentFileOperation,
) -> anyhow::Result<()> {
    tx.execute(
        r#"
        INSERT INTO agent_file_operations (
            id, task_id, path, operation, title, preview, replacement, status,
            confirmed, backup_path, applied_at, error
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
        "#,
        params![
            operation.id,
            operation.task_id,
            operation.path,
            operation.operation,
            operation.title,
            operation.preview,
            operation.replacement,
            operation.status,
            if operation.confirmed { 1 } else { 0 },
            operation.backup_path,
            operation.applied_at,
            operation.error
        ],
    )?;
    Ok(())
}

fn load_findings_for_cards(connection: &Connection, finding_ids: Vec<String>) -> anyhow::Result<Vec<Finding>> {
    if finding_ids.is_empty() {
        let mut statement = connection.prepare(
            r#"
            SELECT id, workspace_id, report_id, file_path, severity, category, title, detail,
                   line_start, line_end, suggestion, status, created_at, updated_at
            FROM findings
            WHERE status != 'resolved'
            ORDER BY CASE severity WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, updated_at DESC
            LIMIT 50
            "#,
        )?;
        return Ok(statement
            .query_map([], row_to_finding)?
            .collect::<Result<Vec<_>, _>>()?);
    }

    let mut findings = Vec::new();
    let mut statement = connection.prepare(
        r#"
        SELECT id, workspace_id, report_id, file_path, severity, category, title, detail,
               line_start, line_end, suggestion, status, created_at, updated_at
        FROM findings
        WHERE id = ?1
        "#,
    )?;
    for id in finding_ids {
        if let Some(finding) = statement.query_row(params![id], row_to_finding).optional()? {
            findings.push(finding);
        }
    }
    Ok(findings)
}

fn get_workspace_summary_for_connection(
    connection: &Connection,
    workspace_id: &str,
) -> anyhow::Result<Option<WorkspaceSummary>> {
    connection
        .query_row(
            r#"
            SELECT id, name, root_path, file_count, total_lines, language_summary, created_at, updated_at
            FROM workspaces
            WHERE id = ?1
            "#,
            params![workspace_id],
            row_to_workspace_summary,
        )
        .optional()
        .map_err(Into::into)
}

fn list_reports_for_workspace_connection(
    connection: &Connection,
    workspace_id: &str,
) -> anyhow::Result<Vec<ReportSummary>> {
    let like = format!("%{workspace_id}%");
    let mut statement = connection.prepare(
        r#"
        SELECT id, title, language, summary, analysis_source, report_type, risk_level,
               file_count, created_at, metrics_json, metadata_json
        FROM reports
        WHERE metadata_json LIKE ?1
        ORDER BY created_at DESC
        LIMIT 120
        "#,
    )?;
    let rows = statement
        .query_map(params![like], row_to_summary)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

fn list_cards_for_finding_ids_connection(
    connection: &Connection,
    finding_ids: &[String],
) -> anyhow::Result<Vec<LearningCard>> {
    if finding_ids.is_empty() {
        return Ok(Vec::new());
    }
    let mut cards = Vec::new();
    let mut statement = connection.prepare(
        r#"
        SELECT id, finding_id, workspace_id, title, content, tags_json, status, created_at, updated_at
        FROM learning_cards
        WHERE finding_id = ?1
        ORDER BY updated_at DESC
        "#,
    )?;
    for id in finding_ids {
        cards.extend(
            statement
                .query_map(params![id], row_to_learning_card)?
                .collect::<Result<Vec<_>, _>>()?,
        );
    }
    cards.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
    cards.dedup_by(|left, right| left.id == right.id);
    Ok(cards)
}

fn list_chat_sessions_for_report_connection(
    connection: &Connection,
    report_id: &str,
) -> anyhow::Result<Vec<ChatSessionSummary>> {
    let mut statement = connection.prepare(
        r#"
        SELECT s.id, s.title, s.context_report_id, s.created_at, s.updated_at,
               COUNT(m.id) AS message_count
        FROM chat_sessions s
        LEFT JOIN chat_messages m ON m.session_id = s.id
        WHERE s.context_report_id = ?1
        GROUP BY s.id
        ORDER BY s.updated_at DESC
        LIMIT 80
        "#,
    )?;
    let rows = statement
        .query_map(params![report_id], row_to_chat_summary)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

fn list_agent_tasks_for_context_connection(
    connection: &Connection,
    context_kind: &str,
    context_id: &str,
) -> anyhow::Result<Vec<AgentTask>> {
    let mut statement = connection.prepare(
        r#"
        SELECT id, context_kind, context_id, title, summary, status,
               selected_file_paths_json, apply_summary, created_at, updated_at
        FROM agent_tasks
        WHERE context_kind = ?1 AND context_id = ?2
        ORDER BY updated_at DESC
        LIMIT 120
        "#,
    )?;
    let mut tasks = statement
        .query_map(params![context_kind, context_id], row_to_agent_task_without_steps)?
        .collect::<Result<Vec<_>, _>>()?;
    for task in &mut tasks {
        task.steps = list_agent_steps_for_connection(connection, &task.id)?;
        task.operations = list_agent_operations_for_connection(connection, &task.id)?;
    }
    Ok(tasks)
}

fn list_daily_logs_like_connection(connection: &Connection, text: &str) -> anyhow::Result<Vec<DailyLog>> {
    let like = format!("%{}%", text.trim());
    let mut statement = connection.prepare(
        r#"
        SELECT id, log_date, title, content, created_at, updated_at
        FROM daily_logs
        WHERE title LIKE ?1 OR content LIKE ?1
        ORDER BY log_date DESC
        LIMIT 40
        "#,
    )?;
    let rows = statement
        .query_map(params![like], row_to_daily_log)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

fn list_activity_events_for_entity_connection(
    connection: &Connection,
    entity_kind: Option<&str>,
    entity_id: Option<&str>,
    limit: usize,
) -> anyhow::Result<Vec<ActivityEvent>> {
    let mut statement = connection.prepare(
        r#"
        SELECT id, event_type, title, detail, entity_kind, entity_id, created_at
        FROM activity_events
        WHERE (:entity_kind IS NULL OR entity_kind = :entity_kind)
          AND (:entity_id IS NULL OR entity_id = :entity_id)
        ORDER BY created_at DESC
        LIMIT :limit
        "#,
    )?;
    let rows = statement
        .query_map(
            rusqlite::named_params! {
                ":entity_kind": entity_kind,
                ":entity_id": entity_id,
                ":limit": limit as i64
            },
            row_to_activity_event,
        )?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

fn workspace_id_from_metadata(metadata_json: &str) -> Option<String> {
    serde_json::from_str::<serde_json::Value>(metadata_json)
        .ok()?
        .get("workspace_id")?
        .as_str()
        .map(str::to_string)
}

fn trace_node_id(kind: &str, id: &str) -> String {
    format!("{kind}:{id}")
}

fn push_trace_node(
    nodes: &mut Vec<TraceabilityNode>,
    kind: &str,
    id: &str,
    title: &str,
    subtitle: &str,
    status: &str,
    weight: usize,
) {
    let node_id = trace_node_id(kind, id);
    if nodes.iter().any(|item| item.id == node_id) {
        return;
    }
    nodes.push(TraceabilityNode {
        id: node_id,
        kind: kind.to_string(),
        title: title.to_string(),
        subtitle: subtitle.to_string(),
        status: status.to_string(),
        weight,
    });
}

fn push_trace_link(
    links: &mut Vec<TraceabilityLink>,
    source: &str,
    target: &str,
    label: &str,
    weight: usize,
) {
    if source == target || links.iter().any(|item| item.source == source && item.target == target && item.label == label) {
        return;
    }
    links.push(TraceabilityLink {
        source: source.to_string(),
        target: target.to_string(),
        label: label.to_string(),
        weight,
    });
}

fn severity_weight(value: &str) -> usize {
    match value {
        "high" => 3,
        "medium" => 2,
        _ => 1,
    }
}

fn severity_label(value: &str) -> &'static str {
    match value {
        "high" => "高风险",
        "medium" => "中风险",
        "low" => "低风险",
        _ => "提示",
    }
}

fn risk_label(value: &str) -> &'static str {
    match value {
        "high" => "高风险",
        "medium" => "中风险",
        "low" => "低风险",
        _ => "提示",
    }
}

fn status_label(value: &str) -> String {
    match value {
        "open" => "待处理".to_string(),
        "reviewing" => "复查中".to_string(),
        "resolved" => "已解决".to_string(),
        "ignored" => "已忽略".to_string(),
        "new" => "未掌握".to_string(),
        "reviewing_card" => "复习中".to_string(),
        "mastered" => "已掌握".to_string(),
        "planned" => "已计划".to_string(),
        "applied" => "已应用".to_string(),
        "partial" => "部分应用".to_string(),
        "rolled_back" => "已回滚".to_string(),
        "summary" => "汇总".to_string(),
        other => other.to_string(),
    }
}

fn report_type_label(value: &str) -> &'static str {
    match value {
        "project" => "项目报告",
        "diff" => "代码对比",
        "chat" => "对话关联",
        _ => "单文件报告",
    }
}

fn normalized_filter(value: Option<String>) -> Option<String> {
    value
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty() && item != "all")
}

fn normalize_status(value: &str, allowed: &[&str], fallback: &str) -> String {
    let clean = value.trim();
    if allowed.iter().any(|item| clean.eq_ignore_ascii_case(item)) {
        clean.to_ascii_lowercase()
    } else {
        fallback.to_string()
    }
}

fn file_tag(path: &str) -> String {
    Path::new(path)
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
        .unwrap_or_else(|| "general".to_string())
}

fn normalize_date(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.len() >= 10 {
        trimmed[..10].to_string()
    } else {
        Utc::now().format("%Y-%m-%d").to_string()
    }
}

fn count_table(connection: &Connection, table: &str) -> anyhow::Result<usize> {
    let count: i64 = connection.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| row.get(0))?;
    Ok(count.max(0) as usize)
}

fn count_where_like(connection: &Connection, table: &str, column: &str, like: &str) -> anyhow::Result<usize> {
    let count: i64 = connection.query_row(
        &format!("SELECT COUNT(*) FROM {table} WHERE {column} LIKE ?1"),
        params![like],
        |row| row.get(0),
    )?;
    Ok(count.max(0) as usize)
}

fn recent_activity_for_day(connection: &Connection, like: &str) -> anyhow::Result<Vec<ActivityEvent>> {
    let mut statement = connection.prepare(
        r#"
        SELECT id, event_type, title, detail, entity_kind, entity_id, created_at
        FROM activity_events
        WHERE created_at LIKE ?1
        ORDER BY created_at DESC
        LIMIT 8
        "#,
    )?;
    let rows = statement
        .query_map(params![like], row_to_activity_event)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

fn list_recent_events_for_connection(connection: &Connection, limit: usize) -> anyhow::Result<Vec<ActivityEvent>> {
    let mut statement = connection.prepare(
        r#"
        SELECT id, event_type, title, detail, entity_kind, entity_id, created_at
        FROM activity_events
        ORDER BY created_at DESC
        LIMIT ?1
        "#,
    )?;
    let rows = statement
        .query_map(params![limit as i64], row_to_activity_event)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

fn list_daily_activity_counts(connection: &Connection) -> anyhow::Result<Vec<ActivityDay>> {
    let mut statement = connection.prepare(
        r#"
        SELECT substr(created_at, 1, 10) AS day, COUNT(*)
        FROM activity_events
        GROUP BY day
        ORDER BY day DESC
        LIMIT 45
        "#,
    )?;
    let rows = statement
        .query_map([], |row| {
            Ok(ActivityDay {
                date: row.get(0)?,
                count: row.get::<_, i64>(1)?.max(0) as usize,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

fn get_daily_log_by_date(connection: &Connection, date: &str) -> anyhow::Result<DailyLog> {
    connection
        .query_row(
            r#"
            SELECT id, log_date, title, content, created_at, updated_at
            FROM daily_logs
            WHERE log_date = ?1
            "#,
            params![date],
            row_to_daily_log,
        )
        .optional()?
        .ok_or_else(|| anyhow!("未找到每日日志：{date}"))
}

fn list_agent_steps_for_connection(connection: &Connection, task_id: &str) -> anyhow::Result<Vec<AgentStep>> {
    let mut statement = connection.prepare(
        r#"
        SELECT id, task_id, position, title, detail, risk, suggested_patch, status
        FROM agent_steps
        WHERE task_id = ?1
        ORDER BY position
        "#,
    )?;
    let rows = statement
        .query_map(params![task_id], row_to_agent_step)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

fn list_agent_operations_for_connection(
    connection: &Connection,
    task_id: &str,
) -> anyhow::Result<Vec<AgentFileOperation>> {
    let mut statement = connection.prepare(
        r#"
        SELECT id, task_id, path, operation, title, preview, replacement, status,
               confirmed, backup_path, applied_at, error
        FROM agent_file_operations
        WHERE task_id = ?1
        ORDER BY path, operation
        "#,
    )?;
    let rows = statement
        .query_map(params![task_id], row_to_agent_operation)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

fn event_type_label(value: &str) -> &'static str {
    match value {
        "workspace" => "工作区",
        "report" => "报告",
        "finding" => "问题",
        "card" => "知识卡片",
        "daily_log" => "每日日志",
        "agent" => "Agent",
        "chat" => "对话",
        _ => "活动",
    }
}

fn row_to_card_material(row: &rusqlite::Row<'_>) -> rusqlite::Result<CardMaterial> {
    Ok(CardMaterial {
        id: row.get(0)?,
        card_id: row.get(1)?,
        title: row.get(2)?,
        content: row.get(3)?,
        source: row.get(4)?,
        created_at: row.get(5)?,
    })
}

fn row_to_daily_log(row: &rusqlite::Row<'_>) -> rusqlite::Result<DailyLog> {
    Ok(DailyLog {
        id: row.get(0)?,
        date: row.get(1)?,
        title: row.get(2)?,
        content: row.get(3)?,
        created_at: row.get(4)?,
        updated_at: row.get(5)?,
    })
}

fn row_to_project_guide(row: &rusqlite::Row<'_>) -> rusqlite::Result<ProjectGuide> {
    let architecture_json: String = row.get(3)?;
    let reading_order_json: String = row.get(4)?;
    let key_files_json: String = row.get(5)?;
    Ok(ProjectGuide {
        workspace_id: row.get(0)?,
        title: row.get(1)?,
        summary: row.get(2)?,
        architecture: serde_json::from_str::<Vec<ProjectGuideItem>>(&architecture_json).unwrap_or_default(),
        reading_order: serde_json::from_str::<Vec<ProjectGuideItem>>(&reading_order_json).unwrap_or_default(),
        key_files: serde_json::from_str::<Vec<ProjectGuideItem>>(&key_files_json).unwrap_or_default(),
        generated_at: row.get(6)?,
    })
}

fn row_to_agent_task_without_steps(row: &rusqlite::Row<'_>) -> rusqlite::Result<AgentTask> {
    let selected_json: String = row.get(6)?;
    Ok(AgentTask {
        id: row.get(0)?,
        context_kind: row.get(1)?,
        context_id: row.get(2)?,
        title: row.get(3)?,
        summary: row.get(4)?,
        status: row.get(5)?,
        selected_file_paths: serde_json::from_str(&selected_json).unwrap_or_default(),
        apply_summary: row.get(7)?,
        created_at: row.get(8)?,
        updated_at: row.get(9)?,
        steps: Vec::new(),
        operations: Vec::new(),
    })
}

fn row_to_agent_step(row: &rusqlite::Row<'_>) -> rusqlite::Result<AgentStep> {
    Ok(AgentStep {
        id: row.get(0)?,
        task_id: row.get(1)?,
        position: row.get::<_, i64>(2)?.max(0) as usize,
        title: row.get(3)?,
        detail: row.get(4)?,
        risk: row.get(5)?,
        suggested_patch: row.get(6)?,
        status: row.get(7)?,
    })
}

fn row_to_agent_operation(row: &rusqlite::Row<'_>) -> rusqlite::Result<AgentFileOperation> {
    Ok(AgentFileOperation {
        id: row.get(0)?,
        task_id: row.get(1)?,
        path: row.get(2)?,
        operation: row.get(3)?,
        title: row.get(4)?,
        preview: row.get(5)?,
        replacement: row.get(6)?,
        status: row.get(7)?,
        confirmed: row.get::<_, i64>(8)? != 0,
        backup_path: row.get(9)?,
        applied_at: row.get(10)?,
        error: row.get(11)?,
    })
}

fn row_to_learning_card_candidate(row: &rusqlite::Row<'_>) -> rusqlite::Result<LearningCardCandidate> {
    let tags_json: String = row.get(8)?;
    Ok(LearningCardCandidate {
        id: row.get(0)?,
        source_kind: row.get(1)?,
        source_id: row.get(2)?,
        workspace_id: row.get(3)?,
        report_id: row.get(4)?,
        finding_id: row.get(5)?,
        title: row.get(6)?,
        content: row.get(7)?,
        tags: serde_json::from_str(&tags_json).unwrap_or_default(),
        difficulty: row.get(9)?,
        status: row.get(10)?,
        dedupe_key: row.get(11)?,
        created_at: row.get(12)?,
    })
}

fn row_to_activity_event(row: &rusqlite::Row<'_>) -> rusqlite::Result<ActivityEvent> {
    Ok(ActivityEvent {
        id: row.get(0)?,
        event_type: row.get(1)?,
        title: row.get(2)?,
        detail: row.get(3)?,
        entity_kind: row.get(4)?,
        entity_id: row.get(5)?,
        created_at: row.get(6)?,
    })
}

fn row_to_workspace_summary(row: &rusqlite::Row<'_>) -> rusqlite::Result<WorkspaceSummary> {
    Ok(WorkspaceSummary {
        id: row.get(0)?,
        name: row.get(1)?,
        root_path: row.get(2)?,
        file_count: row.get::<_, i64>(3)?.max(0) as usize,
        total_lines: row.get::<_, i64>(4)?.max(0) as usize,
        language_summary: row.get(5)?,
        created_at: row.get(6)?,
        updated_at: row.get(7)?,
    })
}

fn row_to_workspace_file(row: &rusqlite::Row<'_>) -> rusqlite::Result<WorkspaceFile> {
    let metrics_json: String = row.get(6)?;
    Ok(WorkspaceFile {
        id: row.get(0)?,
        workspace_id: row.get(1)?,
        path: row.get(2)?,
        language: row.get(3)?,
        content_hash: row.get(4)?,
        content: row.get(5)?,
        metrics: serde_json::from_str(&metrics_json).unwrap_or(ReportMetrics {
            total_lines: 0,
            non_empty_lines: 0,
            comment_lines: 0,
            complexity_score: 0,
            risk_count: 0,
            suggestion_count: 0,
        }),
        updated_at: row.get(7)?,
    })
}

fn row_to_symbol(row: &rusqlite::Row<'_>) -> rusqlite::Result<CodeSymbol> {
    Ok(CodeSymbol {
        id: row.get(0)?,
        workspace_id: row.get(1)?,
        file_path: row.get(2)?,
        name: row.get(3)?,
        kind: row.get(4)?,
        line: row.get::<_, i64>(5)?.max(0) as usize,
        signature: row.get(6)?,
    })
}

fn row_to_dependency(row: &rusqlite::Row<'_>) -> rusqlite::Result<FileDependency> {
    Ok(FileDependency {
        id: row.get(0)?,
        workspace_id: row.get(1)?,
        source_path: row.get(2)?,
        target: row.get(3)?,
        kind: row.get(4)?,
        line: row.get::<_, i64>(5)?.max(0) as usize,
    })
}

fn row_to_finding(row: &rusqlite::Row<'_>) -> rusqlite::Result<Finding> {
    let line_start: Option<i64> = row.get(8)?;
    let line_end: Option<i64> = row.get(9)?;
    Ok(Finding {
        id: row.get(0)?,
        workspace_id: row.get(1)?,
        report_id: row.get(2)?,
        file_path: row.get(3)?,
        severity: row.get(4)?,
        category: row.get(5)?,
        title: row.get(6)?,
        detail: row.get(7)?,
        line_start: line_start.map(|value| value.max(0) as usize),
        line_end: line_end.map(|value| value.max(0) as usize),
        suggestion: row.get(10)?,
        status: row.get(11)?,
        created_at: row.get(12)?,
        updated_at: row.get(13)?,
    })
}

fn row_to_learning_card(row: &rusqlite::Row<'_>) -> rusqlite::Result<LearningCard> {
    let tags_json: String = row.get(5)?;
    Ok(LearningCard {
        id: row.get(0)?,
        finding_id: row.get(1)?,
        workspace_id: row.get(2)?,
        title: row.get(3)?,
        content: row.get(4)?,
        tags: serde_json::from_str(&tags_json).unwrap_or_default(),
        status: row.get(6)?,
        created_at: row.get(7)?,
        updated_at: row.get(8)?,
    })
}

fn row_to_summary(row: &rusqlite::Row<'_>) -> rusqlite::Result<ReportSummary> {
    let metrics_json: String = row.get(9)?;
    let metadata_json: String = row.get(10)?;
    let risk_count = serde_json::from_str::<ReportMetrics>(&metrics_json)
        .map(|metrics| metrics.risk_count)
        .unwrap_or(0);
    let file_count_raw: i64 = row.get(7)?;
    Ok(ReportSummary {
        id: row.get(0)?,
        title: row.get(1)?,
        language: row.get(2)?,
        review_focus: review_focus_from_metadata(&metadata_json),
        summary: row.get(3)?,
        analysis_source: row.get(4)?,
        report_type: row.get(5)?,
        risk_level: row.get(6)?,
        file_count: file_count_raw.max(0) as usize,
        created_at: row.get(8)?,
        risk_count,
    })
}

fn review_focus_from_metadata(metadata_json: &str) -> Option<String> {
    let metadata = serde_json::from_str::<serde_json::Value>(metadata_json).ok()?;
    ["mode_label", "analysis_profile"]
        .into_iter()
        .filter_map(|key| metadata.get(key).and_then(serde_json::Value::as_str))
        .map(str::trim)
        .find(|value| !value.is_empty())
        .map(str::to_string)
}

fn row_to_detail(row: &rusqlite::Row<'_>) -> rusqlite::Result<ReportDetail> {
    let risks_json: String = row.get(7)?;
    let suggestions_json: String = row.get(8)?;
    let metrics_json: String = row.get(9)?;
    let risks: Vec<String> = serde_json::from_str(&risks_json).unwrap_or_default();
    let suggestions: Vec<String> = serde_json::from_str(&suggestions_json).unwrap_or_default();
    let metrics = serde_json::from_str(&metrics_json).unwrap_or(ReportMetrics {
        total_lines: 0,
        non_empty_lines: 0,
        comment_lines: 0,
        complexity_score: 0,
        risk_count: risks.len(),
        suggestion_count: suggestions.len(),
    });
    let file_count_raw: i64 = row.get(12)?;
    Ok(ReportDetail {
        id: row.get(0)?,
        title: row.get(1)?,
        language: row.get(2)?,
        code_excerpt: row.get(3)?,
        summary: row.get(4)?,
        full_report: row.get(5)?,
        analysis_source: row.get(6)?,
        risks,
        suggestions,
        metrics,
        report_type: row.get(10)?,
        risk_level: row.get(11)?,
        file_count: file_count_raw.max(0) as usize,
        metadata_json: row.get(13)?,
        files: Vec::new(),
        created_at: row.get(14)?,
    })
}

fn list_report_files_for_connection(
    connection: &Connection,
    report_id: &str,
) -> anyhow::Result<Vec<ReportFile>> {
    let mut statement = connection.prepare(
        r#"
        SELECT id, report_id, path, language, code_excerpt, metrics_json, risks_json
        FROM report_files
        WHERE report_id = ?1
        ORDER BY path
        "#,
    )?;
    let rows = statement.query_map(params![report_id], |row| {
        let metrics_json: String = row.get(5)?;
        let risks_json: String = row.get(6)?;
        Ok(ReportFile {
            id: row.get(0)?,
            report_id: row.get(1)?,
            path: row.get(2)?,
            language: row.get(3)?,
            code_excerpt: row.get(4)?,
            metrics: serde_json::from_str(&metrics_json).unwrap_or(ReportMetrics {
                total_lines: 0,
                non_empty_lines: 0,
                comment_lines: 0,
                complexity_score: 0,
                risk_count: 0,
                suggestion_count: 0,
            }),
            risks: serde_json::from_str(&risks_json).unwrap_or_default(),
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

fn list_workspace_files_for_connection(
    connection: &Connection,
    workspace_id: &str,
) -> anyhow::Result<Vec<WorkspaceFile>> {
    let mut statement = connection.prepare(
        r#"
        SELECT id, workspace_id, path, language, content_hash, content, metrics_json, updated_at
        FROM workspace_files
        WHERE workspace_id = ?1
        ORDER BY path
        "#,
    )?;
    let rows = statement.query_map(params![workspace_id], row_to_workspace_file)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

fn list_symbols_for_connection(
    connection: &Connection,
    workspace_id: &str,
) -> anyhow::Result<Vec<CodeSymbol>> {
    let mut statement = connection.prepare(
        r#"
        SELECT id, workspace_id, file_path, name, kind, line, signature
        FROM code_symbols
        WHERE workspace_id = ?1
        ORDER BY file_path, line
        "#,
    )?;
    let rows = statement.query_map(params![workspace_id], row_to_symbol)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

fn list_dependencies_for_connection(
    connection: &Connection,
    workspace_id: &str,
) -> anyhow::Result<Vec<FileDependency>> {
    let mut statement = connection.prepare(
        r#"
        SELECT id, workspace_id, source_path, target, kind, line
        FROM file_dependencies
        WHERE workspace_id = ?1
        ORDER BY source_path, line
        "#,
    )?;
    let rows = statement.query_map(params![workspace_id], row_to_dependency)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

fn row_to_chat_summary(row: &rusqlite::Row<'_>) -> rusqlite::Result<ChatSessionSummary> {
    let count: i64 = row.get(5)?;
    Ok(ChatSessionSummary {
        id: row.get(0)?,
        title: row.get(1)?,
        context_report_id: row.get(2)?,
        created_at: row.get(3)?,
        updated_at: row.get(4)?,
        message_count: count.max(0) as usize,
    })
}

fn list_chat_messages_for_connection(
    connection: &Connection,
    session_id: &str,
) -> anyhow::Result<Vec<ChatMessageItem>> {
    let mut statement = connection.prepare(
        r#"
        SELECT id, session_id, role, content, created_at
        FROM chat_messages
        WHERE session_id = ?1
        ORDER BY created_at
        "#,
    )?;
    let rows = statement.query_map(params![session_id], |row| {
        Ok(ChatMessageItem {
            id: row.get(0)?,
            session_id: row.get(1)?,
            role: row.get(2)?,
            content: row.get(3)?,
            created_at: row.get(4)?,
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}
