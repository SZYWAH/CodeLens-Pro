use std::time::{Duration, Instant};

use anyhow::{anyhow, Context};
use futures_util::StreamExt;
use reqwest::Client;
use serde_json::{json, Value};

use crate::models::{AnalysisRequest, LearningCard, LlmTestResult, ReportDetail, Settings};

// Keep the network budget below the desktop task deadline so review tasks still
// have time to persist their deterministic fallback before the 90-second guard.
const LLM_HTTP_TIMEOUT: Duration = Duration::from_secs(85);

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
        .map_err(|error| request_error("LLM request", error))?;

    if !response.status().is_success() {
        return Err(anyhow!("LLM returned HTTP {}", response.status()));
    }

    let body: Value = response
        .json()
        .await
        .map_err(|error| anyhow!("protocol: invalid LLM JSON response: {error}"))?;
    body.pointer("/choices/0/message/content")
        .and_then(|value| value.as_str())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| anyhow!("protocol: LLM response did not include message content"))
}

pub async fn stream_chat<F>(
    settings: &Settings,
    api_key: &str,
    messages: &[ChatMessage],
    on_chunk: F,
) -> anyhow::Result<String>
where
    F: FnMut(&str) -> anyhow::Result<()> + Send,
{
    stream_chat_with_idle_timeout(
        settings,
        api_key,
        messages,
        Duration::from_secs(30),
        on_chunk,
    )
    .await
}

async fn stream_chat_with_idle_timeout<F>(
    settings: &Settings,
    api_key: &str,
    messages: &[ChatMessage],
    idle_timeout: Duration,
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
        .map_err(|error| request_error("LLM stream request", error))?;

    if !response.status().is_success() {
        return Err(anyhow!("LLM returned HTTP {}", response.status()));
    }

    let mut full = String::new();
    let mut pending = Vec::new();
    let mut stream = response.bytes_stream();
    'stream: loop {
        let item = tokio::time::timeout(idle_timeout, stream.next())
            .await
            .map_err(|_| anyhow!("timeout: LLM stream was idle"))?;
        let Some(item) = item else {
            break;
        };
        let bytes = item.context("failed to read LLM stream chunk")?;
        pending.extend_from_slice(&bytes);

        while let Some(line) = take_sse_line(&mut pending)? {
            match parse_sse_line(&line)? {
                SseEvent::Content(chunk) => {
                    full.push_str(&chunk);
                    on_chunk(&chunk)?;
                }
                SseEvent::Done => break 'stream,
                SseEvent::Ignore => {}
            }
        }
    }

    let final_line = std::str::from_utf8(&pending)
        .map_err(|error| anyhow!("protocol: invalid UTF-8 in LLM stream: {error}"))?
        .trim();
    if !final_line.is_empty() {
        if let SseEvent::Content(chunk) = parse_sse_line(final_line)? {
            full.push_str(&chunk);
            on_chunk(&chunk)?;
        }
    }

    if full.trim().is_empty() {
        return Err(anyhow!("protocol: LLM stream completed without content"));
    }
    Ok(full)
}

