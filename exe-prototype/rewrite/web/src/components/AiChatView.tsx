import {
  Bot,
  BrainCircuit,
  CheckCircle2,
  ClipboardList,
  FileSearch,
  FileText,
  Lightbulb,
  Loader2,
  MessageSquare,
  Network,
  Route,
  Search,
  SendHorizontal,
  Sparkles,
  Trash2,
  TriangleAlert
} from "lucide-react";
import type { FormEvent, ReactNode } from "react";
import { useMemo } from "react";
import type { ChatMessageItem, ChatSessionDetail, ChatSessionSummary, Finding, ReportSummary, WorkspaceDetail, WorkspaceSummary } from "../types";
import { describeContext, formatTime, roleLabel } from "../utils/display";

export function AiChatView(props: {
  sessions: ChatSessionSummary[];
  messages: ChatMessageItem[];
  reports: ReportSummary[];
  workspaces: WorkspaceSummary[];
  workspace: WorkspaceDetail | null;
  findings: Finding[];
  activeChat: ChatSessionDetail | null;
  query: string;
  draft: string;
  context: string;
  busy: boolean;
  llmReady: boolean;
  onQueryChange: (value: string) => void;
  onSearch: () => void;
  onNew: () => void;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onDraftChange: (value: string) => void;
  onContextChange: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
}) {
  const contextText = describeContext(props.context, props.workspaces, props.workspace, props.findings, props.reports);
  const [contextKind, contextId = ""] = props.context.split("|", 2);
  const assistantCount = props.messages.filter((message) => message.role === "assistant").length;
  const userCount = props.messages.filter((message) => message.role === "user").length;
  const quickPrompts = useMemo(() => buildQuickPrompts(contextKind || "none", contextText), [contextKind, contextText]);
  const sessionStats = useMemo(() => buildSessionStats(props.sessions), [props.sessions]);
  const contextPreview = useMemo(
    () => buildContextPreview(contextKind || "none", contextId, props.workspace, props.workspaces, props.findings, props.reports),
    [contextId, contextKind, props.findings, props.reports, props.workspace, props.workspaces]
  );

  return (
    <section className="chat-layout chat-page-next">
      <aside className="chat-sessions chat-sessions-next">
        <div className="chat-rail-head-next">
          <span>对话会话</span>
          <strong>{props.sessions.length} 个会话</strong>
        </div>
        <form
          className="compact-search"
          onSubmit={(event) => {
            event.preventDefault();
            props.onSearch();
          }}
        >
          <Search size={17} />
          <input value={props.query} onChange={(event) => props.onQueryChange(event.target.value)} placeholder="搜索对话" />
        </form>
        <button className="primary-button full" onClick={props.onNew}><MessageSquare size={18} />新建对话</button>
        <div className="chat-session-insight-next">
          <small>会话 <strong>{sessionStats.total}</strong></small>
          <small>消息 <strong>{sessionStats.messages}</strong></small>
          <small>最近 <strong>{sessionStats.latest}</strong></small>
        </div>
        <div className="chat-session-route-next">
          <span><Route size={14} />对话沉淀路径</span>
          <p>选择上下文，追问风险与设计，再把结论沉淀到报告、卡片、Agent 或每日日志。</p>
          <small>当前：{props.activeChat ? props.activeChat.title : "新会话"}</small>
        </div>
        <div className="session-list">
          {props.sessions.map((session) => (
            <div className={props.activeChat?.id === session.id ? "session-row active" : "session-row"} key={session.id}>
              <button onClick={() => props.onOpen(session.id)}>
                <strong>{session.title}</strong>
                <span>{session.message_count} 条消息 · {formatTime(session.updated_at)}</span>
              </button>
              <button className="icon-button danger" onClick={() => props.onDelete(session.id)}><Trash2 size={16} /></button>
            </div>
          ))}
          {props.sessions.length === 0 && <div className="empty small">暂无对话。</div>}
        </div>
      </aside>
      <section className="chat-main chat-main-next">
        <div className="chat-context-card-next">
          <div>
            <span>当前上下文</span>
            <strong>{contextText}</strong>
            <p>{contextHint(contextKind || "none")}</p>
          </div>
          <label>
            上下文
            <select value={props.context} onChange={(event) => props.onContextChange(event.target.value)}>
              <option value="none|">无上下文</option>
              {props.workspaces.map((item) => <option key={item.id} value={`workspace|${item.id}`}>工作区：{item.name}</option>)}
              {props.workspace?.files.map((file) => <option key={file.id} value={`file|${props.workspace?.summary.id}::${file.path}`}>文件：{file.path}</option>)}
              {props.findings.map((item) => <option key={item.id} value={`finding|${item.id}`}>问题：{item.title}</option>)}
              {props.reports.map((item) => <option key={item.id} value={`report|${item.id}`}>报告：{item.title}</option>)}
            </select>
          </label>
        </div>
        <section className="chat-copilot-board-next">
          <div className="chat-copilot-head-next">
            <div>
              <span><BrainCircuit size={15} />上下文工作台</span>
              <h3>{props.llmReady ? "可以围绕当前上下文继续追问" : "等待配置 LLM 后启用真实对话"}</h3>
              <p>对话会保存到本地 SQLite，并可与报告、工作区、问题、文件上下文形成复盘链路。</p>
            </div>
            <strong>{props.messages.length}</strong>
          </div>
          <div className="chat-context-metrics-next">
            <Metric icon={<Route size={15} />} label="上下文类型" value={contextKindLabel(contextKind || "none")} />
            <Metric icon={<ClipboardList size={15} />} label="用户消息" value={`${userCount}`} />
            <Metric icon={<Bot size={15} />} label="助手回复" value={`${assistantCount}`} />
            <Metric icon={<Sparkles size={15} />} label="LLM 状态" value={props.llmReady ? "已配置" : "未配置"} />
          </div>
          <div className="chat-quick-prompts-next">
            {quickPrompts.map((prompt) => (
              <button key={prompt.title} onClick={() => props.onDraftChange(prompt.text)} type="button">
                <span>{prompt.icon}</span>
                <strong>{prompt.title}</strong>
                <small>{prompt.description}</small>
              </button>
            ))}
          </div>
        </section>
        <section className="chat-context-preview-next">
          <div className="chat-context-preview-head-next">
            <span><FileSearch size={15} />上下文预览</span>
            <strong>{contextText}</strong>
          </div>
          <div>
            {contextPreview.map((item) => (
              <article key={item.label}>
                <span>{item.icon}{item.label}</span>
                <strong>{item.value}</strong>
                <small>{item.detail}</small>
              </article>
            ))}
          </div>
        </section>
        <ChatReviewMatrix
          contextKind={contextKind || "none"}
          contextText={contextText}
          messages={props.messages}
          activeChat={props.activeChat}
          llmReady={props.llmReady}
          onDraftChange={props.onDraftChange}
        />
        {!props.llmReady && <div className="notice warning"><TriangleAlert size={18} />AI 对话需要先启用 LLM 并保存 API Key。</div>}
        <div className="chat-message-toolbar-next">
          <span><MessageSquare size={15} />当前会话</span>
          <strong>{props.messages.length} 条消息</strong>
        </div>
        <div className="messages">
          {props.messages.map((item) => (
            <article className={item.role === "user" ? "message user" : "message assistant"} key={item.id}>
              <span>{roleLabel(item.role)} · {formatTime(item.created_at)}</span>
              <p>{item.content}</p>
            </article>
          ))}
          {props.messages.length === 0 && (
            <div className="chat-empty-next">
              <Lightbulb size={30} />
              <strong>围绕选中的上下文开始对话</strong>
              <p>可以先点上方快捷追问，或直接输入你想审查、理解、重构或复盘的问题。</p>
            </div>
          )}
        </div>
        <form className="chat-input" onSubmit={props.onSubmit}>
          <textarea value={props.draft} onChange={(event) => props.onDraftChange(event.target.value)} placeholder="询问工作区、文件、问题或报告相关内容..." />
          <button className="primary-button" disabled={props.busy || !props.draft.trim()} type="submit">
            {props.busy ? <Loader2 className="spin" size={18} /> : <SendHorizontal size={18} />}
            发送
          </button>
        </form>
      </section>
    </section>
  );
}

