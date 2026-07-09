use std::collections::{BTreeMap, HashSet};
use std::collections::hash_map::DefaultHasher;
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};

use anyhow::{anyhow, Context};
use chrono::Utc;
use uuid::Uuid;

use crate::analysis;
use crate::models::{
    CodeMap, CodeSymbol, FileDependency, Finding, LanguageStat, ReportMetrics, WorkspaceDetail,
    WorkspaceFile, WorkspaceFileHotspot, WorkspaceSummary,
};

const MAX_FILES: usize = 180;
const MAX_FILE_BYTES: u64 = 512 * 1024;
const ALLOWED_EXTENSIONS: &[&str] = &[
    "py", "js", "jsx", "ts", "tsx", "rs", "java", "cpp", "c", "h", "hpp", "cs", "go", "md",
    "txt", "json", "toml", "yaml", "yml", "html", "css",
];
const EXCLUDED_DIRS: &[&str] = &[
    ".git",
    "node_modules",
    ".venv",
    "venv",
    "dist",
    "build",
    "target",
    "__pycache__",
    ".cache",
];

#[derive(Debug, Clone)]
pub struct WorkspaceScan {
    pub detail: WorkspaceDetail,
    pub symbols: Vec<CodeSymbol>,
    pub dependencies: Vec<FileDependency>,
    pub findings: Vec<Finding>,
}