pub async fn test_connection(settings: &Settings, api_key: Option<String>) -> LlmTestResult {
    let started = Instant::now();
    if let Err(err) = validate_configuration(settings) {
        return LlmTestResult {
            ok: false,
            message: err.to_string(),
            api_base: settings.api_base.clone(),
            model: settings.model.clone(),
            latency_ms: elapsed_ms(started),
            error_code: Some("configuration".to_string()),
        };
    }
    let Some(key) = api_key.filter(|value| !value.trim().is_empty()) else {
        return LlmTestResult {
            ok: false,
            message: "尚未配置 API Key。".to_string(),
            api_base: settings.api_base.clone(),
            model: settings.model.clone(),
            latency_ms: elapsed_ms(started),
            error_code: Some("configuration".to_string()),
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
    match tokio::time::timeout(
        Duration::from_secs(20),
        complete_chat(settings, &key, &messages),
    )
    .await
    {
        Ok(Ok(_)) => LlmTestResult {
            ok: true,
            message: "LLM 连接成功。".to_string(),
            api_base: settings.api_base.clone(),
            model: settings.model.clone(),
            latency_ms: elapsed_ms(started),
            error_code: None,
        },
        Err(_) => LlmTestResult {
            ok: false,
            message: "LLM 连接测试超过 20 秒。".to_string(),
            api_base: settings.api_base.clone(),
            model: settings.model.clone(),
            latency_ms: elapsed_ms(started),
            error_code: Some("timeout".to_string()),
        },
        Ok(Err(err)) => {
            let detail = format!("{err:#}");
            let error_code = classify_llm_error_code(&detail);
            LlmTestResult {
                ok: false,
                message: classify_llm_error_message(error_code, &detail),
                api_base: settings.api_base.clone(),
                model: settings.model.clone(),
                latency_ms: elapsed_ms(started),
                error_code: Some(error_code.to_string()),
            }
        }
    }
}

fn validate_configuration(settings: &Settings) -> anyhow::Result<()> {
    let parsed = reqwest::Url::parse(settings.api_base.trim())
        .map_err(|_| anyhow!("API Base 必须是有效的 HTTP 或 HTTPS 地址。"))?;
    if !matches!(parsed.scheme(), "http" | "https") || parsed.host_str().is_none() {
        return Err(anyhow!("API Base 必须是有效的 HTTP 或 HTTPS 地址。"));
    }
    if settings.model.trim().is_empty() {
        return Err(anyhow!("模型名称不能为空。"));
    }
    Ok(())
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
        .connect_timeout(Duration::from_secs(15))
        .timeout(LLM_HTTP_TIMEOUT)
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

#[derive(Debug, PartialEq, Eq)]
enum SseEvent {
    Content(String),
    Done,
    Ignore,
}

fn take_sse_line(pending: &mut Vec<u8>) -> anyhow::Result<Option<String>> {
    let Some(index) = pending.iter().position(|byte| *byte == b'\n') else {
        return Ok(None);
    };
    let mut line = pending.drain(..=index).collect::<Vec<_>>();
    line.pop();
    if line.last() == Some(&b'\r') {
        line.pop();
    }
    String::from_utf8(line)
        .map(Some)
        .map_err(|error| anyhow!("protocol: invalid UTF-8 in LLM stream: {error}"))
}

fn parse_sse_line(line: &str) -> anyhow::Result<SseEvent> {
    if line.is_empty() || line.starts_with(':') || !line.starts_with("data:") {
        return Ok(SseEvent::Ignore);
    }
    let data = line.trim_start_matches("data:").trim();
    if data == "[DONE]" {
        return Ok(SseEvent::Done);
    }
    let value: Value = serde_json::from_str(data)
        .map_err(|error| anyhow!("protocol: invalid LLM stream JSON: {error}"))?;
    Ok(value
        .pointer("/choices/0/delta/content")
        .and_then(|value| value.as_str())
        .map(|value| SseEvent::Content(value.to_string()))
        .unwrap_or(SseEvent::Ignore))
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
        "语言：{}\n分析模式：{}\n本地摘要：{}\n本地风险：{}\n\n请按当前分析模式生成中文结构化报告，并给出可继续进入问题清单、知识卡片、每日日志和可选行动草稿的行动建议。\n\n代码：\n```{}\n{}\n```",
        local_report.language,
        profile,
        local_report.summary,
        local_report.risks.join("; "),
        local_report.language,
        code
    )
}

pub fn classify_llm_error_code(message: &str) -> &'static str {
    let lower = message.to_ascii_lowercase();
    if lower.contains("401") || lower.contains("403") || lower.contains("unauthorized") {
        "unauthorized"
    } else if lower.contains("429") || lower.contains("rate limit") {
        "rate_limited"
    } else if lower.contains("timeout") || lower.contains("timed out") {
        "timeout"
    } else if lower.contains("404") || lower.contains("configuration:") {
        "configuration"
    } else if lower.contains("http 5")
        || lower.contains("network:")
        || lower.contains("connection")
        || lower.contains("dns")
    {
        "network"
    } else if lower.contains("protocol:") || lower.contains("stream chunk") {
        "protocol"
    } else {
        "internal"
    }
}

pub fn classify_llm_error_message(code: &str, detail: &str) -> String {
    match code {
        "configuration" => "模型名称或 API Base 可能不正确。".to_string(),
        "unauthorized" => "API Key 无效或没有权限。".to_string(),
        "rate_limited" => "模型服务请求过于频繁，请稍后重试。".to_string(),
        "timeout" => "模型请求超时。".to_string(),
        "network" => "无法连接模型服务，请检查网络和 API Base。".to_string(),
        "protocol" => "模型服务返回了无法解析的响应。".to_string(),
        _ => format!("LLM 请求失败：{detail}"),
    }
}

fn request_error(context: &str, error: reqwest::Error) -> anyhow::Error {
    if error.is_timeout() {
        anyhow!("timeout: {context} timed out")
    } else if error.is_connect() {
        anyhow!("network: {context} could not connect")
    } else {
        anyhow!("network: {context} failed: {error}")
    }
}

fn elapsed_ms(started: Instant) -> u64 {
    started.elapsed().as_millis().min(u128::from(u64::MAX)) as u64
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::thread::{self, JoinHandle};

    fn mock_settings(api_base: String) -> Settings {
        Settings {
            enable_llm: true,
            api_base,
            model: "mock-model".to_string(),
            api_key_set: true,
            llm_state: "configured".to_string(),
        }
    }

    fn mock_messages() -> Vec<ChatMessage> {
        vec![ChatMessage {
            role: "user".to_string(),
            content: "ping".to_string(),
        }]
    }

    fn serve_once(
        status: &str,
        content_type: &str,
        body: &str,
        body_delay: Duration,
    ) -> (String, JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind mock server");
        let address = listener.local_addr().expect("mock address");
        let status = status.to_string();
        let content_type = content_type.to_string();
        let body = body.as_bytes().to_vec();
        let handle = thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("accept mock request");
            stream
                .set_read_timeout(Some(Duration::from_secs(2)))
                .expect("set mock read timeout");
            let mut request = Vec::new();
            let mut chunk = [0_u8; 4096];
            loop {
                match stream.read(&mut chunk) {
                    Ok(0) => break,
                    Ok(read) => {
                        request.extend_from_slice(&chunk[..read]);
                        if http_request_complete(&request) {
                            break;
                        }
                    }
                    Err(_) => break,
                }
            }
            let headers = format!(
                "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                body.len()
            );
            let _ = stream.write_all(headers.as_bytes());
            let _ = stream.flush();
            if !body_delay.is_zero() {
                thread::sleep(body_delay);
            }
            let _ = stream.write_all(&body);
            let _ = stream.flush();
        });
        (format!("http://{address}/v1"), handle)
    }

    fn http_request_complete(request: &[u8]) -> bool {
        let Some(header_end) = request.windows(4).position(|part| part == b"\r\n\r\n") else {
            return false;
        };
        let headers = String::from_utf8_lossy(&request[..header_end]);
        let content_length = headers.lines().find_map(|line| {
            let (name, value) = line.split_once(':')?;
            name.eq_ignore_ascii_case("content-length")
                .then(|| value.trim().parse::<usize>().ok())
                .flatten()
        });
        request.len() >= header_end + 4 + content_length.unwrap_or(0)
    }

    #[test]
    fn classifies_stable_error_codes() {
        assert_eq!(classify_llm_error_code("LLM returned HTTP 401"), "unauthorized");
        assert_eq!(classify_llm_error_code("LLM returned HTTP 429"), "rate_limited");
        assert_eq!(classify_llm_error_code("timeout: idle"), "timeout");
        assert_eq!(classify_llm_error_code("network: could not connect"), "network");
        assert_eq!(classify_llm_error_code("protocol: invalid JSON"), "protocol");
        assert_eq!(classify_llm_error_code("LLM returned HTTP 500"), "network");
    }

    #[test]
    fn parses_openai_compatible_sse_content() {
        assert_eq!(
            parse_sse_line(r#"data: {"choices":[{"delta":{"content":"你好"}}]}"#)
                .expect("valid event"),
            SseEvent::Content("你好".to_string())
        );
        assert_eq!(parse_sse_line("data: [DONE]").expect("done event"), SseEvent::Done);
    }

    #[test]
    fn preserves_utf8_when_network_chunks_split_a_character() {
        let payload = concat!(r#"data: {"choices":[{"delta":{"content":"你好"}}]}"#, "\n");
        let bytes = payload.as_bytes();
        let character = payload.find('你').expect("Chinese content offset");
        let split = character + 1;
        let mut pending = bytes[..split].to_vec();
        assert!(take_sse_line(&mut pending).expect("partial line").is_none());
        pending.extend_from_slice(&bytes[split..]);
        let line = take_sse_line(&mut pending)
            .expect("complete line")
            .expect("line available");
        assert_eq!(
            parse_sse_line(&line).expect("valid UTF-8 SSE"),
            SseEvent::Content("你好".to_string())
        );
    }

    #[tokio::test(flavor = "current_thread")]
    async fn accepts_openai_compatible_json_and_sse_responses() {
        let (base, server) = serve_once(
            "200 OK",
            "application/json",
            r#"{"choices":[{"message":{"content":"json ok"}}]}"#,
            Duration::ZERO,
        );
        let json = complete_chat(&mock_settings(base), "test-key", &mock_messages())
            .await
            .expect("JSON completion");
        assert_eq!(json, "json ok");
        server.join().expect("JSON server");

        let (base, server) = serve_once(
            "200 OK",
            "text/event-stream",
            concat!(
                "data: {\"choices\":[{\"delta\":{\"content\":\"你\"}}]}\n\n",
                "data: {\"choices\":[{\"delta\":{\"content\":\"好\"}}]}\n\n",
                "data: [DONE]\n\n"
            ),
            Duration::ZERO,
        );
        let mut chunks = String::new();
        let full = stream_chat(
            &mock_settings(base),
            "test-key",
            &mock_messages(),
            |chunk| {
                chunks.push_str(chunk);
                Ok(())
            },
        )
        .await
        .expect("SSE completion");
        assert_eq!(full, "你好");
        assert_eq!(chunks, "你好");
        server.join().expect("SSE server");
    }

    #[tokio::test(flavor = "current_thread")]
    async fn classifies_http_failures_and_rejects_malformed_streams() {
        for (status, expected) in [
            ("401 Unauthorized", "unauthorized"),
            ("429 Too Many Requests", "rate_limited"),
            ("500 Internal Server Error", "network"),
        ] {
            let (base, server) = serve_once(
                status,
                "application/json",
                r#"{"error":"mock"}"#,
                Duration::ZERO,
            );
            let error = complete_chat(&mock_settings(base), "test-key", &mock_messages())
                .await
                .expect_err("HTTP failure");
            assert_eq!(classify_llm_error_code(&error.to_string()), expected);
            server.join().expect("status server");
        }

        let (base, server) = serve_once(
            "200 OK",
            "text/event-stream",
            "data: {not-json}\n\n",
            Duration::ZERO,
        );
        let error = stream_chat(
            &mock_settings(base),
            "test-key",
            &mock_messages(),
            |_| Ok(()),
        )
        .await
        .expect_err("malformed SSE");
        assert_eq!(classify_llm_error_code(&error.to_string()), "protocol");
        server.join().expect("malformed server");
    }

    #[tokio::test(flavor = "current_thread")]
    async fn times_out_when_the_first_stream_fragment_is_idle() {
        let (base, server) = serve_once(
            "200 OK",
            "text/event-stream",
            "data: [DONE]\n\n",
            Duration::from_millis(80),
        );
        let error = stream_chat_with_idle_timeout(
            &mock_settings(base),
            "test-key",
            &mock_messages(),
            Duration::from_millis(20),
            |_| Ok(()),
        )
        .await
        .expect_err("idle timeout");
        assert_eq!(classify_llm_error_code(&error.to_string()), "timeout");
        server.join().expect("idle server");
    }
}
