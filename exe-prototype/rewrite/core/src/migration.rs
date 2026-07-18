use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{anyhow, Context};
use chrono::Utc;
use rusqlite::{Connection, OpenFlags};
use serde_json::json;
use uuid::Uuid;

use crate::models::{LegacyMigrationResult, LegacyMigrationStatus};

const DATABASE_FILE: &str = "codelens-next.sqlite";
const MIGRATION_MARKER: &str = "migration-v1.json";
const USER_TABLES: &[&str] = &[
    "settings",
    "reports",
    "chat_sessions",
    "workspaces",
    "findings",
    "learning_cards",
    "daily_logs",
    "agent_tasks",
    "model_profiles",
];

pub fn legacy_migration_state(
    destination_home: impl AsRef<Path>,
    candidate: Option<&Path>,
) -> anyhow::Result<LegacyMigrationResult> {
    let destination_home = destination_home.as_ref();
    let destination = destination_home.display().to_string();
    let marker = destination_home.join(MIGRATION_MARKER);
    if marker.exists() {
        return Ok(LegacyMigrationResult {
            status: LegacyMigrationStatus::Completed,
            source: marker_source(&marker),
            destination,
            database_migrated: true,
            logs_migrated: 0,
            restart_required: false,
            message: "旧版数据已经迁移到当前用户数据目录。".to_string(),
        });
    }

    if destination_has_user_data(destination_home)? {
        return Ok(LegacyMigrationResult {
            status: LegacyMigrationStatus::NotNeeded,
            source: None,
            destination,
            database_migrated: false,
            logs_migrated: 0,
            restart_required: false,
            message: "当前数据目录已经包含用户数据；如需合并旧数据，请使用产品档案导入。"
                .to_string(),
        });
    }

    if let Some(candidate) = candidate.and_then(resolve_legacy_home) {
        return Ok(LegacyMigrationResult {
            status: LegacyMigrationStatus::CandidateFound,
            source: Some(candidate.display().to_string()),
            destination,
            database_migrated: false,
            logs_migrated: 0,
            restart_required: false,
            message: "检测到旧免安装版数据，可以安全迁移。".to_string(),
        });
    }

    Ok(LegacyMigrationResult {
        status: LegacyMigrationStatus::NeedsLocation,
        source: None,
        destination,
        database_migrated: false,
        logs_migrated: 0,
        restart_required: false,
        message: "如需保留旧免安装版数据，请选择旧版程序所在文件夹。".to_string(),
    })
}

pub fn migrate_legacy_data(
    source: impl AsRef<Path>,
    destination_home: impl AsRef<Path>,
) -> anyhow::Result<LegacyMigrationResult> {
    let destination_home = destination_home.as_ref();
    let destination = destination_home.display().to_string();
    let marker = destination_home.join(MIGRATION_MARKER);
    if marker.exists() && destination_has_user_data(destination_home)? {
        return Ok(LegacyMigrationResult {
            status: LegacyMigrationStatus::Completed,
            source: marker_source(&marker),
            destination,
            database_migrated: false,
            logs_migrated: 0,
            restart_required: false,
            message: "旧版数据已经迁移，无需重复操作。".to_string(),
        });
    }

    let source_home = resolve_legacy_home(source.as_ref()).ok_or_else(|| {
        anyhow!(
            "所选目录中没有找到 storage/{}，请选择旧版 CodeLens Pro Next 所在目录",
            DATABASE_FILE
        )
    })?;
    let source_storage = source_home.join("storage");
    validate_database(&source_storage.join(DATABASE_FILE))
        .with_context(|| "旧版 SQLite 校验失败，源数据未被修改")?;

    if same_path(&source_home, destination_home) {
        return Ok(LegacyMigrationResult {
            status: LegacyMigrationStatus::NotNeeded,
            source: Some(source_home.display().to_string()),
            destination,
            database_migrated: false,
            logs_migrated: 0,
            restart_required: false,
            message: "所选目录已经是当前数据目录。".to_string(),
        });
    }
    if destination_has_user_data(destination_home)? {
        return Err(anyhow!(
            "当前数据目录已经包含用户数据，不能直接覆盖；请改用产品档案导入"
        ));
    }

    fs::create_dir_all(destination_home)
        .with_context(|| format!("无法创建目标数据目录 {}", destination_home.display()))?;
    let token = Uuid::new_v4().to_string();
    let temporary_storage = destination_home.join(format!(".migration-{token}.tmp"));
    let destination_storage = destination_home.join("storage");
    let backup_root = destination_home.join("migration-backups");
    let backup_storage = backup_root.join(format!(
        "pre-migration-{}-{}",
        Utc::now().format("%Y%m%d-%H%M%S"),
        &token[..8]
    ));

    copy_directory(&source_storage, &temporary_storage)?;
    validate_database(&temporary_storage.join(DATABASE_FILE))
        .with_context(|| "复制后的 SQLite 校验失败，目标数据未切换")?;

    let had_destination_storage = destination_storage.exists();
    if had_destination_storage {
        fs::create_dir_all(&backup_root)?;
        fs::rename(&destination_storage, &backup_storage)
            .with_context(|| "无法备份当前空数据目录")?;
    }
    if let Err(error) = fs::rename(&temporary_storage, &destination_storage) {
        if had_destination_storage && backup_storage.exists() {
            let _ = fs::rename(&backup_storage, &destination_storage);
        }
        return Err(error).with_context(|| "无法原子切换迁移后的数据目录");
    }

    let logs_migrated = copy_logs(&source_home.join("logs"), &destination_home.join("logs"))?;
    let marker_payload = json!({
        "version": 1,
        "source": source_home.display().to_string(),
        "completed_at": Utc::now().to_rfc3339(),
        "database": DATABASE_FILE,
        "logs_migrated": logs_migrated
    });
    fs::write(&marker, serde_json::to_vec_pretty(&marker_payload)?)
        .with_context(|| format!("无法写入迁移标记 {}", marker.display()))?;

    Ok(LegacyMigrationResult {
        status: LegacyMigrationStatus::Completed,
        source: Some(source_home.display().to_string()),
        destination,
        database_migrated: true,
        logs_migrated,
        restart_required: true,
        message: "旧版数据库与日志已复制，旧目录保持不变；重启后载入迁移数据。".to_string(),
    })
}

