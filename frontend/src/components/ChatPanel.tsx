import { Bot, Check, Copy, Loader2, MessageSquarePlus, RotateCcw, Send, Sparkles, Trash2, X } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import type { CSSProperties, FocusEvent, MouseEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api";
import { streamPost } from "../lib/stream";
import { MarkdownDocument } from "./MarkdownDocument";
import { SelectField } from "./SelectField";
import type { AgentContextMode, AgentPlan, ChatMessage, SettingsResponse, WorkspaceSnapshot } from "../types";

type ChatPanelMode = "general" | "report" | "agent";
type AgentIntent = "auto" | "chat" | "plan";

type ConversationTurn = {
  turnNumber: number;
  messageIndex: number;
  preview: string;
};

type AgentPlanAnchorMap = Record<string, number>;

type AgentPlanProgressEvent = {
  phase: string;
  message: string;
  detail?: string;
  sequence?: number;
  selected_file_paths?: string[];
};

const CHAT_AUTO_FOLLOW_THRESHOLD = 80;
const WORKSPACE_HEARTBEAT_DELAYED_SECONDS = 20;
const WORKSPACE_HEARTBEAT_STALE_SECONDS = 60;

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
  workspace?: WorkspaceSnapshot | null;
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
  workspace = null,
  onSessionIdChange,
  onSessionSaved,
  onRemoveSelectedFile,
  onClearSelectedFiles,
  onContextModeChange
}: ChatPanelProps) {
  const [activeSessionId, setActiveSessionId] = useState<string | null>(sessionId ?? null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [agentPlans, setAgentPlans] = useState<AgentPlan[]>([]);
  const [agentPlanAnchors, setAgentPlanAnchors] = useState<AgentPlanAnchorMap>({});
  const [input, setInput] = useState("");
  const [model, setModel] = useState(settings?.default_model_label ?? "DeepSeek-V4-Flash");
  const [loading, setLoading] = useState(false);
  const [loadingSession, setLoadingSession] = useState(false);
  const [error, setError] = useState("");
  const [copiedMessageKey, setCopiedMessageKey] = useState<string | null>(null);
  const [confirmingPlanId, setConfirmingPlanId] = useState<string | null>(null);
  const [inputHeight, setInputHeight] = useState(compact ? 48 : 56);
  const [isResizingInput, setIsResizingInput] = useState(false);
  const [agentIntent, setAgentIntent] = useState<AgentIntent>("auto");
  const [activeTurnMessageIndex, setActiveTurnMessageIndex] = useState<number | null>(null);
  const [agentStatusMessage, setAgentStatusMessage] = useState("");
  const [agentExecutionStatusMessage, setAgentExecutionStatusMessage] = useState("");
  const [agentPlanRuntimeMessages, setAgentPlanRuntimeMessages] = useState<Record<string, string>>({});
  const [agentPlanProgressEvents, setAgentPlanProgressEvents] = useState<Record<string, AgentPlanProgressEvent[]>>({});
  const messagesScrollRef = useRef<HTMLDivElement | null>(null);
  const turnNodeRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const sessionSnapshotRef = useRef("");
  const autoFollowBottomRef = useRef(true);
  const streamingAssistantIndexRef = useRef<number | null>(null);
  const inputResizeRef = useRef<{ startY: number; startHeight: number } | null>(null);
  const inputResizeCleanupRef = useRef<(() => void) | null>(null);

  const models = settings?.models ?? { "DeepSeek-V4-Flash": "deepseek-v4-flash" };
  const isReportMode = mode === "report";
  const isAgentMode = mode === "agent";
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
  const plansByMessageIndex = useMemo(
    () => groupAgentPlansByMessageIndex(messages, agentPlans, agentPlanAnchors),
    [agentPlanAnchors, agentPlans, messages]
  );
  const activeConfirmablePlan = useMemo(() => findActiveConfirmableAgentPlan(agentPlans), [agentPlans]);
  const isPlanConfirmMode = isAgentMode && Boolean(activeConfirmablePlan) && !loading;
  const canSend = isPlanConfirmMode
    ? !loading && !confirmingPlanId
    : !loading && Boolean(input.trim()) && (!isReportMode || Boolean(reportId));
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
  const agentStage = useMemo(() => buildAgentStageState(workspace, contextMode, selectedFilePaths.length, agentPlans), [agentPlans, contextMode, selectedFilePaths.length, workspace]);

  const helperText = useMemo(() => {
    if (isReportMode && !reportId) return "报告保存完成后即可开始上下文对话";
    if (isReportMode) return `已携带当前代码与报告上下文 · ${reportPromptHint}`;
    if (isAgentMode && agentIntent === "plan") return "将生成可确认的插件修改计划，确认前不会应用文件改动。";
    if (isAgentMode && agentIntent === "chat") return "仅讨论项目结构、代码问题和修改思路，不自动生成计划。";
    if (isAgentMode) return "Agent 讨论模式，可先分析项目、定位问题、梳理修改思路";
    return "普通聊天模式，不自动携带当前代码或报告";
  }, [agentIntent, isAgentMode, isReportMode, reportId]);

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

  function followMessagesBottom(force = false) {
    const panel = messagesScrollRef.current;
    if (!panel) return;
    if (!force && !autoFollowBottomRef.current) return;

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const nextPanel = messagesScrollRef.current;
        if (!nextPanel) return;
        if (!force && !autoFollowBottomRef.current) return;
        nextPanel.scrollTop = nextPanel.scrollHeight;
      });
    });
  }

  function jumpToConversationTurn(messageIndex: number) {
    const target = turnNodeRefs.current[messageIndex];
    if (!target) return;
    autoFollowBottomRef.current = false;
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
    const wasNearBottom = scrollPanel ? isNearBottom(scrollPanel, CHAT_AUTO_FOLLOW_THRESHOLD) : true;
    if (!silent) autoFollowBottomRef.current = true;

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
        setAgentPlanAnchors((previous) => ({ ...buildAgentPlanAnchors(nextMessages, nextPlans), ...previous }));

        if (silent) {
          autoFollowBottomRef.current = wasNearBottom;
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
    if (!shouldRenderMessages) return;
    const panel = messagesScrollRef.current;
    if (!panel) return;
    const scrollPanel = panel;

    function updateAutoFollow() {
      autoFollowBottomRef.current = isNearBottom(scrollPanel, CHAT_AUTO_FOLLOW_THRESHOLD);
    }

    updateAutoFollow();
    scrollPanel.addEventListener("scroll", updateAutoFollow, { passive: true });
    return () => scrollPanel.removeEventListener("scroll", updateAutoFollow);
  }, [activeSessionId, mode, shouldRenderMessages]);

  useEffect(() => {
    if (!shouldRenderMessages || loadingSession) return;
    followMessagesBottom();
  }, [agentPlans, inputHeight, loadingSession, messages, shouldRenderMessages]);

  useEffect(() => {
    applySessionId(sessionId ?? null);
    sessionSnapshotRef.current = "";
    autoFollowBottomRef.current = true;
    if (!sessionId) {
      setMessages([]);
      setAgentPlans([]);
      setAgentPlanAnchors({});
      setAgentPlanRuntimeMessages({});
      setAgentPlanProgressEvents({});
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

  async function sendMessage(rawMessage: string, options: { clearInput?: boolean; planId?: string | null } = {}) {
    const message = rawMessage.trim();
    if (!message || loading || (isReportMode && !reportId)) return;
    if (isAgentMode) {
      const workspaceState = getWorkspaceConnectionState(workspace);
      if (!workspace?.workspace_root || workspaceState === "waiting" || workspaceState === "blocked") {
        setError("请先打开 CodeLens Pro VS Code 插件，并确认当前项目已同步到 Web Agent。");
        return;
      }
    }

    setError("");
    setAgentStatusMessage("");
    setAgentExecutionStatusMessage("");
    setLoading(true);
    if (options.clearInput ?? true) setInput("");
    autoFollowBottomRef.current = true;
    setActiveTurnMessageIndex(null);
    setMessages((previous) => {
      const assistantIndex = previous.length + 1;
      streamingAssistantIndexRef.current = assistantIndex;
      return [...previous, { role: "user", content: message }, { role: "assistant", content: "" }];
    });

    try {
      if (isAgentMode) {
        if (true) {
          await streamPost(
            "/api/agent/message/stream",
            {
              message,
              session_id: activeSessionId,
              intent: options.planId ? "plan" : agentIntent,
              code_context: codeContext,
              report_context: reportContext || null,
              selected_file_paths: selectedFilePaths,
              context_mode: contextMode,
              model,
              source: "web",
              workspace_root: workspace?.workspace_root ?? null,
              plan_id: options.planId ?? null
            },
            {
              onStatus: (data) => {
                if (data.phase === "agent_context") {
                  setAgentStatusMessage(String(data.message || "插件正在读取上下文文件..."));
                  followMessagesBottom();
                } else if (String(data.phase || "").startsWith("agent_plan")) {
                  const planId = String(data.plan_id || "");
                  const messageText = String(data.message || "Agent 正在处理计划任务...");
                  setAgentStatusMessage(messageText);
                  if (planId) {
                    const progressEvent: AgentPlanProgressEvent = {
                      phase: String(data.phase || "agent_plan_progress"),
                      message: messageText,
                      detail: String(data.detail || ""),
                      sequence: Number(data.sequence || 0),
                      selected_file_paths: Array.isArray(data.selected_file_paths)
                        ? data.selected_file_paths.map(String)
                        : []
                    };
                    setAgentPlanRuntimeMessages((previous) => ({ ...previous, [planId]: messageText }));
                    setAgentPlanProgressEvents((previous) => ({
                      ...previous,
                      [planId]: appendAgentPlanProgressEvent(previous[planId] ?? [], progressEvent)
                    }));
                  }
                  followMessagesBottom();
                }
              },
              onPlan: (data) => {
                const plan = data.plan as AgentPlan | undefined;
                if (!plan) return;
                const planId = getAgentPlanId(plan);
                const anchorIndex = streamingAssistantIndexRef.current;
                setAgentPlans((previous) => upsertAgentPlan(previous, plan));
                if (planId && anchorIndex !== null) {
                  setAgentPlanAnchors((previous) => ({ ...previous, [planId]: anchorIndex }));
                }
                if (planId && (plan.status === "waiting_confirm" || plan.status === "failed" || plan.status === "rejected")) {
                  setAgentPlanProgressEvents((previous) => ({
                    ...previous,
                    [planId]: appendAgentPlanProgressEvent(previous[planId] ?? [], {
                      phase: "agent_plan_ready",
                      message: plan.status === "waiting_confirm" ? "计划已生成，等待网页确认执行。" : plan.apply_result || "Agent 计划状态已更新。",
                    })
                  }));
                }
                setMessages((previous) => {
                  const next = [...previous];
                  const targetIndex = anchorIndex ?? next.length - 1;
                  const last = next[targetIndex];
                  if (last?.role === "assistant") {
                    next[targetIndex] = {
                      ...last,
                      content: agentPlanInlineMessage(plan)
                    };
                  }
                  return next;
                });
              },
              onDelta: (text) => {
                setAgentStatusMessage("");
                setMessages((previous) => {
                  const next = [...previous];
                  const last = next[next.length - 1];
                  next[next.length - 1] = { ...last, content: last.content + text };
                  return next;
                });
              },
              onDone: (data) => {
                setAgentStatusMessage("");
                const nextSessionId = String(data.session_id ?? activeSessionId ?? "");
                if (nextSessionId) {
                  applySessionId(nextSessionId);
                  onSessionSaved?.(nextSessionId);
                }
                streamingAssistantIndexRef.current = null;
                setLoading(false);
              },
              onError: (messageText) => {
                setAgentStatusMessage("");
                setError(agentFriendlyError(messageText, true));
                streamingAssistantIndexRef.current = null;
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
        const nextPlanSessionId = plan.session_id ?? null;
        if (nextPlanSessionId) applySessionId(nextPlanSessionId);
        setAgentPlans((previous) => [...previous, plan]);
        if (nextPlanSessionId) onSessionSaved?.(String(nextPlanSessionId));
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
            setError(agentFriendlyError(messageText, isAgentMode));
            setLoading(false);
          }
        }
      );
    } catch (exc) {
      setError(agentFriendlyError(exc instanceof Error ? exc.message : "发送失败", isAgentMode));
      setLoading(false);
    }
  }

  async function send() {
    if (isPlanConfirmMode && activeConfirmablePlan) {
      const adjustment = input.trim();
      if (adjustment) {
        await sendMessage(adjustment, { clearInput: true, planId: getAgentPlanId(activeConfirmablePlan) });
      } else {
        await confirmAgentPlan(activeConfirmablePlan, "apply");
      }
      return;
    }
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
      setAgentPlanAnchors({});
      setAgentPlanRuntimeMessages({});
      setAgentPlanProgressEvents({});
      return;
    }
    await api.deleteChatSession(activeSessionId);
    applySessionId(null);
    setMessages([]);
    setAgentPlans([]);
    setAgentPlanAnchors({});
    setAgentPlanRuntimeMessages({});
    setAgentPlanProgressEvents({});
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
    setAgentExecutionStatusMessage("");
    let streamFailed = false;
    try {
      await streamPost(
        `/api/agent/plans/${planId}/confirm/stream`,
        {
          action,
          message: action === "apply" ? "Web 用户确认应用 Agent 计划。" : "Web 用户拒绝应用 Agent 计划。"
        },
        {
          onDelta: () => undefined,
          onStatus: (data) => {
            const messageText = String(data.message || "");
            const phase = String(data.phase || "agent_plan_execution");
            setAgentExecutionStatusMessage(messageText);
            setAgentPlanRuntimeMessages((previous) => ({ ...previous, [planId]: messageText }));
            if (messageText) {
              setAgentPlanProgressEvents((previous) => ({
                ...previous,
                [planId]: appendAgentPlanProgressEvent(previous[planId] ?? [], {
                  phase,
                  message: messageText,
                  sequence: Number(data.sequence || 0),
                })
              }));
            }
            followMessagesBottom();
          },
          onPlan: (data) => {
            const nextPlan = data.plan as AgentPlan | undefined;
            if (!nextPlan) return;
            setAgentPlans((previous) => upsertAgentPlan(previous, nextPlan));
          },
          onDone: () => {
            setAgentExecutionStatusMessage("");
          },
          onError: (messageText) => {
            streamFailed = true;
            setError(agentFriendlyError(messageText, true));
          }
        }
      );
      if (!streamFailed && activeSessionId) {
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
        <div className="agent-chat-title-block flex min-w-0 items-center gap-2">
          <div className="chat-panel-icon">
            <Bot size={15} />
          </div>
          <div className="min-w-0">
            <h3>{panelTitle}</h3>
            <p>{helperText}</p>
          </div>
        </div>
        {isAgentMode ? (
          <AgentHeaderCompactControls
            contextMode={contextMode}
            onContextModeChange={onContextModeChange}
            selectedFilePaths={selectedFilePaths}
            stage={agentStage}
            workspace={workspace}
          />
        ) : null}
        <div className="agent-chat-actions flex shrink-0 items-center gap-2">
          {isAgentMode ? (
            <div className="agent-web-action-toggle" aria-label="Agent 模式">
              <button
                className={agentIntent === "auto" ? "agent-web-action-active" : ""}
                onClick={() => setAgentIntent("auto")}
                type="button"
              >
                讨论
              </button>
              <button
                className={agentIntent === "chat" ? "agent-web-action-active" : ""}
                onClick={() => setAgentIntent("chat")}
                type="button"
              >
                仅讨论
              </button>
              <button
                className={agentIntent === "plan" ? "agent-web-action-active" : ""}
                onClick={() => setAgentIntent("plan")}
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
                        {message.content ? (
                          <MarkdownDocument content={message.content} className="chat-markdown-document" />
                        ) : loading ? (
                          agentStatusMessage || "..."
                        ) : ""}
                      </div>
                      {plansByMessageIndex[index]?.length ? (
                        <div className="agent-plan-card-list agent-plan-card-list-inline">
                          {plansByMessageIndex[index].map((plan) => {
                            const planId = getAgentPlanId(plan);
                            return (
                              <AgentPlanCard
                                key={planId ?? plan.summary}
                                plan={plan}
                                progressEvents={planId ? agentPlanProgressEvents[planId] ?? [] : []}
                                busy={confirmingPlanId === planId}
                                runtimeMessage={planId ? agentPlanRuntimeMessages[planId] : ""}
                                onConfirm={(action) => void confirmAgentPlan(plan, action)}
                              />
                            );
                          })}
                        </div>
                      ) : null}
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
              {plansByMessageIndex[-1]?.length ? (
                <div className="agent-plan-card-list agent-plan-card-list-inline agent-plan-card-list-orphan">
                  {plansByMessageIndex[-1].map((plan) => {
                    const planId = getAgentPlanId(plan);
                    return (
                      <AgentPlanCard
                        key={planId ?? plan.summary}
                        plan={plan}
                        progressEvents={planId ? agentPlanProgressEvents[planId] ?? [] : []}
                        busy={confirmingPlanId === planId}
                        runtimeMessage={planId ? agentPlanRuntimeMessages[planId] : ""}
                        onConfirm={(action) => void confirmAgentPlan(plan, action)}
                      />
                    );
                  })}
                </div>
              ) : null}
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

      {isAgentMode && selectedFilePaths.length ? (
        <AgentSelectedFileBar
          contextMode={contextMode}
          onClearSelectedFiles={onClearSelectedFiles}
          onRemoveSelectedFile={onRemoveSelectedFile}
          selectedFilePaths={selectedFilePaths}
        />
      ) : null}

      {isPlanConfirmMode && activeConfirmablePlan ? (
        <div className="agent-plan-confirm-strip">
          <div>
            <strong>计划等待确认</strong>
            <span>{activeConfirmablePlan.summary}</span>
          </div>
          {agentExecutionStatusMessage ? <em>{agentExecutionStatusMessage}</em> : null}
        </div>
      ) : null}

      <div
        className={[
          "chat-panel-input-row",
          isPlanConfirmMode ? "chat-panel-input-row-plan-confirm" : "",
          isResizingInput ? "chat-panel-input-row-resizing" : ""
        ].filter(Boolean).join(" ")}
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
          placeholder={inputPlaceholder(isReportMode, isAgentMode, agentIntent, isPlanConfirmMode)}
          value={input}
        />
        <button className="btn btn-primary chat-panel-send" disabled={!canSend} onClick={send} type="button">
          {confirmingPlanId ? <Loader2 className="animate-spin" size={15} /> : isPlanConfirmMode && !input.trim() ? <Check size={15} /> : <Send size={15} />}
          <span>{isPlanConfirmMode && !input.trim() ? "确认执行计划" : isPlanConfirmMode ? "调整计划" : "发送"}</span>
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

function getAgentPlanId(plan: AgentPlan) {
  return plan.plan_id ?? plan.id ?? null;
}

function upsertAgentPlan(plans: AgentPlan[], plan: AgentPlan) {
  const planId = getAgentPlanId(plan);
  if (!planId) return [...plans, plan];
  const existingIndex = plans.findIndex((item) => getAgentPlanId(item) === planId);
  if (existingIndex < 0) return [...plans, plan];
  const next = [...plans];
  next[existingIndex] = { ...next[existingIndex], ...plan };
  return next;
}

function appendAgentPlanProgressEvent(events: AgentPlanProgressEvent[], event: AgentPlanProgressEvent) {
  const exists = events.some((item) => {
    if (event.sequence && item.sequence) return item.sequence === event.sequence;
    return item.phase === event.phase && item.message === event.message;
  });
  if (exists) return events;
  return [...events, event].slice(-8);
}

function findActiveConfirmableAgentPlan(plans: AgentPlan[]) {
  return [...plans]
    .reverse()
    .find((plan) => plan.status === "waiting_confirm" && plan.operations.length > 0) ?? null;
}

function groupAgentPlansByMessageIndex(
  messages: ChatMessage[],
  plans: AgentPlan[],
  anchors: AgentPlanAnchorMap
) {
  const grouped: Record<number, AgentPlan[]> = {};
  for (const plan of plans) {
    const planId = getAgentPlanId(plan);
    const anchoredIndex = planId ? anchors[planId] : undefined;
    const messageIndex = typeof anchoredIndex === "number"
      ? anchoredIndex
      : inferAgentPlanMessageIndex(messages, plan);
    if (!grouped[messageIndex]) grouped[messageIndex] = [];
    grouped[messageIndex].push(plan);
  }
  return grouped;
}

function inferAgentPlanMessageIndex(messages: ChatMessage[], plan: AgentPlan) {
  if (!messages.length) return -1;
  const planTime = parseMaybeDate(plan.created_at ?? plan.updated_at);
  if (planTime !== null) {
    for (let index = 0; index < messages.length; index += 1) {
      const message = messages[index];
      if (message.role !== "assistant") continue;
      const messageTime = parseMaybeDate(message.created_at);
      if (messageTime !== null && messageTime >= planTime - 2000) return index;
    }
  }
  const matchingIndex = messages.findIndex(
    (message) => message.role === "assistant" && message.content.includes(plan.summary)
  );
  if (matchingIndex >= 0) return matchingIndex;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === "assistant") return index;
  }
  return -1;
}

function buildAgentPlanAnchors(messages: ChatMessage[], plans: AgentPlan[]) {
  const anchors: AgentPlanAnchorMap = {};
  for (const plan of plans) {
    const planId = getAgentPlanId(plan);
    if (!planId) continue;
    anchors[planId] = inferAgentPlanMessageIndex(messages, plan);
  }
  return anchors;
}

function parseMaybeDate(value?: string | null) {
  if (!value) return null;
  const normalized = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value) ? value : `${value.replace(/\s+/, "T")}Z`;
  const time = new Date(normalized).getTime();
  return Number.isNaN(time) ? null : time;
}

function agentPlanInlineMessage(plan: AgentPlan) {
  if (plan.status === "pending") {
    return `Agent 修改任务已创建。\n\n摘要：${plan.summary}\n状态：${plan.apply_result || "等待 VS Code 插件读取文件并生成计划。"}`;
  }
  if (plan.status === "waiting_confirm") {
    return `Agent 计划已生成。\n\n摘要：${plan.summary}\n操作数：${plan.operations.length}\n状态：等待网页确认。`;
  }
  return `Agent 计划已更新。\n\n摘要：${plan.summary}\n状态：${plan.apply_result || agentPlanStatusText(plan.status ?? "")}`;
}

function inputPlaceholder(
  isReportMode: boolean,
  isAgentMode: boolean,
  agentIntent: AgentIntent,
  isPlanConfirmMode: boolean
) {
  if (isPlanConfirmMode) return "输入调整建议，回车重新生成计划；留空点击按钮确认执行计划";
  if (isReportMode) return "围绕这份报告继续追问";
  if (!isAgentMode) return "随便聊点什么";
  if (agentIntent === "plan") return "描述要生成修改计划的任务...";
  if (agentIntent === "chat") return "询问项目结构、代码问题或调试思路...";
  return "提问或描述修改目标，系统会自动判断是否生成计划...";
}

function contextModeHint(mode: AgentContextMode, selectedCount: number, workspace?: WorkspaceSnapshot | null) {
  const workspaceState = getWorkspaceConnectionState(workspace ?? null);
  if (workspaceState === "waiting") return "等待 VS Code 插件同步项目后，计划任务才能读取真实文件。";
  if (workspaceState === "delayed") return "插件心跳略有延迟，正在等待下一次同步。";
  if (workspaceState === "blocked") return "VS Code 已连接，但尚未打开工作区文件夹。";
  if (mode === "ai_auto") return "无需勾选文件，插件会让 AI 从项目清单中选择最小上下文。";
  if (mode === "hybrid") return selectedCount ? `保留 ${selectedCount} 个种子文件，再由 AI 补充。` : "可先勾核心文件，也可直接让 AI 补充。";
  return selectedCount ? `已选择 ${selectedCount} 个文件。` : "从当前项目树勾选文件作为上下文。";
}

type AgentStageState = {
  workspace: "ready" | "delayed" | "blocked" | "waiting";
  context: "ready" | "waiting";
  plan: "idle" | "pending" | "waiting_confirm" | "confirmed" | "applied" | "failed" | "rejected";
  execution: "idle" | "waiting" | "done" | "failed" | "rejected";
};

function AgentHeaderCompactControls({
  stage,
  contextMode,
  selectedFilePaths,
  workspace,
  onContextModeChange
}: {
  stage: AgentStageState;
  contextMode: AgentContextMode;
  selectedFilePaths: string[];
  workspace?: WorkspaceSnapshot | null;
  onContextModeChange?: (mode: AgentContextMode) => void;
}) {
  const steps = [
    { key: "workspace", label: "工作区", status: stage.workspace, detail: agentStageDetail("workspace", stage.workspace) },
    { key: "context", label: "上下文", status: stage.context, detail: agentStageDetail("context", stage.context) },
    { key: "plan", label: "计划", status: stage.plan, detail: agentStageDetail("plan", stage.plan) },
    { key: "execution", label: "执行", status: stage.execution, detail: agentStageDetail("execution", stage.execution) },
  ];

  return (
    <div className="agent-header-compact-controls">
      <div className="agent-header-stage-row" aria-label="Agent 任务状态">
        {steps.map((step) => (
          <span className={`agent-header-stage-chip agent-header-stage-chip-${step.status}`} key={step.key} title={`${step.label}: ${step.detail}`}>
            <em>{step.label}</em>
            <strong>{step.detail}</strong>
          </span>
        ))}
      </div>
      <div className="agent-header-context-row">
        <div className="agent-header-mini-mode" role="tablist" aria-label="Agent 上下文来源">
          {(["manual", "ai_auto", "hybrid"] as AgentContextMode[]).map((modeOption) => (
            <button
              aria-selected={contextMode === modeOption}
              className={contextMode === modeOption ? "agent-header-mini-mode-active" : ""}
              key={modeOption}
              onClick={() => onContextModeChange?.(modeOption)}
              role="tab"
              title={contextModeHint(modeOption, selectedFilePaths.length, workspace)}
              type="button"
            >
              {contextModeLabel(modeOption)}
            </button>
          ))}
        </div>
        <div className="agent-header-context-summary" title={contextModeHint(contextMode, selectedFilePaths.length, workspace)}>
          <span>{selectedFilePaths.length ? `已选 ${selectedFilePaths.length} 个文件` : "未选文件"}</span>
          <em>{contextModeHint(contextMode, selectedFilePaths.length, workspace)}</em>
        </div>
      </div>
    </div>
  );
}

function AgentSelectedFileBar({
  contextMode,
  selectedFilePaths,
  onRemoveSelectedFile,
  onClearSelectedFiles
}: {
  contextMode: AgentContextMode;
  selectedFilePaths: string[];
  onRemoveSelectedFile?: (path: string) => void;
  onClearSelectedFiles?: () => void;
}) {
  const label = contextMode === "ai_auto" ? "参考文件" : contextMode === "hybrid" ? "种子文件" : "上下文文件";

  return (
    <div className="agent-selected-file-bar" aria-label="已选上下文文件">
      <span>{label}</span>
      <div className="agent-selected-file-scroll">
        {selectedFilePaths.map((path) => (
          <button
            className="agent-selected-file-chip"
            key={path}
            onClick={() => onRemoveSelectedFile?.(path)}
            title={`移除 ${path}`}
            type="button"
          >
            <strong>{fileNameFromPath(path)}</strong>
            <X size={11} />
          </button>
        ))}
      </div>
      <button className="agent-selected-file-clear" onClick={onClearSelectedFiles} type="button">
        清空
      </button>
    </div>
  );
}

function AgentWorkflowStrip({ stage }: { stage: AgentStageState }) {
  const steps = [
    { key: "workspace", label: "工作区", status: stage.workspace, detail: agentStageDetail("workspace", stage.workspace) },
    { key: "context", label: "上下文", status: stage.context, detail: agentStageDetail("context", stage.context) },
    { key: "plan", label: "计划确认", status: stage.plan, detail: agentStageDetail("plan", stage.plan) },
    { key: "execution", label: "插件执行", status: stage.execution, detail: agentStageDetail("execution", stage.execution) },
  ];

  return (
    <div className="agent-workflow-strip" aria-label="Agent 任务流程">
      {steps.map((step) => (
        <div className={`agent-workflow-step agent-workflow-step-${step.status}`} key={step.key}>
          <span>{step.label}</span>
          <strong>{step.detail}</strong>
        </div>
      ))}
    </div>
  );
}

function buildAgentStageState(
  workspace: WorkspaceSnapshot | null,
  contextMode: AgentContextMode,
  selectedCount: number,
  plans: AgentPlan[]
): AgentStageState {
  const latest = [...plans].reverse().find(Boolean);
  const status = latest?.status ?? "";
  const workspaceState = getWorkspaceConnectionState(workspace);
  const contextReady = contextMode !== "manual" || selectedCount > 0;

  return {
    workspace: workspaceState,
    context: contextReady ? "ready" : "waiting",
    plan: normalizePlanStage(status),
    execution: normalizeExecutionStage(status),
  };
}

function normalizePlanStage(status: string): AgentStageState["plan"] {
  if (status === "pending") return "pending";
  if (status === "waiting_confirm") return "waiting_confirm";
  if (status === "confirmed") return "confirmed";
  if (status === "applied") return "applied";
  if (status === "failed") return "failed";
  if (status === "rejected") return "rejected";
  return "idle";
}

function normalizeExecutionStage(status: string): AgentStageState["execution"] {
  if (status === "confirmed") return "waiting";
  if (status === "applied") return "done";
  if (status === "failed") return "failed";
  if (status === "rejected") return "rejected";
  return "idle";
}

function agentStageDetail(step: string, status: string) {
  if (step === "workspace") {
    if (status === "ready") return "已连接";
    if (status === "delayed") return "同步延迟";
    if (status === "blocked") return "需打开项目";
    return "等插件";
  }
  if (step === "context") return status === "ready" ? "已确定" : "待选择";
  if (step === "plan") {
    if (status === "pending") return "插件生成中";
    if (status === "waiting_confirm") return "待确认";
    if (status === "confirmed") return "已确认";
    if (status === "applied") return "已完成";
    if (status === "failed") return "失败";
    if (status === "rejected") return "已拒绝";
    return "未开始";
  }
  if (status === "waiting") return "等待应用";
  if (status === "done") return "已应用";
  if (status === "failed") return "失败";
  if (status === "rejected") return "已拒绝";
  return "未开始";
}

function getWorkspaceHeartbeatAgeSeconds(snapshot: WorkspaceSnapshot | null) {
  if (!snapshot?.updated_at) return Number.POSITIVE_INFINITY;
  const raw = snapshot.updated_at.trim();
  const normalized = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw) ? raw : `${raw.replace(/\s+/, "T")}Z`;
  const time = new Date(normalized).getTime();
  if (Number.isNaN(time)) return Number.POSITIVE_INFINITY;
  return Math.max(0, (Date.now() - time) / 1000);
}

function getWorkspaceConnectionState(snapshot: WorkspaceSnapshot | null): AgentStageState["workspace"] {
  if (!snapshot?.updated_at || !snapshot.connected) return "waiting";
  const ageSeconds = getWorkspaceHeartbeatAgeSeconds(snapshot);
  if (ageSeconds > WORKSPACE_HEARTBEAT_STALE_SECONDS) return "waiting";
  if (snapshot.status === "no_workspace") return "blocked";
  if (ageSeconds > WORKSPACE_HEARTBEAT_DELAYED_SECONDS) return "delayed";
  return "ready";
}

function agentFriendlyError(message: string, isAgentMode: boolean) {
  if (!isAgentMode || !message.includes("Agent 计划不是有效 JSON")) return message;
  return `${message}\n插件已读取上下文，失败发生在模型生成可确认修改计划阶段。请重试，或缩小上下文后再生成。`;
}

function AgentPlanCard({
  plan,
  progressEvents = [],
  busy = false,
  runtimeMessage = "",
  onConfirm
}: {
  plan: AgentPlan;
  progressEvents?: AgentPlanProgressEvent[];
  busy?: boolean;
  runtimeMessage?: string;
  onConfirm?: (action: "apply" | "reject") => void;
}) {
  const status = plan.status ?? "pending";
  const statusText = agentPlanStatusText(status);
  const canConfirm = status === "waiting_confirm" && plan.operations.length > 0 && onConfirm;
  const guidance = agentPlanGuidance(plan);

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
          ? "来自网页端，确认前不会修改 VS Code 工作区。"
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
      {progressEvents.length && ["pending", "confirmed", "applied", "failed"].includes(status) ? (
        <div className="agent-plan-progress-list" aria-label="Agent 计划生成进度">
          {progressEvents.map((event, index) => (
            <div className="agent-plan-progress-item" key={`${event.sequence ?? index}-${event.phase}`}>
              <span />
              <div>
                <strong>{event.message}</strong>
                {event.detail ? <small>{event.detail}</small> : null}
              </div>
            </div>
          ))}
        </div>
      ) : null}
      {plan.operations.length ? (
        <div className="agent-plan-operation-list">
          {plan.operations.slice(0, 6).map((operation, index) => (
            <div className="agent-plan-operation" key={`${operation.type}-${operation.path}-${index}`}>
              <span className="agent-plan-operation-type">{operation.type}</span>
              <div className="agent-plan-operation-body">
                <code className="agent-plan-operation-path">{operation.path}</code>
                {operation.new_path ? <code className="agent-plan-operation-path">→ {operation.new_path}</code> : null}
                {operation.edits?.length ? <span className="agent-plan-operation-reason">局部编辑 {operation.edits.length} 处</span> : null}
                {operation.reason ? <span className="agent-plan-operation-reason">{operation.reason}</span> : null}
              </div>
            </div>
          ))}
          {plan.operations.length > 6 ? (
            <div className="agent-plan-operation-more">还有 {plan.operations.length - 6} 个文件操作</div>
          ) : null}
        </div>
      ) : null}
      {guidance ? <p className={`agent-plan-card-guidance agent-plan-card-guidance-${status}`}>{guidance}</p> : null}
      {plan.apply_result && status !== "pending" ? <p className="agent-plan-card-result">{plan.apply_result}</p> : null}
      {runtimeMessage && status === "confirmed" ? <p className="agent-plan-card-runtime">{runtimeMessage}</p> : null}
      {canConfirm || status === "waiting_confirm" ? (
        <footer className="agent-plan-card-footer">
          <span>确认后插件才会开始修改文件。</span>
          {canConfirm ? (
            <div className="agent-plan-card-actions">
              <button className="btn btn-primary h-8" disabled={busy} onClick={() => onConfirm("apply")} type="button">
                {busy ? <Loader2 className="animate-spin" size={14} /> : <Check size={14} />}
                确认执行计划
              </button>
              <button className="btn btn-secondary h-8" disabled={busy} onClick={() => onConfirm("reject")} type="button">
                拒绝
              </button>
            </div>
          ) : null}
        </footer>
      ) : null}
    </article>
  );
}

function agentPlanStatusText(status: string) {
  if (status === "pending") return "待插件生成计划";
  if (status === "waiting_confirm") return "等待网页确认";
  if (status === "confirmed") return "已确认，等待插件应用";
  if (status === "applied") return "已应用";
  if (status === "failed") return "失败";
  if (status === "rejected") return "已拒绝";
  return status;
}

function agentPlanGuidance(plan: AgentPlan) {
  const status = plan.status ?? "pending";
  if (status === "pending") return "请保持 VS Code 插件和当前项目打开，插件会读取上下文并回传可确认的修改计划。";
  if (status === "waiting_confirm" && !plan.operations.length) return "计划没有生成文件操作，可以继续追问补充任务目标，或改用讨论模式先定位问题。";
  if (status === "waiting_confirm") return "确认后才会进入插件执行阶段，执行前仍可拒绝。";
  if (status === "confirmed") return "已进入插件执行队列，请保持 VS Code 工作区在线。";
  if (status === "failed") return "检查插件连接、工作区路径和计划中的文件是否仍存在，然后重新生成计划。";
  return "";
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
