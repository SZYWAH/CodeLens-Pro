import { Bot, Check, Copy, Loader2, MessageSquarePlus, RotateCcw, Send, Trash2 } from "lucide-react";
import type { CSSProperties, MouseEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api";
import { streamPost } from "../lib/stream";
import { MarkdownDocument } from "./MarkdownDocument";
import { SelectField } from "./SelectField";
import type { ChatMessage, SettingsResponse } from "../types";

type ChatPanelMode = "general" | "report";

export type ChatPanelProps = {
  settings: SettingsResponse | null;
  mode?: ChatPanelMode;
  sessionId?: string | null;
  reportId?: string | null;
  codeContext?: string;
  reportContext?: string;
  title?: string;
  emptyText?: string;
  className?: string;
  compact?: boolean;
  liftOnInputResize?: boolean;
  onSessionIdChange?: (sessionId: string | null) => void;
  onSessionSaved?: (sessionId: string) => void;
};

export function ChatPanel({
  settings,
  mode = "general",
  sessionId,
  reportId,
  codeContext = "",
  reportContext = "",
  title,
  emptyText,
  className = "",
  compact = false,
  liftOnInputResize = false,
  onSessionIdChange,
  onSessionSaved
}: ChatPanelProps) {
  const [activeSessionId, setActiveSessionId] = useState<string | null>(sessionId ?? null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [model, setModel] = useState(settings?.default_model_label ?? "dsV4flash");
  const [loading, setLoading] = useState(false);
  const [loadingSession, setLoadingSession] = useState(false);
  const [error, setError] = useState("");
  const [copiedMessageKey, setCopiedMessageKey] = useState<string | null>(null);
  const [inputHeight, setInputHeight] = useState(compact ? 48 : 56);
  const [isResizingInput, setIsResizingInput] = useState(false);
  const inputResizeRef = useRef<{ startY: number; startHeight: number } | null>(null);
  const inputResizeCleanupRef = useRef<(() => void) | null>(null);

  const models = settings?.models ?? { dsV4flash: "deepseek-v4-flash" };
  const isReportMode = mode === "report";
  const canSend = !loading && Boolean(input.trim()) && (!isReportMode || Boolean(reportId));
  const panelTitle = title ?? (isReportMode ? "结合报告继续问 AI" : "AI 对话");
  const reportPromptHint = "围绕当前报告提问，回复会随报告一起保存";
  const panelEmptyText = emptyText ?? (isReportMode ? "报告保存完成后即可开始上下文对话" : "开始一个新的聊天");
  const inputBaseHeight = compact ? 48 : 56;
  const inputMinHeight = compact ? 44 : 48;
  const inputMaxHeight = compact ? 180 : 280;
  const inputOffset = Math.max(0, inputHeight - inputBaseHeight);
  const chatPanelStyle = {
    "--chat-input-height": `${inputHeight}px`,
    "--chat-input-offset": liftOnInputResize ? `${inputOffset}px` : "0px"
  } as CSSProperties;
  const shouldRenderMessages = loadingSession || messages.length > 0 || !isReportMode || !reportId;

  const helperText = useMemo(() => {
    if (isReportMode && !reportId) return "报告保存完成后即可开始上下文对话";
    if (isReportMode) return `已携带当前代码与报告上下文 · ${reportPromptHint}`;
    return "普通聊天模式，不自动携带当前代码或报告";
  }, [isReportMode, reportId]);

  function applySessionId(nextSessionId: string | null) {
    setActiveSessionId(nextSessionId);
    onSessionIdChange?.(nextSessionId);
  }

  function buildMessageKey(message: ChatMessage, index: number) {
    return `${message.id ?? message.created_at ?? "draft"}-${message.role}-${index}`;
  }

  async function copyAssistantReply(content: string, messageKey: string) {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(content);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = content;
        textarea.setAttribute("readonly", "");
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }
      setCopiedMessageKey(messageKey);
      window.setTimeout(() => setCopiedMessageKey((current) => (current === messageKey ? null : current)), 1200);
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "复制失败");
    }
  }

  function clampInputHeight(nextHeight: number) {
    return Math.max(inputMinHeight, Math.min(inputMaxHeight, nextHeight));
  }

  function stopInputResize() {
    inputResizeCleanupRef.current?.();
    inputResizeCleanupRef.current = null;
    inputResizeRef.current = null;
    setIsResizingInput(false);
    document.body.classList.remove("is-resizing-chat-input");
  }

  function startInputResize(event: MouseEvent<HTMLDivElement>) {
    event.preventDefault();
    inputResizeCleanupRef.current?.();
    inputResizeRef.current = {
      startY: event.clientY,
      startHeight: inputHeight
    };
    setIsResizingInput(true);
    document.body.classList.add("is-resizing-chat-input");

    const handleMove = (moveEvent: globalThis.MouseEvent) => {
      if (!inputResizeRef.current) return;
      moveEvent.preventDefault();
      const dragDistance = inputResizeRef.current.startY - moveEvent.clientY;
      setInputHeight(clampInputHeight(inputResizeRef.current.startHeight + dragDistance));
    };
    const handleUp = () => stopInputResize();

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    inputResizeCleanupRef.current = () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }

  async function loadSession(nextSessionId: string) {
    setLoadingSession(true);
    setError("");
    try {
      const detail = await api.getChatSession(nextSessionId);
      setMessages(detail.messages);
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "对话加载失败");
      setMessages([]);
    } finally {
      setLoadingSession(false);
    }
  }

  useEffect(() => {
    applySessionId(sessionId ?? null);
    if (!sessionId) {
      setMessages([]);
    }
  }, [sessionId]);

  useEffect(() => {
    if (!activeSessionId) return;
    void loadSession(activeSessionId);
  }, [activeSessionId]);

  useEffect(
    () => () => {
      inputResizeCleanupRef.current?.();
      inputResizeCleanupRef.current = null;
      inputResizeRef.current = null;
      document.body.classList.remove("is-resizing-chat-input");
    },
    []
  );

  useEffect(() => {
    if (!isReportMode || !reportId) return;
    let cancelled = false;

    async function loadReportSession() {
      try {
        const sessions = await api.listChatSessions({ report_id: reportId ?? undefined });
        if (cancelled) return;
        const nextId = sessions[0]?.id ?? null;
        applySessionId(nextId);
        if (!nextId) setMessages([]);
      } catch (exc) {
        if (!cancelled) {
          setError(exc instanceof Error ? exc.message : "关联对话加载失败");
        }
      }
    }

    void loadReportSession();

    return () => {
      cancelled = true;
    };
  }, [isReportMode, reportId]);

  async function sendMessage(rawMessage: string, options: { clearInput?: boolean } = {}) {
    const message = rawMessage.trim();
    if (!message || loading || (isReportMode && !reportId)) return;

    setError("");
    setLoading(true);
    if (options.clearInput ?? true) setInput("");
    setMessages((previous) => [...previous, { role: "user", content: message }, { role: "assistant", content: "" }]);

    try {
      await streamPost(
        "/api/chat/stream",
        {
          message,
          session_id: activeSessionId,
          report_id: isReportMode ? reportId : undefined,
          context_type: isReportMode ? "report" : "general",
          code_context: isReportMode ? codeContext : "",
          report_context: isReportMode ? reportContext : "",
          model
        },
        {
          onDelta: (text) => {
            setMessages((previous) => {
              const next = [...previous];
              const last = next[next.length - 1];
              next[next.length - 1] = { ...last, content: last.content + text };
              return next;
            });
          },
          onDone: (data) => {
            const nextSessionId = String(data.session_id ?? activeSessionId ?? "");
            if (nextSessionId) {
              applySessionId(nextSessionId);
              onSessionSaved?.(nextSessionId);
            }
            setLoading(false);
          },
          onError: (messageText) => {
            setError(messageText);
            setLoading(false);
          }
        }
      );
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "发送失败");
      setLoading(false);
    }
  }

  async function send() {
    await sendMessage(input, { clearInput: true });
  }

  async function regenerateFromAnswer(answerIndex: number) {
    const previousUserMessage = messages
      .slice(0, answerIndex)
      .reverse()
      .find((message) => message.role === "user");

    if (!previousUserMessage) {
      setError("没有找到这条回答对应的问题，无法重答。");
      return;
    }

    await sendMessage(previousUserMessage.content, { clearInput: false });
  }

  async function clearLocalConversation() {
    if (!activeSessionId) {
      setMessages([]);
      return;
    }
    await api.deleteChatSession(activeSessionId);
    applySessionId(null);
    setMessages([]);
    onSessionSaved?.("");
  }

  return (
    <section
      className={[
        "chat-panel",
        compact ? "chat-panel-compact" : "",
        liftOnInputResize ? "chat-panel-input-lift" : "",
        className
      ].filter(Boolean).join(" ")}
      style={chatPanelStyle}
    >
      <div className="chat-panel-header">
        <div className="flex min-w-0 items-center gap-2">
          <div className="chat-panel-icon">
            <Bot size={15} />
          </div>
          <div className="min-w-0">
            <h3>{panelTitle}</h3>
            <p>{helperText}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {!compact ? (
            <SelectField
              ariaLabel="选择聊天模型"
              className="select-field-compact max-w-[150px]"
              value={model}
              onChange={setModel}
              options={Object.keys(models).map((item) => ({ label: item, value: item }))}
            />
          ) : null}
          <button className="icon-button h-8 w-8" onClick={clearLocalConversation} title="清空当前对话" type="button">
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {shouldRenderMessages ? (
        <div className="chat-panel-messages">
          {loadingSession ? (
            <div className="empty-state gap-2">
              <Loader2 className="animate-spin text-teal" size={16} />
              加载对话中
            </div>
          ) : messages.length ? (
            <div className="space-y-3">
              {messages.map((message, index) => (
                <div key={`${message.created_at ?? index}-${message.role}`} className={message.role === "user" ? "flex justify-end" : "flex justify-start"}>
                  {message.role === "assistant" ? (
                    <div className="chat-assistant-message">
                      <div className="chat-bubble chat-bubble-assistant">
                        {message.content ? <MarkdownDocument content={message.content} className="chat-markdown-document" /> : loading ? "..." : ""}
                      </div>
                      {message.content ? (
                        <div className="chat-message-actions">
                          <button
                            className="chat-message-action-button"
                            onClick={() => void copyAssistantReply(message.content, buildMessageKey(message, index))}
                            type="button"
                          >
                            {copiedMessageKey === buildMessageKey(message, index) ? <Check size={13} /> : <Copy size={13} />}
                            {copiedMessageKey === buildMessageKey(message, index) ? "已复制" : "复制"}
                          </button>
                          <button
                            className="chat-message-action-button"
                            disabled={loading || (isReportMode && !reportId)}
                            onClick={() => void regenerateFromAnswer(index)}
                            type="button"
                          >
                            <RotateCcw size={13} />
                            重答
                          </button>
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <div className="chat-bubble chat-bubble-user">{message.content}</div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state flex-col gap-2 text-center">
              <MessageSquarePlus className="text-pine" size={22} />
              <span>{panelEmptyText}</span>
            </div>
          )}
        </div>
      ) : null}

      {error ? <div className="chat-panel-error">{error}</div> : null}

      <div
        className={["chat-panel-input-row", isResizingInput ? "chat-panel-input-row-resizing" : ""].filter(Boolean).join(" ")}
      >
        <div
          aria-label="拖拽调整输入框高度"
          className="chat-input-resize-handle"
          onDoubleClick={() => setInputHeight(compact ? 48 : 56)}
          onMouseDown={startInputResize}
          role="separator"
          title="拖拽调整输入框高度"
        />
        <textarea
          className="control-field chat-panel-input"
          disabled={loading || (isReportMode && !reportId)}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void send();
            }
          }}
          placeholder={isReportMode ? "围绕这份报告继续追问" : "随便聊点什么"}
          value={input}
        />
        <button className="btn btn-primary chat-panel-send" disabled={!canSend} onClick={send} type="button">
          <Send size={15} />
          <span>发送</span>
        </button>
      </div>
    </section>
  );
}
