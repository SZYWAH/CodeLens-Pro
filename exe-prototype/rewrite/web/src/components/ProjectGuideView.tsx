import { ArrowLeft, BookOpen, FileCode2, FolderTree, Layers3, Loader2, Map as MapIcon, Menu, RefreshCw, Route, X } from "lucide-react";
import { useMemo, useState } from "react";
import type { ProjectGuide, ProjectGuideItem, WorkspaceDetail } from "../types";
import { ProductToolbar } from "./ProductShell";
import { formatTime } from "../utils/display";
type Section = "overview" | "architecture" | "route" | "files" | "knowledge";
type Area = {
    name: string;
    fileCount: number;
    totalLines: number;
    languages: string[];
};
export function ProjectGuideView({ activeWorkspace, guide, busy, onGenerate, onBack, onOpenCodeMap }: {
    activeWorkspace: WorkspaceDetail | null;
    guide: ProjectGuide | null;
    busy: boolean;
    onGenerate: () => void;
    onBack: () => void;
    onOpenCodeMap: () => void;
}) {
    const [section, setSection] = useState<Section>("overview");
    const [mobileIndex, setMobileIndex] = useState(false);
    const areas = useMemo(() => activeWorkspace ? buildAreas(activeWorkspace) : [], [activeWorkspace]);
    const route = useMemo(() => activeWorkspace ? (guide?.reading_order.length ? guide.reading_order : fallbackRoute(activeWorkspace)) : [], [activeWorkspace, guide]);
    const files = useMemo(() => activeWorkspace ? (guide?.key_files.length ? guide.key_files : fallbackFiles(activeWorkspace)) : [], [activeWorkspace, guide]);
    const knowledge = useMemo(() => activeWorkspace ? buildKnowledge(activeWorkspace, guide) : [], [activeWorkspace, guide]);
    if (!activeWorkspace)
        return <section className="project-empty-v138"><MapIcon size={28}/><strong>尚未打开工作区</strong><p>返回审查工作台导入一个本地项目，再查看项目导览。</p><button onClick={onBack} type="button"><ArrowLeft size={15}/>返回审查工作台</button></section>;
    const summary = activeWorkspace.summary;
    function choose(value: Section) { setSection(value); setMobileIndex(false); }
    return <section className="project-understanding-v138">
    <ProductToolbar><div className="product-toolbar-context-next">{summary.name} · {summary.file_count} 文件</div><nav className="product-toolbar-actions-next"><button onClick={onBack} type="button"><ArrowLeft size={14}/>工作台</button><button onClick={onOpenCodeMap} type="button"><FileCode2 size={14}/>代码地图</button><button className="primary-button" disabled={busy} onClick={onGenerate} type="button">{busy ? <Loader2 className="spin" size={14}/> : guide ? <RefreshCw size={14}/> : <MapIcon size={14}/>} {guide ? "重新生成" : "生成导览"}</button></nav></ProductToolbar>
    <button className="project-mobile-index-v138" onClick={() => setMobileIndex(true)} type="button"><Menu size={15}/>导览章节</button>
    <div className="project-layout-v138">{mobileIndex && <button className="project-index-scrim-v138" aria-label="关闭导览章节" onClick={() => setMobileIndex(false)}/>}<aside className={`project-index-v138 ${mobileIndex ? "is-open" : ""}`}><header><strong>项目导览</strong><button aria-label="关闭导览章节" onClick={() => setMobileIndex(false)} type="button"><X size={16}/></button></header><nav>{([['overview', '概览', summary.file_count], ['architecture', '架构', guide?.architecture.length || areas.length], ['route', '阅读顺序', route.length], ['files', '关键文件', files.length], ['knowledge', '知识点', knowledge.length]] as [
        Section,
        string,
        number
    ][]).map(([value, label, count]) => <button className={section === value ? "active" : ""} key={value} onClick={() => choose(value)} type="button"><span>{iconFor(value)}</span><strong>{label}</strong><small>{count}</small></button>)}</nav><dl><Meta label="文件" value={summary.file_count}/><Meta label="代码行" value={summary.total_lines}/><Meta label="语言" value={summary.language_summary || "待扫描"}/><Meta label="更新" value={formatTime(summary.updated_at)}/></dl></aside>
      <main className="project-content-v138">{busy && <div className="project-progress-v138"><Loader2 className="spin" size={15}/>正在生成项目导览…</div>}{section === "overview" && <Overview guide={guide} areas={areas} workspace={activeWorkspace}/>} {section === "architecture" && <GuideItems title="架构摘要" icon={<Layers3 size={16}/>} items={guide?.architecture.length ? guide.architecture : areas.map(a => ({ title: a.name, detail: `${a.fileCount} 个文件 / ${a.totalLines} 行 / ${a.languages.join('、') || '未知语言'}` }))}/>} {section === "route" && <RouteView items={route}/>} {section === "files" && <FileTable items={files}/>} {section === "knowledge" && <Knowledge items={knowledge}/>}</main>
    </div>
  </section>;
}
function Overview({ guide, areas, workspace }: {
    guide: ProjectGuide | null;
    areas: Area[];
    workspace: WorkspaceDetail;
}) { return <article className="project-overview-v138"><header><span>{guide ? `生成于 ${formatTime(guide.generated_at)}` : "本地文件快照"}</span><h3>{guide?.title || workspace.summary.name}</h3><p>{guide?.summary || `已扫描 ${workspace.summary.file_count} 个文件和 ${workspace.summary.total_lines} 行代码。生成正式导览后可获得完整架构摘要与阅读路线。`}</p></header><section><h4>核心区域</h4>{areas.map(a => <div key={a.name}><strong>{a.name}</strong><span>{a.fileCount} 文件 · {a.totalLines} 行</span><small>{a.languages.join(" / ") || "未知语言"}</small></div>)}</section></article>; }
function GuideItems({ title, icon, items }: {
    title: string;
    icon: JSX.Element;
    items: ProjectGuideItem[];
}) { return <section className="project-section-v138"><header>{icon}<div><strong>{title}</strong><span>{items.length} 项</span></div></header><div className="guide-items-v138">{items.map((item, index) => <article key={`${item.title}-${index}`}><span>{index + 1}</span><div><strong>{item.title}</strong><p>{item.detail}</p>{item.path && <code>{item.path}</code>}</div></article>)}{!items.length && <p className="muted">暂无内容。</p>}</div></section>; }
function RouteView({ items }: {
    items: ProjectGuideItem[];
}) { return <GuideItems title="推荐阅读顺序" icon={<Route size={16}/>} items={items}/>; }
function FileTable({ items }: {
    items: ProjectGuideItem[];
}) { return <section className="project-section-v138"><header><FileCode2 size={16}/><div><strong>关键文件</strong><span>{items.length} 个</span></div></header><div className="project-table-v138"><div className="head"><span>文件</span><span>关注点</span></div>{items.map((item, index) => <div key={`${item.title}-${index}`}><code>{item.path || item.title}</code><span>{item.detail}</span></div>)}</div></section>; }
function Knowledge({ items }: {
    items: string[];
}) { return <section className="project-section-v138"><header><BookOpen size={16}/><div><strong>建议复习的知识点</strong><span>{items.length} 项</span></div></header><div className="knowledge-list-v138">{items.map(item => <span key={item}>{item}</span>)}{!items.length && <p className="muted">暂无可推断知识点。</p>}</div></section>; }
function Meta({ label, value }: {
    label: string;
    value: string | number;
}) { return <div><dt>{label}</dt><dd>{value}</dd></div>; }
function iconFor(value: Section) { return value === "overview" ? <MapIcon size={14}/> : value === "architecture" ? <Layers3 size={14}/> : value === "route" ? <Route size={14}/> : value === "files" ? <FileCode2 size={14}/> : <BookOpen size={14}/>; }
function buildAreas(w: WorkspaceDetail) { const map = new Map<string, {
    files: number;
    lines: number;
    languages: Set<string>;
}>(); for (const f of w.files) {
    const name = f.path.replace(/\\/g, "/").split("/").filter(Boolean)[0] || "根目录";
    const a = map.get(name) || { files: 0, lines: 0, languages: new Set<string>() };
    a.files++;
    a.lines += f.metrics.total_lines;
    if (f.language)
        a.languages.add(f.language);
    map.set(name, a);
} return [...map].map(([name, a]) => ({ name, fileCount: a.files, totalLines: a.lines, languages: [...a.languages].slice(0, 3) })).sort((a, b) => b.fileCount - a.fileCount || b.totalLines - a.totalLines).slice(0, 12); }
function fallbackRoute(w: WorkspaceDetail) { return [...w.files].sort((a, b) => b.metrics.complexity_score - a.metrics.complexity_score || b.metrics.total_lines - a.metrics.total_lines).slice(0, 8).map((f, i) => ({ title: `第 ${i + 1} 步：阅读 ${f.path.split(/[\\/]/).pop() || f.path}`, detail: `关注 ${f.language || '文本'} 结构、复杂度 ${f.metrics.complexity_score} 和 ${f.metrics.risk_count} 个风险点。`, path: f.path })); }
function fallbackFiles(w: WorkspaceDetail) { return [...w.files].sort((a, b) => b.metrics.risk_count - a.metrics.risk_count || b.metrics.complexity_score - a.metrics.complexity_score).slice(0, 12).map(f => ({ title: f.path.split(/[\\/]/).pop() || f.path, detail: `${f.language || '文本'} · ${f.metrics.total_lines} 行 · 复杂度 ${f.metrics.complexity_score} · 风险 ${f.metrics.risk_count}`, path: f.path })); }
function buildKnowledge(w: WorkspaceDetail, g: ProjectGuide | null) { const set = new Set<string>(); for (const item of g?.architecture || []) {
    const t = `${item.title} ${item.detail}`;
    if (/API|接口|路由/i.test(t))
        set.add("接口设计与请求链路");
    if (/SQL|SQLite|数据库|存储/i.test(t))
        set.add("本地数据建模");
} for (const f of w.files) {
    const p = f.path.toLowerCase();
    if (/\.(tsx|jsx|vue)$/.test(p))
        set.add("前端组件与状态管理");
    if (/\.rs$/.test(p))
        set.add("Rust 模块与错误处理");
    if (/\.py$/.test(p))
        set.add("Python 服务与脚本结构");
    if (/test|spec/.test(p))
        set.add("测试设计");
    if (/config|settings|env/.test(p))
        set.add("配置管理");
} return [...set].slice(0, 12); }