pub fn scan_folder(root: &Path, workspace_id: Option<&str>) -> anyhow::Result<WorkspaceScan> {
    if !root.is_dir() {
        return Err(anyhow!("Selected path is not a folder: {}", root.display()));
    }

    let root = root.canonicalize().unwrap_or_else(|_| root.to_path_buf());
    let id = workspace_id
        .filter(|value| !value.trim().is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    let now = Utc::now().to_rfc3339();
    let mut candidates = Vec::new();
    collect_files(&root, &root, &mut candidates)?;
    candidates.sort();

    let mut files = Vec::new();
    let mut skipped = Vec::new();
    for path in candidates {
        if files.len() >= MAX_FILES {
            skipped.push(format!("Reached file limit of {MAX_FILES}."));
            break;
        }
        match read_workspace_file(&id, &root, &path, &now) {
            Ok(file) => files.push(file),
            Err(err) => skipped.push(format!("{}: {err}", path.display())),
        }
    }

    if files.is_empty() {
        return Err(anyhow!("No supported UTF-8 code files were found in the selected folder."));
    }

    let summary = build_summary(&id, &root, &files, &now);
    let mut symbols = Vec::new();
    let mut dependencies = Vec::new();
    let mut findings = Vec::new();
    for file in &files {
        symbols.extend(extract_symbols(file));
        dependencies.extend(extract_dependencies(file));
        findings.extend(build_findings(file, None));
    }

    Ok(WorkspaceScan {
        detail: WorkspaceDetail {
            summary,
            files,
            skipped,
        },
        symbols,
        dependencies,
        findings,
    })
}

pub fn scan_from_detail(mut detail: WorkspaceDetail, mut findings: Vec<Finding>) -> WorkspaceScan {
    let workspace_id = detail.summary.id.clone();
    for file in &mut detail.files {
        file.workspace_id = workspace_id.clone();
    }
    for finding in &mut findings {
        finding.workspace_id = workspace_id.clone();
    }

    let mut symbols = Vec::new();
    let mut dependencies = Vec::new();
    let mut rebuilt_findings = Vec::new();
    for file in &detail.files {
        symbols.extend(extract_symbols(file));
        dependencies.extend(extract_dependencies(file));
        if findings.is_empty() {
            rebuilt_findings.extend(build_findings(file, None));
        }
    }

    WorkspaceScan {
        detail,
        symbols,
        dependencies,
        findings: if findings.is_empty() {
            rebuilt_findings
        } else {
            findings
        },
    }
}

pub fn build_code_map(
    workspace_id: &str,
    files: &[WorkspaceFile],
    symbols: Vec<CodeSymbol>,
    dependencies: Vec<FileDependency>,
) -> CodeMap {
    let mut language_map: BTreeMap<String, (usize, usize)> = BTreeMap::new();
    for file in files {
        let entry = language_map.entry(file.language.clone()).or_insert((0, 0));
        entry.0 += 1;
        entry.1 += file.metrics.total_lines;
    }

    let mut hotspot_files = files
        .iter()
        .map(|file| WorkspaceFileHotspot {
            path: file.path.clone(),
            language: file.language.clone(),
            total_lines: file.metrics.total_lines,
            complexity_score: file.metrics.complexity_score,
            risk_count: file.metrics.risk_count,
        })
        .collect::<Vec<_>>();
    hotspot_files.sort_by(|left, right| {
        right
            .complexity_score
            .cmp(&left.complexity_score)
            .then(right.risk_count.cmp(&left.risk_count))
            .then(right.total_lines.cmp(&left.total_lines))
    });
    hotspot_files.truncate(20);

    CodeMap {
        workspace_id: workspace_id.to_string(),
        languages: language_map
            .into_iter()
            .map(|(language, (file_count, total_lines))| LanguageStat {
                language,
                file_count,
                total_lines,
            })
            .collect(),
        hotspot_files,
        symbols,
        dependencies,
    }
}

pub fn build_findings(file: &WorkspaceFile, report_id: Option<String>) -> Vec<Finding> {
    let now = Utc::now().to_rfc3339();
    let mut findings = Vec::new();
    let risks = analysis::local_risks_for_code(&file.content);
    for risk in risks {
        if risk.starts_with("本地分析器未发现明显高风险") {
            continue;
        }
        let severity = severity_for_risk(&risk, &file.metrics);
        let category = category_for_risk(&risk);
        let line = line_for_risk(&file.content, &risk);
        findings.push(Finding {
            id: Uuid::new_v4().to_string(),
            workspace_id: file.workspace_id.clone(),
            report_id: report_id.clone(),
            file_path: file.path.clone(),
            severity,
            category,
            title: title_for_risk(&risk),
            detail: risk,
            line_start: line,
            line_end: line,
            suggestion: suggestion_for_category(&category_for_risk_text(&file.content)),
            status: "open".to_string(),
            created_at: now.clone(),
            updated_at: now.clone(),
        });
    }

    if file.metrics.complexity_score >= 12 {
        findings.push(Finding {
            id: Uuid::new_v4().to_string(),
            workspace_id: file.workspace_id.clone(),
            report_id,
            file_path: file.path.clone(),
            severity: if file.metrics.complexity_score >= 24 { "high" } else { "medium" }.to_string(),
            category: "maintainability".to_string(),
            title: "复杂文件需要重点审查".to_string(),
            detail: format!(
                "复杂度评分为 {}，会增加人工审查和测试设计难度。",
                file.metrics.complexity_score
            ),
            line_start: None,
            line_end: None,
            suggestion: "将复杂分支提取为命名清晰的 helper，并补充聚焦测试。".to_string(),
            status: "open".to_string(),
            created_at: now.clone(),
            updated_at: now,
        });
    }

    findings
}

fn collect_files(root: &Path, current: &Path, files: &mut Vec<PathBuf>) -> anyhow::Result<()> {
    if files.len() >= MAX_FILES {
        return Ok(());
    }

    for entry in fs::read_dir(current).with_context(|| format!("failed to read {}", current.display()))? {
        let entry = entry?;
        let path = entry.path();
        let file_type = entry.file_type()?;
        if file_type.is_dir() {
            if should_skip_dir(&path) {
                continue;
            }
            collect_files(root, &path, files)?;
        } else if file_type.is_file() && is_supported_file(&path) {
            let canonical = path.canonicalize().unwrap_or(path);
            if canonical.starts_with(root) {
                files.push(canonical);
            }
        }
    }
    Ok(())
}

fn read_workspace_file(
    workspace_id: &str,
    root: &Path,
    path: &Path,
    now: &str,
) -> anyhow::Result<WorkspaceFile> {
    if !is_supported_file(path) {
        return Err(anyhow!("unsupported file extension"));
    }
    let metadata = fs::metadata(path)?;
    if metadata.len() > MAX_FILE_BYTES {
        return Err(anyhow!("file is larger than {} KB", MAX_FILE_BYTES / 1024));
    }
    let content = fs::read_to_string(path).context("file is not valid UTF-8 text")?;
    let relative = path
        .strip_prefix(root)
        .unwrap_or(path)
        .display()
        .to_string();
    let language = language_from_extension(path).unwrap_or_else(|| analysis::detect_language(&content));
    let metrics = analysis::metrics_for_code(&content);
    Ok(WorkspaceFile {
        id: Uuid::new_v4().to_string(),
        workspace_id: workspace_id.to_string(),
        path: relative,
        language,
        content_hash: hash_content(&content),
        content,
        metrics,
        updated_at: now.to_string(),
    })
}

fn build_summary(
    id: &str,
    root: &Path,
    files: &[WorkspaceFile],
    now: &str,
) -> WorkspaceSummary {
    let mut languages: BTreeMap<String, usize> = BTreeMap::new();
    let total_lines = files.iter().map(|file| file.metrics.total_lines).sum::<usize>();
    for file in files {
        *languages.entry(file.language.clone()).or_insert(0) += 1;
    }
    let language_summary = languages
        .iter()
        .map(|(language, count)| format!("{language}: {count}"))
        .collect::<Vec<_>>()
        .join(", ");
    WorkspaceSummary {
        id: id.to_string(),
        name: root
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("Imported Workspace")
            .to_string(),
        root_path: root.display().to_string(),
        file_count: files.len(),
        total_lines,
        language_summary,
        created_at: now.to_string(),
        updated_at: now.to_string(),
    }
}

fn extract_symbols(file: &WorkspaceFile) -> Vec<CodeSymbol> {
    let mut symbols = Vec::new();
    let mut seen = HashSet::new();
    for (index, line) in file.content.lines().enumerate() {
        let trimmed = line.trim();
        let candidates = symbol_candidates(trimmed, &file.language);
        for (kind, name) in candidates {
            if name.is_empty() || !seen.insert(format!("{kind}:{name}:{}", index + 1)) {
                continue;
            }
            symbols.push(CodeSymbol {
                id: Uuid::new_v4().to_string(),
                workspace_id: file.workspace_id.clone(),
                file_path: file.path.clone(),
                name,
                kind,
                line: index + 1,
                signature: trimmed.chars().take(220).collect(),
            });
        }
    }
    symbols
}

fn symbol_candidates(line: &str, language: &str) -> Vec<(String, String)> {
    let mut symbols = Vec::new();
    let lower_language = language.to_ascii_lowercase();
    if lower_language.contains("python") {
        if let Some(rest) = line.strip_prefix("def ") {
            symbols.push(("function".to_string(), token_before(rest, "(")));
        }
        if let Some(rest) = line.strip_prefix("class ") {
            symbols.push(("class".to_string(), token_before(rest, "(:")));
        }
    } else if lower_language.contains("typescript") || lower_language.contains("javascript") {
        let line = line.strip_prefix("export ").unwrap_or(line);
        if let Some(rest) = line.strip_prefix("function ") {
            symbols.push(("function".to_string(), token_before(rest, "(")));
        }
        if let Some(rest) = line.strip_prefix("class ") {
            symbols.push(("class".to_string(), token_before(rest, " {<")));
        }
        if let Some(rest) = line.strip_prefix("const ").or_else(|| line.strip_prefix("let ")) {
            let name = token_before(rest, " =(:");
            if !name.is_empty() {
                symbols.push(("binding".to_string(), name));
            }
        }
    } else if lower_language.contains("rust") {
        if let Some(rest) = line.strip_prefix("pub fn ").or_else(|| line.strip_prefix("fn ")) {
            symbols.push(("function".to_string(), token_before(rest, "(")));
        }
        if let Some(rest) = line.strip_prefix("pub struct ").or_else(|| line.strip_prefix("struct ")) {
            symbols.push(("struct".to_string(), token_before(rest, " {<")));
        }
        if let Some(rest) = line.strip_prefix("pub enum ").or_else(|| line.strip_prefix("enum ")) {
            symbols.push(("enum".to_string(), token_before(rest, " {<")));
        }
    } else if lower_language.contains("java") {
        if line.contains(" class ") || line.starts_with("class ") || line.starts_with("public class ") {
            if let Some(index) = line.find("class ") {
                symbols.push(("class".to_string(), token_before(&line[index + 6..], " {<")));
            }
        }
        if line.contains('(') && line.ends_with('{') {
            let before = line.split('(').next().unwrap_or_default();
            let name = before.split_whitespace().last().unwrap_or_default().to_string();
            if !name.is_empty() && name != "if" && name != "for" && name != "while" {
                symbols.push(("method".to_string(), name));
            }
        }
    } else if lower_language.contains('c') {
        if line.contains('(') && line.ends_with('{') && !line.starts_with("if ") && !line.starts_with("for ") {
            let before = line.split('(').next().unwrap_or_default();
            let name = before.split_whitespace().last().unwrap_or_default().trim_matches('*').to_string();
            if !name.is_empty() {
                symbols.push(("function".to_string(), name));
            }
        }
    }
    symbols
}

fn extract_dependencies(file: &WorkspaceFile) -> Vec<FileDependency> {
    let mut dependencies = Vec::new();
    for (index, line) in file.content.lines().enumerate() {
        let trimmed = line.trim();
        if let Some((kind, target)) = dependency_candidate(trimmed, &file.language) {
            dependencies.push(FileDependency {
                id: Uuid::new_v4().to_string(),
                workspace_id: file.workspace_id.clone(),
                source_path: file.path.clone(),
                target,
                kind,
                line: index + 1,
            });
        }
    }
    dependencies
}

fn dependency_candidate(line: &str, language: &str) -> Option<(String, String)> {
    let lower_language = language.to_ascii_lowercase();
    if lower_language.contains("python") {
        if let Some(rest) = line.strip_prefix("import ") {
            return Some(("import".to_string(), rest.split_whitespace().next()?.trim_matches(',').to_string()));
        }
        if let Some(rest) = line.strip_prefix("from ") {
            return Some(("from".to_string(), rest.split_whitespace().next()?.to_string()));
        }
    } else if lower_language.contains("typescript") || lower_language.contains("javascript") {
        if line.starts_with("import ") {
            if let Some(target) = quoted_value(line) {
                return Some(("import".to_string(), target));
            }
        }
        if line.contains("require(") {
            if let Some(target) = quoted_value(line) {
                return Some(("require".to_string(), target));
            }
        }
    } else if lower_language.contains("rust") {
        if let Some(rest) = line.strip_prefix("use ") {
            return Some(("use".to_string(), rest.trim_end_matches(';').to_string()));
        }
    } else if lower_language.contains("java") {
        if let Some(rest) = line.strip_prefix("import ") {
            return Some(("import".to_string(), rest.trim_end_matches(';').to_string()));
        }
    } else if lower_language.contains('c') && line.starts_with("#include") {
        return Some(("include".to_string(), line.trim_start_matches("#include").trim().to_string()));
    }
    None
}

fn severity_for_risk(risk: &str, metrics: &ReportMetrics) -> String {
    let lower = risk.to_ascii_lowercase();
    if lower.contains("credential")
        || lower.contains("凭据")
        || lower.contains("xss")
        || lower.contains("sql")
        || lower.contains("dynamic code")
        || lower.contains("动态代码")
        || lower.contains("innerhtml")
        || lower.contains("密钥")
        || lower.contains("敏感")
    {
        "high".to_string()
    } else if metrics.complexity_score >= 12
        || lower.contains("large file")
        || lower.contains("文件过大")
        || lower.contains("error handling")
        || lower.contains("错误处理")
    {
        "medium".to_string()
    } else {
        "low".to_string()
    }
}

fn category_for_risk(risk: &str) -> String {
    let lower = risk.to_ascii_lowercase();
    if lower.contains("credential")
        || lower.contains("凭据")
        || lower.contains("xss")
        || lower.contains("sql")
        || lower.contains("dynamic code")
        || lower.contains("动态代码")
        || lower.contains("innerhtml")
        || lower.contains("密钥")
        || lower.contains("敏感")
    {
        "security".to_string()
    } else if lower.contains("test") || lower.contains("todo") || lower.contains("fixme") || lower.contains("测试") {
        "quality".to_string()
    } else if lower.contains("error") || lower.contains("错误") || lower.contains("失败") {
        "reliability".to_string()
    } else {
        "maintainability".to_string()
    }
}

fn category_for_risk_text(code: &str) -> String {
    let lower = code.to_ascii_lowercase();
    if lower.contains("password") || lower.contains("api_key") || lower.contains("secret") || lower.contains("innerhtml") {
        "security".to_string()
    } else {
        "maintainability".to_string()
    }
}

fn title_for_risk(risk: &str) -> String {
    risk.split(':')
        .next()
        .unwrap_or(risk)
        .trim_end_matches('.')
        .chars()
        .take(80)
        .collect()
}

fn suggestion_for_category(category: &str) -> String {
    match category {
        "security" => "复查数据边界，避免源码中出现密钥，并优先使用更安全的 API 或参数化查询。".to_string(),
        "quality" => "处理 TODO/FIXME，并为受影响行为补充回归测试。".to_string(),
        "reliability" => "向调用方暴露失败状态，并写入不包含敏感信息的日志。".to_string(),
        _ => "逐步降低复杂度，并用聚焦测试保护现有行为。".to_string(),
    }
}

fn line_for_risk(code: &str, risk: &str) -> Option<usize> {
    let lower_risk = risk.to_ascii_lowercase();
    let needles = [
        "todo",
        "fixme",
        "eval(",
        "exec(",
        "innerhtml",
        "password",
        "api_key",
        "secret",
        "select ",
        "except:",
        "catch ",
    ];
    let wanted = needles
        .iter()
        .find(|needle| lower_risk.contains(needle.trim_matches(|ch| ch == '(' || ch == ' ')))?;
    code.lines()
        .position(|line| line.to_ascii_lowercase().contains(wanted.trim()))
        .map(|index| index + 1)
}

fn token_before(value: &str, separators: &str) -> String {
    value
        .split(|ch: char| separators.contains(ch) || ch.is_whitespace())
        .next()
        .unwrap_or_default()
        .trim()
        .to_string()
}

fn quoted_value(value: &str) -> Option<String> {
    for quote in ['"', '\''] {
        let Some(start) = value.find(quote) else {
            continue;
        };
        let rest = &value[start + 1..];
        let Some(end) = rest.find(quote) else {
            continue;
        };
        if end > 0 {
            return Some(rest[..end].to_string());
        }
    }
    None
}

fn hash_content(content: &str) -> String {
    let mut hasher = DefaultHasher::new();
    content.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

fn is_supported_file(path: &Path) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .map(|ext| ALLOWED_EXTENSIONS.iter().any(|allowed| ext.eq_ignore_ascii_case(allowed)))
        .unwrap_or(false)
}

fn should_skip_dir(path: &Path) -> bool {
    path.file_name()
        .and_then(|value| value.to_str())
        .map(|name| EXCLUDED_DIRS.iter().any(|excluded| name.eq_ignore_ascii_case(excluded)))
        .unwrap_or(false)
}

fn language_from_extension(path: &Path) -> Option<String> {
    let ext = path.extension()?.to_str()?.to_ascii_lowercase();
    let language = match ext.as_str() {
        "py" => "Python",
        "js" | "jsx" => "JavaScript",
        "ts" | "tsx" => "TypeScript",
        "rs" => "Rust",
        "java" => "Java",
        "c" | "h" => "C",
        "cpp" | "hpp" => "C++",
        "cs" => "C#",
        "go" => "Go",
        "html" => "HTML",
        "css" => "CSS",
        "json" => "JSON",
        "toml" => "TOML",
        "yaml" | "yml" => "YAML",
        "md" => "Markdown",
        "txt" => "Plain Text",
        _ => return None,
    };
    Some(language.to_string())
}
