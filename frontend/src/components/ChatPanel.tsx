import { Bot, Check, Copy, Loader2, MessageSquarePlus, RotateCcw, Send, Sparkles, Trash2, X } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import type { CSSProperties, FocusEvent, MouseEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api";
import { streamPost } from "../lib/stream";
import { MarkdownDocument } from "./MarkdownDocument";
import { SelectField } from "./SelectField";
import type { AgentContextMode, AgentPlan, ChatMessage, SettingsResponse } from "../types";

type ChatPanelMode = "general" | "report" | "agent";

type ConversationTurn = {
  turnNumber: number;
  messageIndex: number;
  preview: string;
};

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
  selectedFilePaths?: string[];
  contextMode?: AgentContextMode;
  onSessionIdChange?: (sessionId: string | null) => void;
  onSessionSaved?: (sessionId: string) => void;
  onRemoveSelectedFile?: (path: string) => void;
  onClearSelectedFiles?: () => void;
  onContextModeChange?: (mode: AgentContextMode) => void;
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
  selectedFilePaths = [],
  contextMode = "manual",
  onSessionIdChange,
  onSessionSaved,
  onRemoveSelectedFile,
  onClearSelectedFiles,
  onContextModeChange
}: ChatPanelProps) {
  const [activeSessionId, setActiveSessionId] = useState<string | null>(sessionId ?? null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [agentPlans, setAgentPlans] = useState<AgentPlan[]>([]);
  const [input, setInput] = useState("");
  const [model, setModel] = useState(settings?.default_model_label ?? "DeepSeek-V4-Flash");
  const [loading, setLoading] = useState(false);
  const [loadingSession, setLoadingSession] = useState(false);
  const [error, setError] = useState("");
  const [copiedMessageKey, setCopiedMessageKey] = useState<string | null>(null);
  const [confirmingPlanId, setConfirmingPlanId] = useState<string | null>(null);
  const [inputHeight, setInputHeight] = useState(compact ? 48 : 56);
  const [isResizingInput, setIsResizingInput] = useState(false);
  const [agentAction, setAgentAction] = useState<"chat" | "plan">("chat");
  const [activeTurnMessageIndex, setActiveTurnMessageIndex] = useState<number | null>(null);
  const messagesScrollRef = useRef<HTMLDivElement | null>(null);
  const turnNodeRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const sessionSnapshotRef = useRef("");
  const inputResizeRef = useRef<{ startY: number; startHeight: number } | null>(null);
  const inputResizeCleanupRef = useRef<(() => void) | null>(null);

  const models = settings?.models ?? { "DeepSeek-V4-Flash": "deepseek-v4-flash" };
  const isReportMode = mode === "report";
  const isAgentMode = mode === "agent";
  const canSend = !loading && Boolean(input.trim()) && (!isReportMode || Boolean(reportId));
  const panelTitle = title ?? (isReportMode ? "结合报告继续问 AI" : isAgentMode ? "Agent 对话" : "AI 对话");
  const reportPromptHint = "围绕当前报告提问，回复会随报告一起保存";
  const panelEmptyText = emptyText ?? (isReportMode ? "报告保存完成后即可开始上下文对话" : isAgentMode ? "描述你希望 Agent 修改、创建或检查的文件" : "开始一个新的聊天");
  const inputBaseHeight = compact ? 48 : 56;
  const inputMinHeight = compact ? 44 : 48;
  const inputMaxHeight = compact ? 180 : 280;
  const inputOffset = Math.max(0, inputHeight - inputBaseHeight);
  const chatPanelStyle = {
    "--chat-input-height": `${inputHeight}px`,
    "--chat-input-offset": liftOnInputResize ? `${inputOffset}px` : "0px"
  } as CSSProperties;
  const shouldRenderMessages = loadingSession || messages.length > 0 || !isReportMode || !reportId;
  const conversationTurns = useMemo<ConversationTurn[]>(() => {
    return messages.reduce<ConversationTurn[]>((turns, message, index) => {
      if (message.role !== "user" || !message.content.trim()) return turns;
      turns.push({
        turnNumber: turns.length + 1,
        messageIndex: index,
        preview: buildTurnPreview(message.content)
      });
      return turns;
    }, []);
  }, [isReportMode, messages]);

  const helperText = useMemo(() => {
    if (isReportMode && !reportId) return "报告保存完成后即可开始上下文对话";
    if (isReportMode) return `已携带当前代码与报告上下文 · ${reportPromptHint}`;
    if (isAgentMode && agentAction === "plan") return "修改任务会同步到 VS Code 插件，由插件读取项目并确认应用";
    if (isAgentMode) return "Agent 讨论模式，可先分析项目、定位问题、梳理修改思路";
    return "普通聊天模式，不自动携带当前代码或报告";
  }, [agentAction, isAgentMode, isReportMode, reportId]);

  useEffect(() => {
    if (activeTurnMessageIndex === null) return;
    if (!conversationTurns.some((turn) => turn.messageIndex === activeTurnMessageIndex)) {
      setActiveTurnMessageIndex(null);
    }
  }, [activeTurnMessageIndex, conversationTurns]);

  function applySessionId(nextSessionId: string | null) {
    setActiveSessionId(nextSessionId);
    onSessionIdChange?.(nextSessionId);
  }

  function jumpToConversationTurn(messageIndex: number) {
    const target = turnNodeRefs.current[messageIndex];
    if (!target) return;
    setActiveTurnMessageIndex(messageIndex);
    target.scrollIntoView({ behavior: "smooth", block: "center" });
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

  async function loadSession(nextSessionId: string, options: { silent?: boolean } = {}) {
    const silent = options.silent ?? false;
    const scrollPanel = messagesScrollRef.current;
    const previousScrollTop = scrollPanel?.scrollTop ?? 0;
    const wasNearBottom = scrollPanel ? isNearBottom(scrollPanel) : true;

    if (!silent) {
      setLoadingSession(true);
      setError("");
    }
    try {
      const detail = await api.getChatSession(nextSessionId);
      const nextMessages = detail.messages;
      const nextPlans = detail.agent_plans ?? [];
      const nextSnapshot = buildSessionSnapshot(nextMessages, nextPlans);

      if (nextSnapshot !== sessionSnapshotRef.current) {
        sessionSnapshotRef.current = nextSnapshot;
        setMessages(nextMessages);
        setAgentPlans(nextPlans);

        if (silent) {
          window.requestAnimationFrame(() => {
            window.requestAnimationFrame(() => {
              const nextPanel = messagesScrollRef.current;
              if (!nextPanel) return;
              nextPanel.scrollTop = wasNearBottom ? nextPanel.scrollHeight : previousScrollTop;
            });
          });
        }
      }
    } catch (exc) {
      if (!silent) {
        setError(exc instanceof Error ? exc.message : "对话加载失败");
        setMessages([]);
        sessionSnapshotRef.current = "";
      }
    } finally {
      if (!silent) setLoadingSession(false);
    }
  }

  useEffect(() => {
    applySessionId(sessionId ?? null);
    sessionSnapshotRef.current = "";
    if (!sessionId) {
      setMessages([]);
      setAgentPlans([]);
    }
  }, [sessionId]);

  useEffect(() => {
    if (!activeSessionId) return;
    void loadSession(activeSessionId);
  }, [activeSessionId]);

  useEffect(() => {
    if (!isAgentMode || !activeSessionId) return;
    const timer = window.setInterval(() => {
      if (!loading) void loadSession(activeSessionId, { silent: true });
    }, 3000);
    return () => window.clearInterval(timer);
  }, [activeSessionId, isAgentMode, loading]);

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
      if (isAgentMode) {
        if (agentAction === "chat") {
          await streamPost(
            "/api/agent/chat/stream",
            {
              message,
              session_id: activeSessionId,
              code_context: codeContext,
              report_context: reportContext || null,
              model,
              source: "web"
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
          return;
        }

        const plan = await api.agentPlan({
          instruction: message,
          session_id: activeSessionId,
          agent_action: "plan",
          defer_to_plugin: true,
          code_context: codeContext,
          report_context: reportContext || null,
          selected_file_paths: selectedFilePaths,
          context_mode: contextMode,
          language_code: "python",
          language_label: "Python",
          model,
          source: "web"
        });
        if (plan.session_id) applySessionId(plan.session_id);
        setAgentPlans((previous) => [...previous, plan]);
        if (plan.session_id) onSessionSaved?.(plan.session_id);
        setMessages((previous) => {
          const next = [...previous];
          const last = next[next.length - 1];
          if (last?.role === "assistant") {
            next[next.length - 1] = {
              ...last,
              content: `Agent 任务已保存。\n\n摘要：${plan.summary}\n状态：${plan.apply_result || "等待网页确认或插件执行。"}`
            };
          }
          return next;
        });
        setLoading(false);
        return;
      }

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
      setAgentPlans([]);
      return;
    }
    await api.deleteChatSession(activeSessionId);
    applySessionId(null);
    setMessages([]);
    setAgentPlans([]);
    onSessionSaved?.("");
  }

  async function confirmAgentPlan(plan: AgentPlan, action: "apply" | "reject") {
    const planId = plan.plan_id ?? plan.id;
    if (!planId) {
      setError("计划缺少 ID，无法提交确认。");
      return;
    }

    setConfirmingPlanId(planId);
    setError("");
    try {
      await api.confirmAgentPlan(planId, {
        action,
        message: action === "apply" ? "Web 用户确认应用 Agent 计划。" : "Web 用户拒绝应用 Agent 计划。"
      });
      if (activeSessionId) {
        await loadSession(activeSessionId, { silent: true });
        onSessionSaved?.(activeSessionId);
      }
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Agent 计划确认失败");
    } finally {
      setConfirmingPlanId(null);
    }
  }

  return (
    <section
      className={[
        "chat-panel",
        compact ? "chat-panel-compact" : "",
        `chat-panel-${mode}`,
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
          {isAgentMode ? (
            <div className="agent-web-action-toggle" aria-label="Agent 模式">
              <button
                className={agentAction === "chat" ? "agent-web-action-active" : ""}
                onClick={() => setAgentAction("chat")}
                type="button"
              >
                讨论
              </button>
              <button
                className={agentAction === "plan" ? "agent-web-action-active" : ""}
                onClick={() => setAgentAction("plan")}
                type="button"
              >
                交给插件修改
              </button>
            </div>
          ) : null}
          {!compact ? (
            <SelectField
              ariaLabel="选择聊天模型"
              className="select-field-compact chat-model-select"
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
        <div
          className={[
            "chat-panel-messages",
            conversationTurns.length ? "chat-panel-messages-with-turn-rail" : ""
          ].filter(Boolean).join(" ")}
          ref={messagesScrollRef}
        >
          {loadingSession ? (
            <div className="empty-state gap-2">
              <Loader2 className="animate-spin text-teal" size={16} />
              加载对话中
            </div>
          ) : messages.length || agentPlans.length ? (
            <div className="space-y-3">
              {agentPlans.length ? (
                <div className="agent-plan-card-list">
                  {agentPlans.map((plan) => (
                    <AgentPlanCard
                      key={plan.id ?? plan.plan_id ?? plan.summary}
                      plan={plan}
                      busy={confirmingPlanId === (plan.plan_id ?? plan.id)}
                      onConfirm={(action) => void confirmAgentPlan(plan, action)}
                    />
                  ))}
                </div>
              ) : null}
              {messages.map((message, index) => (
                <div
                  key={`${message.created_at ?? index}-${message.role}`}
                  className={[
                    message.role === "user" ? "flex justify-end" : "flex justify-start",
                    activeTurnMessageIndex === index ? "chat-turn-target-active" : ""
                  ].filter(Boolean).join(" ")}
                  ref={
                    message.role === "user"
                      ? (node) => {
                          if (node) {
                            turnNodeRefs.current[index] = node;
                          } else {
                            delete turnNodeRefs.current[index];
                          }
                        }
                      : undefined
                  }
                >
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

      {conversationTurns.length ? (
        <ConversationTurnRail
          activeMessageIndex={activeTurnMessageIndex}
          turns={conversationTurns}
          onSelect={jumpToConversationTurn}
        />
      ) : null}

      {error ? <div className="chat-panel-error">{error}</div> : null}

      {isAgentMode ? (
        <div className="agent-context-mode-strip">
          <span>上下文</span>
          <div className="agent-context-mode-options" role="tablist" aria-label="Agent 上下文来源">
            {(["manual", "ai_auto", "hybrid"] as AgentContextMode[]).map((modeOption) => (
              <button
                aria-selected={contextMode === modeOption}
                className={["agent-context-mode-option", contextMode === modeOption ? "agent-context-mode-option-active" : ""].filter(Boolean).join(" ")}
                key={modeOption}
                onClick={() => onContextModeChange?.(modeOption)}
                role="tab"
                type="button"
              >
                {contextModeLabel(modeOption)}
              </button>
            ))}
          </div>
          <em>{contextModeHint(contextMode, selectedFilePaths.length)}</em>
        </div>
      ) : null}

      {isAgentMode && selectedFilePaths.length ? (
        <div className="agent-context-file-strip">
          <span>{contextMode === "ai_auto" ? "参考文件" : contextMode === "hybrid" ? "种子文件" : "上下文文件"}</span>
          <div className="agent-context-file-chip-list">
            {selectedFilePaths.slice(0, 8).map((path) => (
              <button
                className="agent-context-file-chip"
                key={path}
                onClick={() => onRemoveSelectedFile?.(path)}
                title={path}
                type="button"
              >
                <strong>{fileNameFromPath(path)}</strong>
                <X size={12} />
              </button>
            ))}
            {selectedFilePaths.length > 8 ? <em>+{selectedFilePaths.length - 8}</em> : null}
          </div>
          <button className="agent-context-file-clear" onClick={onClearSelectedFiles} type="button">
            清空
          </button>
        </div>
      ) : null}

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
          placeholder={isReportMode ? "围绕这份报告继续追问" : isAgentMode ? (agentAction === "plan" ? "描述要交给 VS Code 插件修改或调试的任务..." : "询问项目结构、代码问题或调试思路...") : "随便聊点什么"}
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

function ConversationTurnRail({
  turns,
  activeMessageIndex,
  onSelect
}: {
  turns: ConversationTurn[];
  activeMessageIndex: number | null;
  onSelect: (messageIndex: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const prefersReducedMotion = useReducedMotion();
  const openTimerRef = useRef<number | null>(null);
  const closeTimerRef = useRef<number | null>(null);

  function clearTimers() {
    if (openTimerRef.current !== null) {
      window.clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }

  function openWithDelay() {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    if (open) return;
    if (openTimerRef.current !== null) return;
    openTimerRef.current = window.setTimeout(() => {
      openTimerRef.current = null;
      setOpen(true);
    }, 220);
  }

  function closeWithDelay() {
    if (openTimerRef.current !== null) {
      window.clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
    if (closeTimerRef.current !== null) return;
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      setOpen(false);
    }, 120);
  }

  function handleBlur(event: FocusEvent<HTMLDivElement>) {
    const nextTarget = event.relatedTarget instanceof Node ? event.relatedTarget : null;
    if (nextTarget && event.currentTarget.contains(nextTarget)) return;
    closeWithDelay();
  }

  function selectTurn(messageIndex: number) {
    clearTimers();
    onSelect(messageIndex);
    setOpen(false);
  }

  useEffect(() => clearTimers, []);

  const motionProps = prefersReducedMotion
    ? {
        initial: { opacity: 0 },
        animate: { opacity: 1 },
        exit: { opacity: 0 },
        transition: { duration: 0.12 }
      }
    : {
        initial: { opacity: 0, x: 8, scale: 0.98 },
        animate: { opacity: 1, x: 0, scale: 1 },
        exit: { opacity: 0, x: 6, scale: 0.98 },
        transition: { type: "spring" as const, stiffness: 420, damping: 34, mass: 0.7 }
      };

  return (
    <div
      className="conversation-turn-rail-shell"
      onBlur={handleBlur}
      onFocus={() => {
        clearTimers();
        setOpen(true);
      }}
      onMouseEnter={openWithDelay}
      onMouseLeave={closeWithDelay}
    >
      <div className="conversation-turn-rail" aria-label="报告追问轮次定位">
        {turns.map((turn) => (
          <button
            aria-label={`定位到第 ${turn.turnNumber} 轮对话`}
            className={[
              "conversation-turn-bar",
              activeMessageIndex === turn.messageIndex ? "conversation-turn-bar-active" : ""
            ].filter(Boolean).join(" ")}
            key={`${turn.messageIndex}-${turn.turnNumber}`}
            onClick={() => selectTurn(turn.messageIndex)}
            type="button"
          />
        ))}
      </div>
      <AnimatePresence>
        {open ? (
          <motion.div className="conversation-turn-popover" {...motionProps}>
            <div className="conversation-turn-popover-title">对话定位</div>
            <div className="conversation-turn-option-list">
              {turns.map((turn) => (
                <button
                  className={[
                    "conversation-turn-option",
                    activeMessageIndex === turn.messageIndex ? "conversation-turn-option-active" : ""
                  ].filter(Boolean).join(" ")}
                  key={`${turn.messageIndex}-${turn.preview}`}
                  onClick={() => selectTurn(turn.messageIndex)}
                  type="button"
                >
                  <span>第 {turn.turnNumber} 轮</span>
                  <strong>{turn.preview}</strong>
                </button>
              ))}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function fileNameFromPath(path: string) {
  return path.split(/[\\/]/).filter(Boolean).pop() || path;
}

function contextModeLabel(mode: AgentContextMode) {
  if (mode === "ai_auto") return "AI 自动选择";
  if (mode === "hybrid") return "手动 + AI 补充";
  return "手动选择";
}

function contextModeHint(mode: AgentContextMode, selectedCount: number) {
  if (mode === "ai_auto") return "无需勾选文件，插件会让 AI 从项目清单中选择。";
  if (mode === "hybrid") return selectedCount ? `保留 ${selectedCount} 个种子文件，再由 AI 补充。` : "可先勾核心文件，也可直接让 AI 补充。";
  return selectedCount ? `已选择 ${selectedCount} 个文件。` : "从当前项目树勾选文件作为上下文。";
}

function AgentPlanCard({
  plan,
  busy = false,
  onConfirm
}: {
  plan: AgentPlan;
  busy?: boolean;
  onConfirm?: (action: "apply" | "reject") => void;
}) {
  const status = plan.status ?? "pending";
  const statusText = status === "pending"
    ? "待插件处理"
    : status === "waiting_confirm"
      ? "等待网页确认"
      : status === "confirmed"
        ? "已确认，等待插件应用"
        : status === "applied"
          ? "已应用"
          : status === "failed"
            ? "失败"
            : status === "rejected"
              ? "已拒绝"
              : status;
  const canConfirm = status === "waiting_confirm" && plan.operations.length > 0 && onConfirm;

  return (
    <article className="agent-plan-card">
      <div className="agent-plan-card-head">
        <div>
          <div className="agent-plan-card-kicker"><Sparkles size={13} /> Agent Plan</div>
          <h4>{plan.summary}</h4>
        </div>
        <span className={`agent-plan-card-status agent-plan-card-status-${status}`}>{statusText}</span>
      </div>
      <p>
        {plan.source === "web"
          ? "来自网页端。插件会生成计划；网页确认后插件才会应用到 VS Code 工作区。"
          : "来自 VS Code 插件。"}
      </p>
      <div className="agent-plan-card-meta">
        <span>{contextModeLabel(plan.context_mode ?? "manual")}</span>
        {plan.selected_file_paths?.length ? <span>上下文 {plan.selected_file_paths.length}</span> : null}
        <span>操作 {plan.operations.length}</span>
        {plan.warnings.length ? <span>提醒 {plan.warnings.length}</span> : null}
      </div>
      {plan.selected_file_paths?.length ? (
        <div className="agent-plan-context-list">
          {plan.selected_file_paths.slice(0, 8).map((path) => (
            <span key={path} title={path}>{fileNameFromPath(path)}</span>
          ))}
          {plan.selected_file_paths.length > 8 ? <em>+{plan.selected_file_paths.length - 8}</em> : null}
        </div>
      ) : null}
      {plan.operations.length ? (
        <div className="agent-plan-operation-list">
          {plan.operations.slice(0, 6).map((operation, index) => (
            <div className="agent-plan-operation" key={`${operation.type}-${operation.path}-${index}`}>
              <span className="agent-plan-operation-type">{operation.type}</span>
              <span className="agent-plan-operation-path">{operation.path}</span>
              {operation.reason ? <span className="agent-plan-operation-reason">{operation.reason}</span> : null}
            </div>
          ))}
          {plan.operations.length > 6 ? (
            <div className="agent-plan-operation-more">还有 {plan.operations.length - 6} 个文件操作</div>
          ) : null}
        </div>
      ) : null}
      {plan.apply_result ? <p className="agent-plan-card-result">{plan.apply_result}</p> : null}
      {canConfirm ? (
        <div className="agent-plan-card-actions">
          <button className="btn btn-primary h-8" disabled={busy} onClick={() => onConfirm("apply")} type="button">
            {busy ? <Loader2 className="animate-spin" size={14} /> : <Check size={14} />}
            应用修改
          </button>
          <button className="btn btn-secondary h-8" disabled={busy} onClick={() => onConfirm("reject")} type="button">
            拒绝
          </button>
        </div>
      ) : null}
    </article>
  );
}

function isNearBottom(element: HTMLElement, threshold = 96) {
  return element.scrollHeight - element.scrollTop - element.clientHeight <= threshold;
}

function buildTurnPreview(content: string) {
  const compact = content.replace(/\s+/g, " ").trim();
  return compact.length > 58 ? `${compact.slice(0, 58)}...` : compact;
}

function buildSessionSnapshot(messages: ChatMessage[], plans: AgentPlan[]) {
  return JSON.stringify({
    messages: messages.map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content,
      created_at: message.created_at
    })),
    plans: plans.map((plan) => ({
      id: plan.id,
      plan_id: plan.plan_id,
      status: plan.status,
      summary: plan.summary,
      apply_result: plan.apply_result,
      operations: plan.operations.length,
      selected_file_paths: plan.selected_file_paths?.join("|") ?? "",
      context_mode: plan.context_mode ?? "manual",
      updated_at: plan.updated_at
    }))
  });
}
