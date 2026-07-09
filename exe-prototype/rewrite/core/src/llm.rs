use std::time::Duration;

use anyhow::{anyhow, Context};
use futures_util::StreamExt;
use reqwest::Client;
use serde_json::{json, Value};

use crate::models::{AnalysisRequest, LearningCard, LlmTestResult, ReportDetail, Settings};

#[derive(Debug, Clone)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

pub async fn generate_report(
    settings: &Settings,
    api_key: &str,
    request: &AnalysisRequest,
    local_report: &ReportDetail,
) -> anyhow::Result<String> {
    let prompt = build_prompt(request, local_report);
    let messages = vec![
        ChatMessage {
            role: "system".to_string(),
            content: "你是一名资深代码审查专家。请使用中文输出简洁的 Markdown 报告，包含摘要、风险点和改进建议。".to_string(),
        },
        ChatMessage {
            role: "user".to_string(),
            content: prompt,
        },
    ];
    complete_chat(settings, api_key, &messages).await
}

pub async fn complete_chat(
    settings: &Settings,
    api_key: &str,
    messages: &[ChatMessage],
) -> anyhow::Result<String> {
    let endpoint = chat_completions_endpoint(&settings.api_base);
    let client = http_client()?;
    let response = client
        .post(endpoint)
        .bearer_auth(api_key)
        .json(&json!({
            "model": settings.model,
            "messages": render_messages(messages),
            "temperature": 0.2
        }))
        .send()
        .await
        .context("LLM request failed")?;

    if !response.status().is_success() {
        return Err(anyhow!("LLM returned HTTP {}", response.status()));
    }

    let body: Value = response.json().await.context("invalid LLM JSON response")?;
    body.pointer("/choices/0/message/content")
        .and_then(|value| value.as_str())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| anyhow!("LLM response did not include message content"))
}

pub async fn stream_chat<F>(
    settings: &Settings,
    api_key: &str,
    messages: &[ChatMessage],
    mut on_chunk: F,
) -> anyhow::Result<String>
where
    F: FnMut(&str) -> anyhow::Result<()> + Send,
{
    let endpoint = chat_completions_endpoint(&settings.api_base);
    let client = http_client()?;
    let response = client
        .post(endpoint)
        .bearer_auth(api_key)
        .json(&json!({
            "model": settings.model,
            "messages": render_messages(messages),
            "temperature": 0.2,
            "stream": true
        }))
        .send()
        .await
        .context("LLM stream request failed")?;

    if !response.status().is_success() {
        return Err(anyhow!("LLM returned HTTP {}", response.status()));
    }

    let mut full = String::new();
    let mut pending = String::new();
    let mut stream = response.bytes_stream();
    while let Some(item) = stream.next().await {
        let bytes = item.context("failed to read LLM stream chunk")?;
        pending.push_str(&String::from_utf8_lossy(&bytes));

        while let Some(index) = pending.find('\n') {
            let line = pending[..index].trim().to_string();
            pending = pending[index + 1..].to_string();
            if let Some(chunk) = parse_sse_line(&line)? {
                full.push_str(&chunk);
                on_chunk(&chunk)?;
            }
        }
    }

    if full.trim().is_empty() {
        return Err(anyhow!("LLM stream completed without content"));
    }
    Ok(full)
}

pub async fn test_connection(settings: &Settings, api_key: Option<String>) -> LlmTestResult {
    let Some(key) = api_key.filter(|value| !value.trim().is_empty()) else {
        return LlmTestResult {
            ok: false,
            message: "尚未配置 API Key。".to_string(),
        };
    };
    let messages = vec![
        ChatMessage {
            role: "system".to_string(),
            content: "只回复：ok".to_string(),
        },
        ChatMessage {
            role: "user".to_string(),
            content: "连接测试".to_string(),
        },
    ];
    match complete_chat(settings, &key, &messages).await {
        Ok(_) => LlmTestResult {
            ok: true,
            message: "LLM 连接成功。".to_string(),
        },
        Err(err) => LlmTestResult {
            ok: false,
            message: classify_llm_error(&err.to_string()),
        },
    }
}

