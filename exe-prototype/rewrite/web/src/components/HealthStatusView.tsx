import { Archive, BarChart3, Clipboard, Database, FileText, FolderOpen, Loader2, Menu, Settings, Upload, X } from "lucide-react";
import { useState } from "react";
import type { ActivityEvent, ActivitySummary, AppHealth } from "../types";
import { ProductToolbar } from "./ProductShell";
import { formatTime } from "../utils/display";
type Section = "system" | "assets" | "storage" | "archive" | "activity";
export function HealthStatusView({ activity, busy, health, onExportArchive, onImportArchive, onOpenStorage, onOpenLogs, onOpenSettings }: {
    activity: ActivitySummary | null;
    busy: boolean;
    health: AppHealth;
    onExportArchive: () => void;
    onImportArchive: () => void;
    onOpenStorage: () => void;
    onOpenLogs: () => void;
    onOpenSettings: () => void;
}) { const [section, setSection] = useState<Section>("system"), [mobile, setMobile] = useState(false); const assets = assetStats(activity); const events = activity?.recent_events || []; const logs = events.filter(e => e.event_type === "daily_log").length; const days = trend(activity?.daily_counts || []); function choose(v: Section) { setSection(v); setMobile(false); } function importArchive() { if (window.confirm("导入档案会向本地数据库写入数据，确定继续吗？"))
    onImportArchive(); } return <section className="system-workspace-v139"><ProductToolbar><div className="product-toolbar-context-next">{health.database_ok ? "SQLite 正常" : "SQLite 异常"} · v{health.version}</div><nav className="product-toolbar-actions-next"><button onClick={onOpenSettings} type="button"><Settings size={14}/>设置</button></nav></ProductToolbar><button className="system-mobile-index-v139" onClick={() => setMobile(true)}><Menu size={15}/>状态章节</button><div className="system-layout-v139">{mobile && <button className="system-index-scrim-v139" aria-label="关闭状态章节" onClick={() => setMobile(false)}/>}<aside className={`system-index-v139 ${mobile ? "is-open" : ""}`}><header><strong>运行状态</strong><button aria-label="关闭状态章节" onClick={() => setMobile(false)}><X size={16}/></button></header><nav>{([['system', '系统'], ['assets', '数据资产'], ['storage', '存储路径'], ['archive', '档案迁移'], ['activity', '近期活动']] as [
    Section,
    string
][]).map(([v, l]) => <button className={section === v ? "active" : ""} onClick={() => choose(v)} key={v}><span>{v === "system" ? <Database size={14}/> : v === "assets" ? <BarChart3 size={14}/> : v === "storage" ? <FolderOpen size={14}/> : v === "archive" ? <Archive size={14}/> : <FileText size={14}/>}</span><strong>{l}</strong></button>)}</nav></aside><main className="system-content-v139">{section === "system" && <section className="health-section-v139"><Header title="系统状态" detail="本地数据库、模型和应用版本。"/><div className="health-system-list-v139"><Status label="SQLite" value={health.database_message} ok={health.database_ok}/><Status label="LLM" value={health.llm_enabled ? (health.llm_configured ? "已启用并配置" : "已启用，缺少 API Key") : "未启用"} ok={!health.llm_enabled || health.llm_configured}/><Status label="版本" value={health.version} ok/></div>{(!health.database_ok || health.llm_enabled && !health.llm_configured) && <div className="health-action-v139"><strong>需要处理</strong><p>{!health.database_ok ? "请检查数据库路径和写入权限。" : "请前往设置保存 API Key。"}</p><button onClick={onOpenSettings}>打开设置</button></div>}</section>}{section === "assets" && <section className="health-section-v139"><Header title="数据资产" detail="当前保存在本地 SQLite 中的主要内容。"/><dl className="health-assets-v139">{assets.map(x => <div key={x.label}><dt>{x.label}</dt><dd>{x.value}</dd></div>)}<div><dt>日志线索</dt><dd>{logs}</dd></div></dl></section>}{section === "storage" && <section className="health-section-v139"><Header title="存储路径" detail="应用数据和日志均保存在本机。"/><div className="health-paths-v139"><Path label="应用目录" value={health.app_home} onOpen={onOpenStorage}/><Path label="存储目录" value={health.storage_dir} onOpen={onOpenStorage}/><Path label="日志目录" value={health.logs_dir} onOpen={onOpenLogs}/><Path label="数据库" value={health.database_path}/></div></section>}{section === "archive" && <section className="health-section-v139"><Header title="档案迁移" detail="导出和导入本地产品档案，不包含 API Key 明文。"/><div className="health-archive-v139"><article><strong>导出档案</strong><p>生成可阅读索引和结构化 manifest，包含现有业务数据与配置状态。</p><button disabled={busy} onClick={onExportArchive}>{busy ? <Loader2 className="spin" size={14}/> : <Archive size={14}/>}导出本地档案</button></article><article><strong>导入档案</strong><p>从已有档案写入本地数据库。导入前会再次确认。</p><button disabled={busy} onClick={importArchive}>{busy ? <Loader2 className="spin" size={14}/> : <Upload size={14}/>}导入本地档案</button></article></div></section>}{section === "activity" && <section className="health-section-v139"><Header title="近期活动" detail="最近 14 天本地活动和最新事件。"/><Trend days={days}/><div className="health-events-v139">{events.slice(0, 12).map(e => <Event event={e} key={e.id}/>)}{!events.length && <p className="muted">暂无本地活动。</p>}</div></section>}</main></div></section>; }
function Header({ title, detail }: {
    title: string;
    detail: string;
}) { return <header><strong>{title}</strong><span>{detail}</span></header>; }
function Status({ label, value, ok }: {
    label: string;
    value: string;
    ok: boolean;
}) { return <article className={ok ? "ok" : "warn"}><span>{label}</span><strong>{value}</strong></article>; }
function Path({ label, value, onOpen }: {
    label: string;
    value: string;
    onOpen?: () => void;
}) { async function copy() { try {
    await navigator.clipboard.writeText(value);
}
catch { } } return <article><div><span>{label}</span><code>{value}</code></div><nav><button aria-label={`复制 ${label}`} onClick={copy}><Clipboard size={14}/></button>{onOpen && <button onClick={onOpen}><FolderOpen size={14}/>打开</button>}</nav></article>; }
function assetStats(a: ActivitySummary | null) { return [{ label: "报告", value: a?.report_count || 0 }, { label: "工作区", value: a?.workspace_count || 0 }, { label: "问题", value: a?.finding_count || 0 }, { label: "卡片", value: a?.card_count || 0 }, { label: "对话", value: a?.chat_count || 0 }]; }
function trend(items: {
    date: string;
    count: number;
}[]) { const map = new Map(items.map(x => [x.date, x.count])), today = new Date(); return Array.from({ length: 14 }, (_, i) => { const d = new Date(today); d.setDate(today.getDate() - (13 - i)); const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; return { date: key, count: map.get(key) || 0 }; }); }
function Trend({ days }: {
    days: {
        date: string;
        count: number;
    }[];
}) { const max = Math.max(1, ...days.map(x => x.count)); return <div className="health-trend-v139">{days.map(x => <div key={x.date}><i style={{ height: `${Math.max(4, x.count / max * 100)}%` }}/><span>{x.date.slice(5)}</span><strong>{x.count}</strong></div>)}</div>; }
function Event({ event }: {
    event: ActivityEvent;
}) { return <article><strong>{event.title}</strong><span>{formatTime(event.created_at)} · {eventLabel(event.event_type)}</span>{event.detail && <p>{event.detail}</p>}</article>; }
function eventLabel(v: string) { return ({ workspace: "工作区", report: "报告", finding: "问题", card: "知识卡片", card_candidate: "卡片候选", daily_log: "每日日志", guide: "项目导览", chat: "对话" } as Record<string, string>)[v] || "活动"; }
