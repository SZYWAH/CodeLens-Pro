use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Instant;

use anyhow::{ensure, Context};
use chrono::Utc;
use codelens_next_core::{CoreApp, SettingsUpdate, TraceabilityCounts};
use serde_json::{json, Value};

fn acceptance_secret() -> String {
    ["codelens-acceptance-", "secret-never-export"].concat()
}

fn required_path(name: &str) -> anyhow::Result<PathBuf> {
    let value = env::var(name).with_context(|| format!("{name} is required"))?;
    let path = PathBuf::from(value);
    ensure!(path.exists(), "{name} does not exist: {}", path.display());
    Ok(path)
}

fn write_result(output: &Path, value: &Value) -> anyhow::Result<()> {
    if let Some(parent) = output.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("failed to create output directory {}", parent.display()))?;
    }
    fs::write(output, serde_json::to_string_pretty(value)?)
        .with_context(|| format!("failed to write acceptance result {}", output.display()))
}

fn important_counts(value: &TraceabilityCounts) -> Value {
    json!({
        "workspaces": value.workspaces,
        "reports": value.reports,
        "findings": value.findings,
        "cards": value.cards,
        "daily_logs": value.daily_logs,
    })
}

fn run_acceptance(workspace_path: &Path, test_root: &Path) -> anyhow::Result<Value> {
    let primary_root = test_root.join("primary");
    let imported_root = test_root.join("imported");
    fs::create_dir_all(&primary_root)?;
    fs::create_dir_all(&imported_root)?;

    let app = CoreApp::initialize(&primary_root).context("initialize isolated primary app")?;
    let secret = acceptance_secret();
    app.save_settings(SettingsUpdate {
        enable_llm: false,
        api_base: "https://example.invalid/v1".to_string(),
        model: "local-rules-only".to_string(),
        api_key: Some(secret.clone()),
        clear_api_key: false,
    })
    .context("save isolated local-rule settings")?;

    let workspace = app
        .import_workspace_from_path(workspace_path.to_path_buf())
        .context("import real rewrite workspace")?;
    ensure!(
        workspace.summary.file_count > 0,
        "workspace scan returned no files"
    );
    ensure!(
        workspace.summary.total_lines > 0,
        "workspace scan returned no code lines"
    );

    let code_map = app
        .get_code_map(workspace.summary.id.clone())
        .context("build code map")?;
    let language_names = code_map
        .languages
        .iter()
        .map(|item| item.language.to_ascii_lowercase())
        .collect::<Vec<_>>();
    ensure!(
        language_names
            .iter()
            .any(|item| item.contains("typescript")),
        "real workspace did not expose TypeScript"
    );
    ensure!(
        language_names
            .iter()
            .any(|item| item == "rust" || item.contains("rust")),
        "real workspace did not expose Rust"
    );
    ensure!(!code_map.symbols.is_empty(), "code map contains no symbols");
    ensure!(
        !code_map.dependencies.is_empty(),
        "code map contains no dependencies"
    );

    let guide = app
        .generate_project_guide(workspace.summary.id.clone())
        .context("generate project guide")?;
    ensure!(
        !guide.summary.trim().is_empty(),
        "project guide summary is empty"
    );
    ensure!(
        !guide.reading_order.is_empty() || !guide.key_files.is_empty(),
        "project guide has no reading route"
    );

    let analysis = futures::executor::block_on(app.analyze_workspace_stream(
        workspace.summary.id.clone(),
        Some(false),
        None,
        |_| Ok(()),
    ))
    .context("generate local workspace report")?;
    let report = app
        .get_report(analysis.report.id.clone())
        .context("reload saved workspace report")?;
    ensure!(
        !report.full_report.trim().is_empty(),
        "saved report body is empty"
    );

    let findings = app
        .list_findings(
            Some(workspace.summary.id.clone()),
            None,
            None,
            Some(report.id.clone()),
        )
        .context("list report findings")?;
    ensure!(
        !findings.is_empty(),
        "workspace report produced no findings"
    );
    let reviewed = app
        .update_finding_status(findings[0].id.clone(), "reviewing".to_string())
        .context("update finding status")?;
    ensure!(
        reviewed.status == "reviewing",
        "finding status did not persist"
    );

    let finding_ids = findings
        .iter()
        .take(8)
        .map(|item| item.id.clone())
        .collect::<Vec<_>>();
    let cards = app
        .create_cards_from_findings(finding_ids)
        .context("create learning cards from findings")?;
    ensure!(!cards.is_empty(), "finding conversion produced no cards");
    let mastered = app
        .update_learning_card(cards[0].id.clone(), "mastered".to_string())
        .context("update learning card status")?;
    ensure!(
        mastered.status == "mastered",
        "learning card status did not persist"
    );
    let material =
        futures::executor::block_on(app.generate_card_material(mastered.id.clone(), Some(false)))
            .context("generate local learning material")?;
    ensure!(
        !material.content.trim().is_empty(),
        "learning material is empty"
    );
    ensure!(
        material.source == "local" || material.source == "local_fallback",
        "learning material unexpectedly used a remote source: {}",
        material.source
    );

    let today = Utc::now().format("%Y-%m-%d").to_string();
    let draft = app
        .generate_daily_log(today.clone())
        .context("generate daily log draft")?;
    let saved_log = app
        .save_daily_log(today.clone(), draft.title, draft.content)
        .context("save daily log")?;
    ensure!(
        !saved_log.content.trim().is_empty(),
        "saved daily log is empty"
    );
    let daily_export = app
        .export_daily_log_markdown(today.clone())
        .context("export daily log markdown")?;
    ensure!(
        Path::new(&daily_export).exists(),
        "daily log export is missing"
    );

    let before_counts = app
        .get_traceability_snapshot(Some("global".to_string()), None)
        .context("read traceability before export")?
        .counts;
    ensure!(
        before_counts.workspaces >= 1,
        "traceability contains no workspace"
    );
    ensure!(
        before_counts.reports >= 1,
        "traceability contains no report"
    );
    ensure!(
        before_counts.findings >= 1,
        "traceability contains no findings"
    );
    ensure!(before_counts.cards >= 1, "traceability contains no cards");
    ensure!(
        before_counts.daily_logs >= 1,
        "traceability contains no daily log"
    );

    let archive = app
        .export_product_archive()
        .context("export product archive")?;
    let manifest_text = fs::read_to_string(&archive.manifest_path)
        .context("read exported product archive manifest")?;
    ensure!(
        !manifest_text.contains(&secret),
        "product archive leaked the acceptance API key"
    );

    drop(app);
    let reopened = CoreApp::initialize(&primary_root).context("reopen isolated primary app")?;
    ensure!(
        reopened
            .list_workspaces(None)?
            .iter()
            .any(|item| item.id == workspace.summary.id),
        "workspace did not survive app reopen"
    );
    ensure!(
        reopened
            .list_reports(None)?
            .iter()
            .any(|item| item.id == report.id),
        "report did not survive app reopen"
    );
    ensure!(
        reopened
            .list_learning_cards(None, None, None)?
            .iter()
            .any(|item| item.id == mastered.id),
        "learning card did not survive app reopen"
    );
    ensure!(
        reopened
            .list_daily_logs()?
            .iter()
            .any(|item| item.date == today),
        "daily log did not survive app reopen"
    );
    drop(reopened);

    let imported_app =
        CoreApp::initialize(&imported_root).context("initialize archive import app")?;
    let imported = imported_app
        .import_product_archive_from_path(&archive.manifest_path)
        .context("import product archive")?;
    let imported_counts = imported.counts;
    ensure!(
        imported_counts.workspaces == before_counts.workspaces,
        "archive workspace count changed: {} != {}",
        imported_counts.workspaces,
        before_counts.workspaces
    );
    ensure!(
        imported_counts.reports == before_counts.reports,
        "archive report count changed: {} != {}",
        imported_counts.reports,
        before_counts.reports
    );
    ensure!(
        imported_counts.findings == before_counts.findings,
        "archive finding count changed: {} != {}",
        imported_counts.findings,
        before_counts.findings
    );
    ensure!(
        imported_counts.cards == before_counts.cards,
        "archive card count changed: {} != {}",
        imported_counts.cards,
        before_counts.cards
    );
    ensure!(
        imported_counts.daily_logs == before_counts.daily_logs,
        "archive daily-log count changed: {} != {}",
        imported_counts.daily_logs,
        before_counts.daily_logs
    );

    Ok(json!({
        "schema": "codelens-next.real-workspace-acceptance.v1",
        "status": "passed",
        "workspace_path": workspace_path,
        "test_root": test_root,
        "workspace": {
            "id": workspace.summary.id,
            "file_count": workspace.summary.file_count,
            "total_lines": workspace.summary.total_lines,
            "languages": code_map.languages,
            "symbols": code_map.symbols.len(),
            "dependencies": code_map.dependencies.len(),
            "hotspot_files": code_map.hotspot_files.len(),
        },
        "guide": {
            "reading_order": guide.reading_order.len(),
            "key_files": guide.key_files.len(),
        },
        "report": {
            "id": report.id,
            "title": report.title,
            "analysis_source": report.analysis_source,
        },
        "findings": findings.len(),
        "cards": cards.len(),
        "material_source": material.source,
        "daily_log_date": today,
        "persistence_reopen": true,
        "archive_manifest_verified": true,
        "archive_counts": important_counts(&before_counts),
        "import_counts": important_counts(&imported_counts),
        "api_key_exported": false,
    }))
}

