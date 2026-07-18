use chrono::Utc;
use serde_json::json;
use uuid::Uuid;

use crate::models::{AnalysisRequest, ReportDetail, ReportMetrics};

pub fn analyze_locally(request: &AnalysisRequest) -> ReportDetail {
    let code = request.code.trim();
    let language = request
        .language
        .as_deref()
        .filter(|value| !value.trim().is_empty() && *value != "auto")
        .map(|value| value.trim().to_string())
        .unwrap_or_else(|| detect_language(code));

    let lines: Vec<&str> = code.lines().collect();
    let total_lines = lines.len();
    let non_empty_lines = lines.iter().filter(|line| !line.trim().is_empty()).count();
    let comment_lines = count_comment_lines(&lines);
    let complexity_score = estimate_complexity(code);
    let mut risks = detect_risks(code, total_lines, complexity_score);
    let profile = analysis_profile_label(request);
    let mut suggestions = build_suggestions(code, &language, complexity_score, risks.len());
    suggestions.extend(profile_suggestions(&profile));

    if risks.is_empty() {
        risks.push("本地分析器未发现明显高风险模式。".to_string());
    }
    if suggestions.is_empty() {
        suggestions.push("保持当前结构，并围绕变更行为补充有针对性的测试。".to_string());
    }

    let risk_count = risks.len();
    let suggestion_count = suggestions.len();
    let summary = summarize(&language, total_lines, complexity_score, risk_count);
    let title = request
        .title
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| local_report_title(request, &language));

    let metrics = ReportMetrics {
        total_lines,
        non_empty_lines,
        comment_lines,
        complexity_score,
        risk_count,
        suggestion_count,
    };

    ReportDetail {
        id: Uuid::new_v4().to_string(),
        title,
        language,
        code_excerpt: excerpt(code),
        summary: summary.clone(),
        full_report: render_local_report(&summary, &profile, &risks, &suggestions, &metrics),
        analysis_source: "local".to_string(),
        report_type: "single".to_string(),
        risk_level: risk_level(risk_count, complexity_score).to_string(),
        file_count: 1,
        metadata_json: json!({
            "analysis_profile": profile,
            "mode_group": request.mode_group,
            "mode": request.mode,
            "mode_label": request.mode_label
        }).to_string(),
        risks,
        suggestions,
        metrics,
        files: Vec::new(),
        created_at: Utc::now().to_rfc3339(),
    }
}

pub fn local_report_title(request: &AnalysisRequest, language: &str) -> String {
    let subject = request
        .source_label
        .as_deref()
        .and_then(file_stem)
        .or_else(|| extract_code_subject(&request.code))
        .unwrap_or_else(|| language.to_string());
    let mode = request
        .mode_label
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| mode_title(request.mode.as_deref()));
    compact_title(&format!("{subject} {mode}"))
}

fn file_stem(value: &str) -> Option<String> {
    let file_name = value.rsplit(['/', '\\']).next()?.trim();
    let stem = file_name.rsplit_once('.').map(|(stem, _)| stem).unwrap_or(file_name).trim();
    (!stem.is_empty()).then(|| compact_title(stem))
}

fn extract_code_subject(code: &str) -> Option<String> {
    const PREFIXES: &[&str] = &[
        "async function ", "function ", "async fn ", "fn ", "def ", "class ", "struct ", "interface ",
    ];
    for line in code.lines().map(str::trim_start) {
        for prefix in PREFIXES {
            if let Some(rest) = line.strip_prefix(prefix) {
                let name = rest
                    .trim_start()
                    .split(|character: char| !character.is_ascii_alphanumeric() && character != '_' && character != '$')
                    .next()
                    .unwrap_or("")
                    .trim();
                if !name.is_empty() {
                    return Some(compact_title(name));
                }
            }
        }
    }
    None
}

fn mode_title(mode: Option<&str>) -> String {
    match mode.unwrap_or_default() {
        "func_comment" => "函数解读".to_string(),
        "risk_review" => "风险审查".to_string(),
        "refactor" => "重构建议".to_string(),
        "test_plan" => "测试建议".to_string(),
        "script_review" => "脚本审查".to_string(),
        "architecture" => "结构审查".to_string(),
        _ => "代码审查".to_string(),
    }
}

pub fn compact_title(value: &str) -> String {
    let normalized = value.split_whitespace().collect::<Vec<_>>().join(" ");
    let mut title = normalized.chars().take(60).collect::<String>();
    if title.is_empty() {
        title = "代码审查".to_string();
    }
    title
}