fn resolve_legacy_home(path: &Path) -> Option<PathBuf> {
    let path = if path.is_file() { path.parent()? } else { path };
    if path.join("storage").join(DATABASE_FILE).is_file() {
        return Some(path.to_path_buf());
    }
    if path.file_name().and_then(|value| value.to_str()) == Some("storage")
        && path.join(DATABASE_FILE).is_file()
    {
        return path.parent().map(Path::to_path_buf);
    }
    None
}

fn destination_has_user_data(home: &Path) -> anyhow::Result<bool> {
    let database = home.join("storage").join(DATABASE_FILE);
    if !database.exists() || database.metadata()?.len() == 0 {
        return Ok(false);
    }
    let connection = Connection::open_with_flags(&database, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .with_context(|| format!("无法读取目标 SQLite {}", database.display()))?;
    for table in USER_TABLES {
        if !table_exists(&connection, table)? {
            continue;
        }
        let sql = format!("SELECT EXISTS(SELECT 1 FROM \"{table}\" LIMIT 1)");
        let has_rows: i64 = connection.query_row(&sql, [], |row| row.get(0))?;
        if has_rows != 0 {
            return Ok(true);
        }
    }
    Ok(false)
}

fn table_exists(connection: &Connection, table: &str) -> anyhow::Result<bool> {
    let count: i64 = connection.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
        [table],
        |row| row.get(0),
    )?;
    Ok(count > 0)
}

fn validate_database(path: &Path) -> anyhow::Result<()> {
    let connection = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .with_context(|| format!("无法读取 SQLite {}", path.display()))?;
    let result: String = connection.query_row("PRAGMA quick_check", [], |row| row.get(0))?;
    if result != "ok" {
        return Err(anyhow!("SQLite quick_check 返回 {result}"));
    }
    if !table_exists(&connection, "settings")? {
        return Err(anyhow!("SQLite 缺少 CodeLens settings 表"));
    }
    Ok(())
}

fn copy_directory(source: &Path, destination: &Path) -> anyhow::Result<()> {
    fs::create_dir_all(destination)?;
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let source_path = entry.path();
        let destination_path = destination.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_directory(&source_path, &destination_path)?;
        } else {
            fs::copy(&source_path, &destination_path)
                .with_context(|| format!("无法复制旧版数据文件 {}", source_path.display()))?;
        }
    }
    Ok(())
}