function ChatReviewMatrix({
  contextKind,
  contextText,
  messages,
  activeChat,
  llmReady,
  onDraftChange
}: {
  contextKind: string;
  contextText: string;
  messages: ChatMessageItem[];
  activeChat: ChatSessionDetail | null;
  llmReady: boolean;
  onDraftChange: (value: string) => void;
}) {
  const assistantCount = messages.filter((message) => message.role === "assistant").length;
  const userCount = messages.filter((message) => message.role === "user").length;
  const hasContext = contextKind !== "none";
  const hasHistory = messages.length > 0 || Boolean(activeChat);
  const readinessScore = [llmReady, hasContext, hasHistory, assistantCount > 0].filter(Boolean).length;
  const matrixItems = [
    {
      label: "上下文锚点",
      value: hasContext ? contextKindLabel(contextKind) : "未选择",
      detail: hasContext ? `当前对话会围绕「${contextText}」追问。` : "建议先选择工作区、文件、问题或报告，减少泛泛问答。",
      state: hasContext ? "ready" : "missing"
    },
    {
      label: "模型可用性",
      value: llmReady ? "已就绪" : "未配置",
      detail: llmReady ? "可以进行真实流式对话，并把结果保存到本地 SQLite。" : "需要在设置页启用 LLM 并保存 API Key。",
      state: llmReady ? "ready" : "missing"
    },
    {
      label: "对话连续性",
      value: `${messages.length} 条消息`,
      detail: hasHistory ? `用户 ${userCount} 条 / 助手 ${assistantCount} 条，可继续追问。` : "尚未形成会话历史，适合先用快捷追问建立第一轮结论。",
      state: hasHistory ? "ready" : "pending"
    },
    {
      label: "沉淀方向",
      value: assistantCount > 0 ? "可复盘" : "待生成",
      detail: assistantCount > 0 ? "已有助手回复，可继续整理成问题、卡片、Agent 输入或每日日志。" : "先获得一轮回答，再把结论沉淀到工作闭环。",
      state: assistantCount > 0 ? "ready" : "pending"
    }
  ];
  const actionPrompts = [
    {
      label: "追问风险",
      detail: "要求模型列出风险、证据和验证方式",
      icon: <TriangleAlert size={15} />,
      text: `请围绕当前上下文「${contextText}」继续追问：列出最高优先级风险、判断依据、受影响文件或模块，以及我应该如何验证。`
    },
    {
      label: "生成验证清单",
      detail: "把讨论转成可执行检查项",
      icon: <ClipboardList size={15} />,
      text: `请基于当前上下文「${contextText}」生成一份验证清单，按“必须验证 / 建议验证 / 可后续验证”分组，每项说明验证方法。`
    },
    {
      label: "整理成复盘摘要",
      detail: "为每日日志准备中文总结",
      icon: <FileText size={15} />,
      text: `请把当前上下文「${contextText}」相关讨论整理成每日日志可用的复盘摘要，包括今日理解、关键风险、下一步行动和待确认问题。`
    },
    {
      label: "准备 Agent 输入",
      detail: "形成可确认执行计划前置材料",
      icon: <Bot size={15} />,
      text: `请基于当前上下文「${contextText}」整理 Agent 执行前输入：目标、影响范围、需要读取的文件、建议步骤、风险和验收标准。`
    }
  ];

  return (
    <section className="chat-review-matrix-next">
      <div className="chat-review-head-next">
        <div>
          <span><Network size={15} />对话审查矩阵</span>
          <h3>{readinessScore >= 3 ? "当前对话具备上下文闭环基础" : "当前对话还需要补齐上下文或模型配置"}</h3>
          <p>这里检查一次对话能否支撑真实项目追问：是否有上下文锚点、模型是否可用、会话是否连续，以及是否已经产生可沉淀结论。</p>
        </div>
        <strong>{readinessScore}/4</strong>
      </div>

      <div className="chat-review-grid-next">
        {matrixItems.map((item) => (
          <article className={item.state} key={item.label}>
            <span>{item.state === "ready" ? <CheckCircle2 size={14} /> : <TriangleAlert size={14} />}{item.label}</span>
            <strong>{item.value}</strong>
            <p>{item.detail}</p>
          </article>
        ))}
      </div>

      <div className="chat-review-actions-next">
        {actionPrompts.map((item) => (
          <button key={item.label} onClick={() => onDraftChange(item.text)} type="button">
            <span>{item.icon}</span>
            <strong>{item.label}</strong>
            <small>{item.detail}</small>
          </button>
        ))}
      </div>
    </section>
  );
}