pub fn detect_language(code: &str) -> String {
    let lower = code.to_ascii_lowercase();
    if lower.contains("fn main()") || lower.contains("use std::") || lower.contains("impl ") {
        "Rust".to_string()
    } else if lower.contains("def ") || lower.contains("import ") || lower.contains("print(") {
        "Python".to_string()
    } else if lower.contains("interface ") || lower.contains(": string") || lower.contains("tsx") {
        "TypeScript".to_string()
    } else if lower.contains("function ") || lower.contains("const ") || lower.contains("let ") {
        "JavaScript".to_string()
    } else if lower.contains("public class") || lower.contains("system.out.println") {
        "Java".to_string()
    } else if lower.contains("#include") || lower.contains("std::") {
        "C/C++".to_string()
    } else {
        "Plain Text".to_string()
    }
}

fn count_comment_lines(lines: &[&str]) -> usize {
    lines
        .iter()
        .filter(|line| {
            let trimmed = line.trim_start();
            trimmed.starts_with("//")
                || trimmed.starts_with('#')
                || trimmed.starts_with("/*")
                || trimmed.starts_with('*')
        })
        .count()
}

fn estimate_complexity(code: &str) -> usize {
    let lower = code.to_ascii_lowercase();
    let keywords = [
        " if ", " else if ", " for ", " while ", " match ", " switch ", " case ", " catch ",
        " except ", "&&", "||", "?",
    ];
    keywords
        .iter()
        .map(|keyword| lower.matches(keyword).count())
        .sum::<usize>()
        .max(1)
}

pub fn metrics_for_code(code: &str) -> ReportMetrics {
    let lines: Vec<&str> = code.lines().collect();
    let total_lines = lines.len();
    let non_empty_lines = lines.iter().filter(|line| !line.trim().is_empty()).count();
    let comment_lines = count_comment_lines(&lines);
    let complexity_score = estimate_complexity(code);
    let risks = detect_risks(code, total_lines, complexity_score);
    ReportMetrics {
        total_lines,
        non_empty_lines,
        comment_lines,
        complexity_score,
        risk_count: risks.len().max(1),
        suggestion_count: 0,
    }
}

pub fn local_risks_for_code(code: &str) -> Vec<String> {
    let total_lines = code.lines().count();
    let complexity_score = estimate_complexity(code);
    let mut risks = detect_risks(code, total_lines, complexity_score);
    if risks.is_empty() {
        risks.push("本地分析器未发现明显高风险模式。".to_string());
    }
    risks
}

fn detect_risks(code: &str, total_lines: usize, complexity_score: usize) -> Vec<String> {
    let lower = code.to_ascii_lowercase();
    let mut risks = Vec::new();

    if total_lines > 300 {
        risks.push("文件过大：继续扩展前建议拆分职责边界。".to_string());
    }
    if complexity_score > 18 {
        risks.push("分支复杂度偏高，可能让行为难以测试和推理。".to_string());
    }
    if lower.contains("todo") || lower.contains("fixme") {
        risks.push("代码中仍保留 TODO/FIXME 标记，需要确认是否影响当前交付。".to_string());
    }
    if lower.contains("eval(") || lower.contains("exec(") {
        risks.push("检测到动态代码执行，需要仔细审查输入可信边界。".to_string());
    }
    if lower.contains("innerhtml") {
        risks.push("直接使用 innerHTML 时如果未清洗内容，可能引入 XSS 风险。".to_string());
    }
    if lower.contains("password") || lower.contains("api_key") || lower.contains("secret") {
        risks.push("检测到疑似凭据相关字符串，避免提交密钥或在日志中输出敏感信息。".to_string());
    }
    if lower.contains("except:") || lower.contains("catch (") && lower.contains("console.log") {
        risks.push("宽泛或只打印日志的错误处理可能会向用户隐藏真实失败。".to_string());
    }
    if lower.contains("select ") && lower.contains("+") && lower.contains("where") {
        risks.push("检测到 SQL 字符串拼接模式，建议改用参数化查询。".to_string());
    }

    risks
}

fn build_suggestions(
    code: &str,
    language: &str,
    complexity_score: usize,
    risk_count: usize,
) -> Vec<String> {
    let mut suggestions = Vec::new();
    if complexity_score > 10 {
        suggestions.push("将判断密集的分支提取为命名清晰的 helper，并补充聚焦测试。".to_string());
    }
    if risk_count > 0 {
        suggestions.push("在真实项目流程中使用前，优先处理上方列出的风险。".to_string());
    }
    if code.lines().count() > 120 {
        suggestions.push("按职责拆分代码，并保持公开入口足够小。".to_string());
    }
    if language == "Python" {
        suggestions.push("为边界函数补充类型标注，让后续重构更安全。".to_string());
    }
    if language == "TypeScript" || language == "JavaScript" {
        suggestions.push("在 API 和 UI 边界先校验输入，再把数据传给下游逻辑。".to_string());
    }
    suggestions.push("为最重要行为补一个成功路径测试和一个失败路径测试。".to_string());
    suggestions
}

