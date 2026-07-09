use chrono::Utc;
use serde_json::json;
use uuid::Uuid;

use crate::analysis;
use crate::models::{DiffAnalyzeRequest, ReportDetail, ReportMetrics};

pub fn analyze_diff_locally(request: &DiffAnalyzeRequest) -> ReportDetail {
    let before_lines: Vec<&str> = request.before_code.lines().collect();
    let after_lines: Vec<&str> = request.after_code.lines().collect();
    let added = count_added_lines(&before_lines, &after_lines);
    let removed = count_added_lines(&after_lines, &before_lines);
    let language = request
        .language
        .as_deref()
        .filter(|value| !value.trim().is_empty() && *value != "auto")
        .map(str::to_string)
        .unwrap_or_else(|| analysis::detect_language(&request.after_code));

    let before_metrics = analysis::metrics_for_code(&request.before_code);
    let after_metrics = analysis::metrics_for_code(&request.after_code);
    let mut risks = analysis::local_risks_for_code(&request.after_code);
    if after_metrics.complexity_score > before_metrics.complexity_score + 4 {
        risks.push("新版本明显增加了分支复杂度，需要重点复查新增路径。".to_string());
    }
    if request.before_code.trim() == request.after_code.trim() {
        risks.push("两个版本内容相同，无法推断有效行为差异。".to_string());
    }

    let suggestions = vec![
        "合并前重点复查新增分支和错误处理路径。".to_string(),
        "为变更路径补充测试，并为旧行为增加一个回归测试。".to_string(),
        "保持 diff 足够小，让审查者能把修改意图映射到具体代码。".to_string(),
    ];
    let risk_count = risks.len();
    let complexity_score = after_metrics.complexity_score.saturating_sub(before_metrics.complexity_score) + 1;
    let metrics = ReportMetrics {
        total_lines: after_metrics.total_lines,
        non_empty_lines: after_metrics.non_empty_lines,
        comment_lines: after_metrics.comment_lines,
        complexity_score,
        risk_count,
        suggestion_count: suggestions.len(),
    };
    let summary = format!(
        "已对比 {} 与 {}。约新增 {added} 行、删除 {removed} 行，检测到 {risk_count} 个风险点。",
        request.before_label, request.after_label
    );
    let full_report = render_diff_report(&summary, added, removed, &risks, &suggestions, &before_metrics, &after_metrics);
    let title = request
        .title
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| format!("代码对比分析 - {}", Utc::now().format("%Y-%m-%d %H:%M")));

    ReportDetail {
        id: Uuid::new_v4().to_string(),
        title,
        language,
        code_excerpt: format!(
            "旧版本：{}\n新版本：{}\n\n{}",
            request.before_label,
            request.after_label,
            analysis::code_excerpt(&request.after_code)
        ),
        summary,
        full_report,
        analysis_source: "local".to_string(),
        report_type: "diff".to_string(),
        risk_level: analysis::risk_level(risk_count, metrics.complexity_score).to_string(),
        file_count: 2,
        metadata_json: json!({
            "before_label": request.before_label,
            "after_label": request.after_label,
            "added_lines": added,
            "removed_lines": removed
        })
        .to_string(),
        risks,
        suggestions,
        metrics,
        files: Vec::new(),
        created_at: Utc::now().to_rfc3339(),
    }
}

fn count_added_lines(target: &[&str], baseline: &[&str]) -> usize {
    target
        .iter()
        .filter(|line| {
            let trimmed = line.trim();
            !trimmed.is_empty() && !baseline.iter().any(|other| other.trim() == trimmed)
        })
        .count()
}

fn render_diff_report(
    summary: &str,
    added: usize,
    removed: usize,
    risks: &[String],
    suggestions: &[String],
    before_metrics: &ReportMetrics,
    after_metrics: &ReportMetrics,
) -> String {
    let risk_lines = risks.iter().map(|item| format!("- {item}")).collect::<Vec<_>>().join("\n");
    let suggestion_lines = suggestions
        .iter()
        .map(|item| format!("- {item}"))
        .collect::<Vec<_>>()
        .join("\n");
    format!(
        "# 代码对比报告\n\n## 摘要\n{summary}\n\n## 变更规模\n- 新增行：{added}\n- 删除行：{removed}\n\n## 指标\n- 旧版本复杂度：{}\n- 新版本复杂度：{}\n- 旧版本行数：{}\n- 新版本行数：{}\n\n## 风险点\n{risk_lines}\n\n## 改进建议\n{suggestion_lines}\n",
        before_metrics.complexity_score,
        after_metrics.complexity_score,
        before_metrics.total_lines,
        after_metrics.total_lines
    )
}
