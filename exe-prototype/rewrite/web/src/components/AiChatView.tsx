import { AlertTriangle, ChevronLeft, FileCode2, FileText, Folder, Lightbulb, Loader2, Menu, MessageSquare, MoreHorizontal, PanelLeftClose, PanelLeftOpen, Search, SendHorizontal, Settings, ShieldAlert, Trash2, X } from "lucide-react";
import type { FormEvent, KeyboardEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ChatMessageItem, ChatSessionDetail, ChatSessionSummary, Finding, ReportSummary, WorkspaceDetail, WorkspaceSummary } from "../types";
import { describeContext, formatTime, roleLabel } from "../utils/display";
import { ProductToolbar } from "./ProductShell";

const collapsedKey = "codelens.chat.collapsed";

export function AiChatView(props: {
  sessions: ChatSessionSummary[]; messages: ChatMessageItem[]; reports: ReportSummary[]; workspaces: WorkspaceSummary[];
  workspace: WorkspaceDetail | null; findings: Finding[]; activeChat: ChatSessionDetail | null; query: string; draft: string;
  context: string; busy: boolean; llmReady: boolean; onQueryChange: (value: string) => void; onSearch: () => void;
  onNew: () => void; onOpen: (id: string) => void; onDelete: (id: string) => void; onDraftChange: (value: string) => void;
  onContextChange: (value: string) => void; onSubmit: (event: FormEvent) => void; onOpenSettings: () => void;
}) {
  const [collapsed, setCollapsed] = useState(() => typeof window !== "undefined" && window.localStorage.getItem(collapsedKey) === "true");
  const [mobileSessions, setMobileSessions] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const [contextQuery, setContextQuery] = useState("");
  const [menuId, setMenuId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const messageRef = useRef<HTMLDivElement | null>(null);
  const followRef = useRef(true);
  const contextText = describeContext(props.context, props.workspaces, props.workspace, props.findings, props.reports);
  const [contextKind] = props.context.split("|", 1);
  const prompts = useMemo(() => quickPrompts(contextText), [contextText]);
  const contextItems = useMemo(() => buildContextItems(props.workspaces, props.workspace, props.findings, props.reports, contextQuery), [props.workspaces, props.workspace, props.findings, props.reports, contextQuery]);
  const latestMessage = props.messages[props.messages.length - 1];

  useEffect(() => { window.localStorage.setItem(collapsedKey, String(collapsed)); }, [collapsed]);
  useEffect(() => { followRef.current = true; requestAnimationFrame(() => scrollToBottom(messageRef.current)); }, [props.activeChat?.id]);
  useEffect(() => { if (followRef.current) requestAnimationFrame(() => scrollToBottom(messageRef.current)); }, [props.messages.length, latestMessage?.content]);

  function selectContext(value: string) { props.onContextChange(value); setContextOpen(false); setContextQuery(""); }
  function openSession(id: string) { props.onOpen(id); setMobileSessions(false); setMenuId(null); }
  function newSession() { props.onNew(); setMobileSessions(false); setMenuId(null); followRef.current = true; }
  function onMessageScroll() { const node = messageRef.current; if (node) followRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80; }
  function onComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); if (!props.busy && props.llmReady && props.draft.trim()) event.currentTarget.form?.requestSubmit(); } }

  return <section className={`chat-workspace-v137 ${collapsed ? "is-collapsed" : ""}`}>
    <div className="chat-layout-v137">
      {mobileSessions && <button className="chat-scrim-v137" aria-label="关闭会话索引" onClick={() => setMobileSessions(false)}/>}
      <aside className={`chat-index-v137 ${mobileSessions ? "is-open" : ""}`}>
        <header><strong>{collapsed ? "对话" : `${props.sessions.length} 个会话`}</strong><button className="chat-mobile-close-v137" aria-label="关闭会话索引" onClick={() => setMobileSessions(false)} type="button"><X size={16}/></button><button className="chat-collapse-v137" aria-label={collapsed ? "展开会话索引" : "收起会话索引"} onClick={() => setCollapsed(!collapsed)} type="button">{collapsed ? <PanelLeftOpen size={15}/> : <PanelLeftClose size={15}/>}</button></header>
        {!collapsed && <><form className="chat-search-v137" onSubmit={(event) => { event.preventDefault(); props.onSearch(); }}><Search size={14}/><input value={props.query} onChange={(event) => props.onQueryChange(event.target.value)} placeholder="搜索对话"/></form><button className="chat-new-v137" onClick={newSession} type="button"><MessageSquare size={14}/>新建对话</button><div className="chat-session-list-v137">{props.sessions.map((session) => <article className={props.activeChat?.id === session.id ? "active" : ""} key={session.id}><button onClick={() => openSession(session.id)} type="button"><strong>{session.title}</strong><small>{session.message_count} 条消息 · {formatTime(session.updated_at)}</small></button><button aria-label={`更多操作 ${session.title}`} onClick={() => setMenuId(menuId === session.id ? null : session.id)} type="button"><MoreHorizontal size={14}/></button>{menuId === session.id && <div>{confirmDeleteId === session.id ? <><span>确认删除这个会话？</span><button className="danger" onClick={() => { props.onDelete(session.id); setMenuId(null); setConfirmDeleteId(null); }} type="button"><Trash2 size={13}/>确认删除</button></> : <button onClick={() => setConfirmDeleteId(session.id)} type="button"><Trash2 size={13}/>删除会话</button>}</div>}</article>)}{!props.sessions.length && <p>暂无历史对话。</p>}</div></>}
      </aside>

      <main className="chat-main-v137">
        <ProductToolbar><button className="chat-mobile-sessions-v137" aria-label="打开会话索引" onClick={() => setMobileSessions(true)} type="button"><Menu size={16}/></button><div className="product-toolbar-context-next"><strong>{props.activeChat?.title || "新对话"}</strong><span>{contextText}</span></div><nav className="product-toolbar-actions-next"><span className={props.llmReady ? "ready" : "missing"}>{props.llmReady ? "模型已就绪" : "未配置模型"}</span><button onClick={() => setContextOpen(true)} type="button"><Folder size={14}/>选择上下文</button></nav></ProductToolbar>
        {!props.llmReady && <div className="chat-llm-warning-v137"><AlertTriangle size={15}/><span>AI 对话需要启用 LLM 并配置 API Key。</span><button onClick={props.onOpenSettings} type="button"><Settings size={14}/>前往设置</button></div>}
        <div className="chat-messages-v137" ref={messageRef} onScroll={onMessageScroll}>
          {!props.messages.length && <section className="chat-empty-v137"><Lightbulb size={26}/><strong>围绕当前上下文开始对话</strong><p>{contextKind === "none" ? "先选择工作区、文件、问题或报告，回答会更准确。" : `当前上下文：${contextText}`}</p><div>{prompts.map((prompt) => <button key={prompt.title} onClick={() => props.onDraftChange(prompt.text)} type="button"><span>{prompt.icon}</span><strong>{prompt.title}</strong><small>{prompt.detail}</small></button>)}</div></section>}
          {props.messages.map((message) => <article className={`chat-message-v137 ${message.role}`} key={message.id}><header><strong>{roleLabel(message.role)}</strong><span>{formatTime(message.created_at)}</span>{message.id === "streaming-assistant" && <Loader2 className="spin" size={13}/>}</header><MessageContent content={message.content}/></article>)}
        </div>
        <form className="chat-composer-v137" onSubmit={props.onSubmit}><textarea disabled={!props.llmReady} value={props.draft} onChange={(event) => props.onDraftChange(event.target.value)} onKeyDown={onComposerKeyDown} placeholder={props.llmReady ? "输入问题，Enter 发送，Shift+Enter 换行" : "配置模型后即可开始对话"}/><button className="primary-button" disabled={props.busy || !props.llmReady || !props.draft.trim()} type="submit">{props.busy ? <Loader2 className="spin" size={17}/> : <SendHorizontal size={17}/>}<span>发送</span></button></form>
      </main>
    </div>

    {contextOpen && <><button className="chat-context-scrim-v137" aria-label="关闭上下文选择" onClick={() => setContextOpen(false)}/><aside className="chat-context-drawer-v137"><header><strong>选择上下文</strong><button aria-label="关闭上下文选择" onClick={() => setContextOpen(false)} type="button"><X size={17}/></button></header><label><Search size={14}/><input value={contextQuery} onChange={(event) => setContextQuery(event.target.value)} placeholder="搜索工作区、文件、问题或报告"/></label><div className="chat-context-list-v137"><ContextGroup title="通用" items={[{value:"none|",title:"无上下文",detail:"开始一个通用对话",icon:<MessageSquare size={14}/> }]} selected={props.context} onSelect={selectContext}/><ContextGroup title="工作区" items={contextItems.workspaces} selected={props.context} onSelect={selectContext}/><ContextGroup title="文件" items={contextItems.files} selected={props.context} onSelect={selectContext}/><ContextGroup title="问题" items={contextItems.findings} selected={props.context} onSelect={selectContext}/><ContextGroup title="报告" items={contextItems.reports} selected={props.context} onSelect={selectContext}/></div></aside></>}
  </section>;
}