fn analysis_profile_label(request: &AnalysisRequest) -> String {
    request
        .mode_label
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .or_else(|| {
            request
                .mode
                .as_deref()
                .map(|value| match value {
                    "func_comment" => "函数注释与意图解释",
                    "risk_review" => "风险审查",
                    "refactor" => "重构建议",
                    "test_plan" => "测试建议",
                    "script_review" => "脚本流程审查",
                    "architecture" => "结构与职责审查",
                    _ => value,
                })
                .map(str::to_string)
        })
        .unwrap_or_else(|| "综合代码审查".to_string())
}

fn profile_suggestions(profile: &str) -> Vec<String> {
    if profile.contains("测试") {
        return vec![
            "优先补充边界输入、异常路径和核心成功路径测试。".to_string(),
            "把报告中的风险点转成可执行的测试清单，方便后续回归。".to_string(),
        ];
    }
    if profile.contains("重构") || profile.contains("结构") {
        return vec![
            "先标出职责边界，再小步抽取 helper 或模块，避免一次性大改。".to_string(),
            "重构前后保留行为等价验证，必要时生成确认式行动草稿。".to_string(),
        ];
    }
    if profile.contains("注释") || profile.contains("解释") {
        return vec![
            "为公开入口、复杂分支和隐含业务规则补充说明，避免只描述代码表面动作。".to_string(),
            "把关键意图沉淀为知识卡片，便于之后复盘同类写法。".to_string(),
        ];
    }
    vec![
        "按风险优先级处理输入边界、异常路径、敏感信息和高复杂度分支。".to_string(),
        "把高价值结论继续流转到问题清单、知识卡片或行动草稿。".to_string(),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(code: &str, source_label: Option<&str>) -> AnalysisRequest {
        AnalysisRequest {
            code: code.to_string(),
            language: Some("TypeScript".to_string()),
            title: None,
            source_label: source_label.map(str::to_string),
            mode_group: Some("function".to_string()),
            mode: Some("risk_review".to_string()),
            mode_label: Some("风险审查".to_string()),
            use_llm: Some(false),
            retry_report_id: None,
        }
    }

    #[test]
    fn local_report_title_prefers_imported_file_name() {
        let request = request("function loadUserProfile() {}", Some(r"C:\\work\\auth-service.ts"));
        assert_eq!(local_report_title(&request, "TypeScript"), "auth-service 风险审查");
    }

    #[test]
    fn local_report_title_uses_code_subject_without_source_file() {
        let request = request("async function loadUserProfile() {}", None);
        assert_eq!(local_report_title(&request, "TypeScript"), "loadUserProfile 风险审查");
    }
}

fn summarize(language: &str, total_lines: usize, complexity_score: usize, risk_count: usize) -> String {
    format!(
        "已分析 {total_lines} 行 {language} 代码。本地复杂度评分为 {complexity_score}，标记 {risk_count} 个风险点。"
    )
}

fn excerpt(code: &str) -> String {
    let mut text = code
        .lines()
        .take(18)
        .collect::<Vec<_>>()
        .join("\n")
        .trim()
        .to_string();
    if text.len() > 1200 {
        text.truncate(1200);
        text.push_str("\n...");
    }
    text
}

pub fn code_excerpt(code: &str) -> String {
    excerpt(code)
}

pub fn risk_level(risk_count: usize, complexity_score: usize) -> &'static str {
    if risk_count >= 5 || complexity_score >= 24 {
        "high"
    } else if risk_count >= 3 || complexity_score >= 12 {
        "medium"
    } else {
        "low"
    }
}

fn render_local_report(
    summary: &str,
    profile: &str,
    risks: &[String],
    suggestions: &[String],
    metrics: &ReportMetrics,
) -> String {
    let risk_lines = risks
        .iter()
        .map(|item| format!("- {item}"))
        .collect::<Vec<_>>()
        .join("\n");
    let suggestion_lines = suggestions
        .iter()
        .map(|item| format!("- {item}"))
        .collect::<Vec<_>>()
        .join("\n");

    format!(
        "# 代码分析报告\n\n## 摘要\n{summary}\n\n## 分析模式\n- 当前模式：{profile}\n- 后续动作：可继续生成知识卡片、加入每日日志，必要时围绕本报告创建行动草稿。\n\n## 指标\n- 总行数：{}\n- 有效行：{}\n- 注释行：{}\n- 复杂度评分：{}\n\n## 风险点\n{risk_lines}\n\n## 改进建议\n{suggestion_lines}\n",
        metrics.total_lines,
        metrics.non_empty_lines,
        metrics.comment_lines,
        metrics.complexity_score
    )
}