pub fn report_messages(title: &str, context: &str) -> Vec<ChatMessage> {
    vec![
        ChatMessage {
            role: "system".to_string(),
            content: "你是一名资深软件工程审查专家。请使用中文输出结构化 Markdown 报告，包含摘要、文件概览、风险点、优先修复建议和学习要点。".to_string(),
        },
        ChatMessage {
            role: "user".to_string(),
            content: format!("{title}\n\n{context}"),
        },
    ]
}

pub fn chat_messages(history: &[ChatMessage], user_message: &str, context: Option<&str>) -> Vec<ChatMessage> {
    let mut messages = vec![ChatMessage {
        role: "system".to_string(),
        content: "你是 CodeLens Pro Next 的中文编程助手。回答要清晰、务实，并给出可执行的代码建议。".to_string(),
    }];
    if let Some(context) = context.filter(|value| !value.trim().is_empty()) {
        messages.push(ChatMessage {
            role: "system".to_string(),
            content: format!("当前报告或项目上下文：\n{context}"),
        });
    }
    messages.extend(history.iter().cloned());
    messages.push(ChatMessage {
        role: "user".to_string(),
        content: user_message.to_string(),
    });
    messages
}

pub fn learning_material_messages(card: &LearningCard) -> Vec<ChatMessage> {
    vec![
        ChatMessage {
            role: "system".to_string(),
            content: "你是一名中文编程学习教练。请根据知识卡片生成 Markdown 学习材料，包含概念解释、代码审查视角、练习题和复习清单。不要输出 API Key 或内部日志。".to_string(),
        },
        ChatMessage {
            role: "user".to_string(),
            content: format!(
                "知识卡片标题：{}\n标签：{}\n内容：{}",
                card.title,
                card.tags.join("、"),
                card.content
            ),
        },
    ]
}

fn http_client() -> anyhow::Result<Client> {
    Client::builder()
        .timeout(Duration::from_secs(60))
        .build()
        .context("failed to create HTTP client")
}

fn chat_completions_endpoint(api_base: &str) -> String {
    let trimmed = api_base.trim().trim_end_matches('/');
    if trimmed.ends_with("/chat/completions") {
        trimmed.to_string()
    } else {
        format!("{trimmed}/chat/completions")
    }
}

fn render_messages(messages: &[ChatMessage]) -> Vec<Value> {
    messages
        .iter()
        .map(|message| {
            json!({
                "role": message.role,
                "content": message.content
            })
        })
        .collect()
}

fn parse_sse_line(line: &str) -> anyhow::Result<Option<String>> {
    if line.is_empty() || line.starts_with(':') || !line.starts_with("data:") {
        return Ok(None);
    }
    let data = line.trim_start_matches("data:").trim();
    if data == "[DONE]" {
        return Ok(None);
    }
    let value: Value = serde_json::from_str(data).context("invalid LLM stream JSON")?;
    Ok(value
        .pointer("/choices/0/delta/content")
        .and_then(|value| value.as_str())
        .map(str::to_string))
}

fn build_prompt(request: &AnalysisRequest, local_report: &ReportDetail) -> String {
    let code = request.code.chars().take(12_000).collect::<String>();
    let profile = request
        .mode_label
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .or(request.mode.as_deref())
        .unwrap_or("综合代码审查");
    format!(
        "语言：{}\n分析模式：{}\n本地摘要：{}\n本地风险：{}\n\n请按当前分析模式生成中文结构化报告，并给出可继续进入问题清单、知识卡片、每日日志和 Agent 计划的行动建议。\n\n代码：\n```{}\n{}\n```",
        local_report.language,
        profile,
        local_report.summary,
        local_report.risks.join("; "),
        local_report.language,
        code
    )
}

fn classify_llm_error(message: &str) -> String {
    let lower = message.to_ascii_lowercase();
    if lower.contains("401") || lower.contains("403") || lower.contains("unauthorized") {
        "API Key 无效或没有权限。".to_string()
    } else if lower.contains("404") || lower.contains("model") {
        "模型名称或 API Base 可能不正确。".to_string()
    } else if lower.contains("timeout") || lower.contains("connection") || lower.contains("dns") {
        "网络连接失败或请求超时。".to_string()
    } else {
        format!("LLM 连接失败：{message}")
    }
}