type ContextItem={value:string;title:string;detail:string;icon:JSX.Element};
function ContextGroup({title,items,selected,onSelect}:{title:string;items:ContextItem[];selected:string;onSelect:(value:string)=>void}){if(!items.length)return null;return <section><h4>{title}</h4>{items.map((item)=><button className={selected===item.value?"active":""} key={item.value} onClick={()=>onSelect(item.value)} type="button"><span>{item.icon}</span><strong>{item.title}</strong><small>{item.detail}</small></button>)}</section>;}
function buildContextItems(workspaces:WorkspaceSummary[],workspace:WorkspaceDetail|null,findings:Finding[],reports:ReportSummary[],query:string){const q=query.trim().toLowerCase();const match=(...values:string[])=>!q||values.join(" ").toLowerCase().includes(q);return{workspaces:workspaces.filter(x=>match(x.name,x.root_path)).map(x=>({value:`workspace|${x.id}`,title:x.name,detail:`${x.file_count} 个文件 · ${x.language_summary}`,icon:<Folder size={14}/>})),files:(workspace?.files||[]).filter(x=>match(x.path,x.language)).slice(0,80).map(x=>({value:`file|${workspace?.summary.id}::${x.path}`,title:x.path,detail:x.language||"未知语言",icon:<FileCode2 size={14}/>})),findings:findings.filter(x=>match(x.title,x.file_path,x.detail)).slice(0,80).map(x=>({value:`finding|${x.id}`,title:x.title,detail:x.file_path||"未关联文件",icon:<ShieldAlert size={14}/>})),reports:reports.filter(x=>match(x.title,x.report_type,x.language)).slice(0,80).map(x=>({value:`report|${x.id}`,title:x.title,detail:`${x.report_type} · ${x.language}`,icon:<FileText size={14}/>}))};}
function quickPrompts(context:string){return[{title:"解释内容",detail:"说明核心作用和关键结构",icon:<Lightbulb size={15}/>,text:`请解释当前上下文《${context}》的核心作用、关键结构和阅读重点。`},{title:"识别风险",detail:"列出风险、证据和影响范围",icon:<ShieldAlert size={15}/>,text:`请检查当前上下文《${context}》，列出主要风险、判断依据和可能的影响范围。`},{title:"验证清单",detail:"转成可以执行的检查步骤",icon:<FileCode2 size={15}/>,text:`请基于当前上下文《${context}》生成一份验证清单，包含检查步骤、测试建议和验收标准。`},{title:"复盘摘要",detail:"整理成每日日志可用总结",icon:<FileText size={15}/>,text:`请把当前上下文《${context}》整理成复盘摘要，包括关键理解、风险、下一步和待确认问题。`}];}
function MessageContent({content}:{content:string}){const parts=content.split("```");return <div className="chat-message-content-v137">{parts.map((part,index)=>index%2?<pre key={index}><code>{part.replace(/^\w+\n/,"")}</code></pre>:part.split("\n").map((line,lineIndex)=>line.trim()?<p key={`${index}-${lineIndex}`}>{line}</p>:<div className="doc-gap" key={`${index}-${lineIndex}`}/>))}</div>;}
function scrollToBottom(node:HTMLDivElement|null){if(node)node.scrollTop=node.scrollHeight;}