fn copy_logs(source: &Path, destination: &Path) -> anyhow::Result<usize> {
    if !source.is_dir() {
        return Ok(0);
    }
    fs::create_dir_all(destination)?;
    let mut copied = 0;
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        if !entry.file_type()?.is_file() {
            continue;
        }
        let mut target = destination.join(entry.file_name());
        if target.exists() {
            let stem = target
                .file_stem()
                .and_then(|value| value.to_str())
                .unwrap_or("legacy-log");
            let extension = target
                .extension()
                .and_then(|value| value.to_str())
                .unwrap_or("log");
            target = destination.join(format!(
                "{stem}-legacy-{}.{}",
                Utc::now().format("%Y%m%d-%H%M%S"),
                extension
            ));
        }
        fs::copy(entry.path(), target)?;
        copied += 1;
    }
    Ok(copied)
}

fn marker_source(marker: &Path) -> Option<String> {
    let bytes = fs::read(marker).ok()?;
    let value: serde_json::Value = serde_json::from_slice(&bytes).ok()?;
    value.get("source")?.as_str().map(str::to_string)
}

fn same_path(left: &Path, right: &Path) -> bool {
    match (left.canonicalize(), right.canonicalize()) {
        (Ok(left), Ok(right)) => left == right,
        _ => left == right,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{CoreApp, SettingsUpdate};

    fn test_root(label: &str) -> PathBuf {
        let base = std::env::var("CODELENS_TEST_ROOT")
            .map(PathBuf::from)
            .unwrap_or_else(|_| {
                PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                    .join("..")
                    .join("..")
                    .join(".cache")
                    .join("core-tests")
            });
        base.join(format!("migration-{label}-{}", Uuid::new_v4()))
    }

    #[test]
    fn reports_needs_location_for_a_fresh_destination() {
        let destination = test_root("fresh");
        let _app = CoreApp::initialize(&destination).expect("initialize empty destination");
        let state = legacy_migration_state(&destination, None).expect("state");
        assert_eq!(state.status, LegacyMigrationStatus::NeedsLocation);
        fs::remove_dir_all(destination).ok();
    }

    #[test]
    fn migrates_database_and_logs_without_removing_the_source() {
        let source = test_root("source");
        let destination = test_root("destination");
        let app = CoreApp::initialize(&source).expect("source app");
        app.save_settings(SettingsUpdate {
            enable_llm: true,
            api_base: "https://example.test/v1".to_string(),
            model: "release-model".to_string(),
            api_key: Some("migration-test-key".to_string()),
            clear_api_key: false,
        })
        .expect("source settings");
        fs::write(source.join("logs").join("legacy.log"), "legacy log").unwrap();

        let result = migrate_legacy_data(&source, &destination).expect("migration");
        assert_eq!(result.status, LegacyMigrationStatus::Completed);
        assert!(result.database_migrated);
        assert_eq!(result.logs_migrated, 2);
        assert!(source.join("storage").join(DATABASE_FILE).exists());
        let migrated = CoreApp::initialize(&destination).expect("migrated app");
        let settings = migrated.settings().expect("migrated settings");
        assert_eq!(settings.model, "release-model");
        assert!(settings.api_key_set);

        let repeated = migrate_legacy_data(&source, &destination).expect("idempotent migration");
        assert!(!repeated.database_migrated);
        fs::remove_dir_all(source).ok();
        fs::remove_dir_all(destination).ok();
    }

    #[test]
    fn rejects_corrupt_sources_and_nonempty_destinations() {
        let corrupt = test_root("corrupt");
        let destination = test_root("nonempty");
        fs::create_dir_all(corrupt.join("storage")).unwrap();
        fs::write(corrupt.join("storage").join(DATABASE_FILE), b"not sqlite").unwrap();
        assert!(migrate_legacy_data(&corrupt, &destination).is_err());
        assert!(!destination.join("storage").join(DATABASE_FILE).exists());

        let valid_source = test_root("valid");
        let source_app = CoreApp::initialize(&valid_source).expect("valid source");
        source_app
            .save_settings(SettingsUpdate {
                enable_llm: false,
                api_base: "https://source.test/v1".to_string(),
                model: "source-model".to_string(),
                api_key: None,
                clear_api_key: false,
            })
            .expect("source settings");
        let destination_app = CoreApp::initialize(&destination).expect("destination app");
        destination_app
            .save_settings(SettingsUpdate {
                enable_llm: false,
                api_base: "https://destination.test/v1".to_string(),
                model: "destination-model".to_string(),
                api_key: None,
                clear_api_key: false,
            })
            .expect("destination settings");
        assert!(migrate_legacy_data(&valid_source, &destination).is_err());

        fs::remove_dir_all(corrupt).ok();
        fs::remove_dir_all(valid_source).ok();
        fs::remove_dir_all(destination).ok();
    }
}