#[test]
#[ignore = "requires CODELENS_ACCEPTANCE_WORKSPACE and isolated output paths"]
fn real_workspace_release_acceptance() {
    let started = Instant::now();
    let workspace = required_path("CODELENS_ACCEPTANCE_WORKSPACE")
        .expect("CODELENS_ACCEPTANCE_WORKSPACE must point to the rewrite source");
    let test_root = required_path("CODELENS_TEST_ROOT")
        .expect("CODELENS_TEST_ROOT must point to an existing isolated directory");
    let output = PathBuf::from(
        env::var("CODELENS_ACCEPTANCE_OUTPUT")
            .expect("CODELENS_ACCEPTANCE_OUTPUT must point to a JSON result file"),
    );
    let keep_artifacts = env::var("CODELENS_ACCEPTANCE_KEEP")
        .map(|value| value == "1" || value.eq_ignore_ascii_case("true"))
        .unwrap_or(false);

    match run_acceptance(&workspace, &test_root) {
        Ok(mut result) => {
            result["duration_ms"] = json!(started.elapsed().as_millis());
            write_result(&output, &result).expect("write passing acceptance result");
            if !keep_artifacts {
                fs::remove_dir_all(&test_root).expect("clean successful acceptance test root");
            }
        }
        Err(error) => {
            let result = json!({
                "schema": "codelens-next.real-workspace-acceptance.v1",
                "status": "failed",
                "workspace_path": workspace,
                "test_root": test_root,
                "duration_ms": started.elapsed().as_millis(),
                "error": format!("{error:#}"),
            });
            write_result(&output, &result).expect("write failing acceptance result");
            panic!("real workspace acceptance failed: {error:#}");
        }
    }
}