function Metric({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <article>
      <span>{icon}{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function buildSessionStats(sessions: ChatSessionSummary[]) {
  const latest = sessions[0]?.updated_at ? formatTime(sessions[0].updated_at).slice(0, 10) : "暂无";
  return {
    total: sessions.length,
    messages: sessions.reduce((sum, session) => sum + session.message_count, 0),
    latest
  };
}

function buildQuickPrompts(contextKind: string, contextText: string) {
  const base = [
    {
      title: "解释当前上下文",
      description: "先把项目、文件或报告讲清楚",
      icon: <FileSearch size={16} />,
      text: `请解释当前上下文：${contextText}。请用中文说明它的核心作用、关键风险和我应该优先看的地方。`
    },
    {
      title: "生成下一步清单",
      description: "转成可执行审查动作",
      icon: <ClipboardList size={16} />,
      text: `请基于当前上下文：${contextText}，生成一份下一步审查清单，按优先级列出。`
    },
    {
      title: "提炼学习卡片",
      description: "把问题变成学习素材",
      icon: <Sparkles size={16} />,
      text: `请从当前上下文：${contextText} 中提炼 3 个适合做知识卡片的学习点，每个包含标题、解释和练习建议。`
    },
    {
      title: "准备 Agent 计划",
      description: "把讨论转成确认式执行方案",
      icon: <Bot size={16} />,
      text: `请基于当前上下文：${contextText}，整理一份 Agent 执行前计划，包含目标、涉及文件、风险、验证方式和需要我确认的操作。`
    }
  ];
  if (contextKind === "finding") {
    return [
      {
        title: "分析这个问题",
        description: "定位原因和影响面",
        icon: <TriangleAlert size={16} />,
        text: `请围绕这个问题：${contextText}，分析可能原因、影响范围、验证方法和修复思路。`
      },
      ...base.slice(1)
    ];
  }
  if (contextKind === "report") {
    return [
      {
        title: "总结报告风险",
        description: "转成可跟踪行动",
        icon: <FileSearch size={16} />,
        text: `请围绕这份报告：${contextText}，总结最高优先级风险、建议修复顺序和需要补充的测试。`
      },
      ...base.slice(1)
    ];
  }
  return base;
}

function contextKindLabel(value: string) {
  const labels: Record<string, string> = {
    none: "无上下文",
    workspace: "工作区",
    file: "文件",
    finding: "问题",
    report: "报告"
  };
  return labels[value] || value;
}

function contextHint(value: string) {
  const hints: Record<string, string> = {
    none: "当前不会自动携带项目资料，适合通用开发问答。",
    workspace: "会围绕工作区摘要、文件结构和本地审查结果继续追问。",
    file: "会聚焦当前文件的实现细节、风险点和重构建议。",
    finding: "会围绕单个问题定位原因、影响范围和修复方式。",
    report: "会围绕当前报告继续解释风险、建议和后续行动。"
  };
  return hints[value] || "当前上下文会随问题一起进入对话。";
}

function buildContextPreview(
  kind: string,
  rawId: string,
  workspace: WorkspaceDetail | null,
  workspaces: WorkspaceSummary[],
  findings: Finding[],
  reports: ReportSummary[]
) {
  if (kind === "workspace") {
    const summary = workspaces.find((item) => item.id === rawId) || workspace?.summary;
    return [
      { label: "工作区", value: summary?.name || "当前工作区", detail: `${summary?.file_count || 0} 个文件 / ${summary?.total_lines || 0} 行`, icon: <Route size={15} /> },
      { label: "语言分布", value: summary?.language_summary || "暂无", detail: "用于回答架构、模块和文件阅读顺序问题。", icon: <ClipboardList size={15} /> },
      { label: "可引用文件", value: `${workspace?.files.length || 0}`, detail: "当前只携带主动导入的工作区文件。", icon: <FileSearch size={15} /> }
    ];
  }
  if (kind === "file") {
    const path = rawId.includes("::") ? rawId.split("::").slice(1).join("::") : rawId;
    const file = workspace?.files.find((item) => item.path === path);
    return [
      { label: "文件", value: file?.path || path || "当前文件", detail: file ? `${file.language} / ${file.metrics.total_lines} 行` : "从上下文选择器传入的文件路径。", icon: <FileSearch size={15} /> },
      { label: "复杂度", value: `${file?.metrics.complexity_score || 0}`, detail: "适合追问重构、拆分和测试策略。", icon: <Sparkles size={15} /> },
      { label: "风险数量", value: `${file?.metrics.risk_count || 0}`, detail: "结合问题清单继续定位。", icon: <TriangleAlert size={15} /> }
    ];
  }
  if (kind === "finding") {
    const finding = findings.find((item) => item.id === rawId);
    return [
      { label: "问题", value: finding?.title || "当前问题", detail: finding?.detail || "围绕单个问题继续追问。", icon: <TriangleAlert size={15} /> },
      { label: "位置", value: finding?.file_path || "未关联文件", detail: finding?.line_start ? `第 ${finding.line_start} 行附近` : "未记录行号。", icon: <FileSearch size={15} /> },
      { label: "建议", value: finding?.suggestion || "继续复查", detail: "可转成 Agent 计划或知识卡片。", icon: <ClipboardList size={15} /> }
    ];
  }
  if (kind === "report") {
    const report = reports.find((item) => item.id === rawId);
    return [
      { label: "报告", value: report?.title || "当前报告", detail: report?.summary || "围绕报告摘要继续追问。", icon: <FileSearch size={15} /> },
      { label: "风险等级", value: report ? report.risk_level : "暂无", detail: report ? `${report.risk_count} 个风险 / ${report.file_count} 个文件` : "打开报告后可看到更完整上下文。", icon: <TriangleAlert size={15} /> },
      { label: "报告类型", value: report ? report.report_type : "暂无", detail: "可继续拆成问题、卡片、日志或 Agent 计划。", icon: <Route size={15} /> }
    ];
  }
  return [
    { label: "上下文", value: "通用问答", detail: "不会自动携带项目资料，适合询问开发方法、代码思路和学习问题。", icon: <MessageSquare size={15} /> },
    { label: "沉淀建议", value: "先选报告或工作区", detail: "选择具体上下文后，回答会更容易进入闭环资产。", icon: <Sparkles size={15} /> },
    { label: "隐私边界", value: "本地优先", detail: "只有在启用 LLM 后才会发送必要上下文。", icon: <Bot size={15} /> }
  ];
}
