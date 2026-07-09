use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{anyhow, Context};

use crate::analysis;
use crate::models::{ProjectFileInput, ProjectImportResult};

const MAX_FILES: usize = 120;
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

pub fn import_files(paths: &[PathBuf]) -> anyhow::Result<ProjectImportResult> {
    let mut files = Vec::new();
    let mut skipped = Vec::new();

    for path in paths {
        if files.len() >= MAX_FILES {
            skipped.push(format!("Reached file limit of {MAX_FILES}."));
            break;
        }
        match read_code_file(path, None) {
            Ok(file) => files.push(file),
            Err(err) => skipped.push(format!("{}: {err}", path.display())),
        }
    }

    if files.is_empty() {
        return Err(anyhow!("No supported text code files were imported."));
    }

    Ok(ProjectImportResult {
        project_name: infer_project_name(paths.first()),
        root_path: None,
        files,
        skipped,
    })
}

pub fn import_folder(root: &Path) -> anyhow::Result<ProjectImportResult> {
    if !root.is_dir() {
        return Err(anyhow!("Selected path is not a folder: {}", root.display()));
    }

    let mut candidates = Vec::new();
    collect_files(root, root, &mut candidates)?;
    candidates.sort();

    let mut files = Vec::new();
    let mut skipped = Vec::new();
    for path in candidates {
        if files.len() >= MAX_FILES {
            skipped.push(format!("Reached file limit of {MAX_FILES}."));
            break;
        }
        match read_code_file(&path, Some(root)) {
            Ok(file) => files.push(file),
            Err(err) => skipped.push(format!("{}: {err}", path.display())),
        }
    }

    if files.is_empty() {
        return Err(anyhow!("No supported text code files were found in the selected folder."));
    }

    Ok(ProjectImportResult {
        project_name: root
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("Imported Project")
            .to_string(),
        root_path: Some(root.display().to_string()),
        files,
        skipped,
    })
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

fn read_code_file(path: &Path, root: Option<&Path>) -> anyhow::Result<ProjectFileInput> {
    if !is_supported_file(path) {
        return Err(anyhow!("unsupported file extension"));
    }
    let metadata = fs::metadata(path)?;
    if metadata.len() > MAX_FILE_BYTES {
        return Err(anyhow!("file is larger than {} KB", MAX_FILE_BYTES / 1024));
    }
    let content = fs::read_to_string(path).context("file is not valid UTF-8 text")?;
    let display_path = root
        .and_then(|base| path.strip_prefix(base).ok())
        .unwrap_or(path)
        .display()
        .to_string();
    let language = language_from_extension(path).unwrap_or_else(|| analysis::detect_language(&content));
    Ok(ProjectFileInput {
        path: display_path,
        content,
        language: Some(language),
    })
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

fn infer_project_name(first_path: Option<&PathBuf>) -> String {
    first_path
        .and_then(|path| path.parent())
        .and_then(|path| path.file_name())
        .and_then(|value| value.to_str())
        .unwrap_or("Imported Files")
        .to_string()
}
