import { ArrowLeft, BookOpen, ChevronRight, FileCode2, FolderTree, Layers3, Loader2, Map as MapIcon, Menu, RefreshCw, Route, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { CodeMap, ProjectGuide, ProjectGuideItem, WorkspaceDetail, WorkspaceFile } from "../types";
import type { InspectTarget } from "../utils/projectNavigation";
import { findWorkspaceFile, projectBasename, topLevelArea } from "../utils/projectNavigation";
import { formatTime } from "../utils/display";
import { ProductToolbar } from "./ProductShell";
import { ProjectSourceInspector } from "./ProjectSourceInspector";

type Section = "overview" | "architecture" | "route" | "files" | "knowledge";
type Area = {
  name: string;
  files: WorkspaceFile[];
  fileCount: number;
  totalLines: number;
  languages: string[];
};
type KnowledgeItem = { label: string; path?: string };

export function ProjectGuideView({ activeWorkspace, codeMap, guide, busy, onGenerate, onBack, onOpenCodeMap }: {
  activeWorkspace: WorkspaceDetail | null;
  codeMap: CodeMap | null;
  guide: ProjectGuide | null;
  busy: boolean;
  onGenerate: () => void;
  onBack: () => void;
  onOpenCodeMap: () => void;
}) {
  const [section, setSection] = useState<Section>("overview");
  const [mobileIndex, setMobileIndex] = useState(false);
  const [inspectTarget, setInspectTarget] = useState<InspectTarget | null>(null);
  const [expandedArea, setExpandedArea] = useState<string | null>(null);
  const areas = useMemo(() => activeWorkspace ? buildAreas(activeWorkspace) : [], [activeWorkspace]);
  const route = useMemo(() => activeWorkspace ? (guide?.reading_order.length ? guide.reading_order : fallbackRoute(activeWorkspace)) : [], [activeWorkspace, guide]);
  const files = useMemo(() => activeWorkspace ? (guide?.key_files.length ? guide.key_files : fallbackFiles(activeWorkspace)) : [], [activeWorkspace, guide]);
  const knowledge = useMemo(() => activeWorkspace ? buildKnowledge(activeWorkspace, guide) : [], [activeWorkspace, guide]);

  useEffect(() => {
    setInspectTarget(null);
    setExpandedArea(null);
  }, [activeWorkspace?.summary.id]);

  const inspect = useCallback((target: InspectTarget) => setInspectTarget(target), []);

  if (!activeWorkspace) {
    return <section className="project-empty-v138"><MapIcon size={28}/><strong>尚未打开工作区</strong><p>返回项目总览导入一个本地项目，再查看项目导览。</p><button onClick={onBack} type="button"><ArrowLeft size={15}/>返回项目总览</button></section>;
  }

  const summary = activeWorkspace.summary;
  function choose(value: Section) {
    setSection(value);
    setMobileIndex(false);
  }
  function openArea(area: Area) {
    setExpandedArea(area.name);
    choose("architecture");
  }

  return (
    <section className="project-understanding-v138 project-understanding-v1420">
      <ProductToolbar>
        <div className="product-toolbar-context-next">{summary.name} · {summary.file_count} 文件</div>
        <nav className="product-toolbar-actions-next">
          <button onClick={onBack} type="button"><ArrowLeft size={14}/>项目总览</button>
          <button onClick={onOpenCodeMap} type="button"><FileCode2 size={14}/>代码地图</button>
          <button className="primary-button" disabled={busy} onClick={onGenerate} type="button">{busy ? <Loader2 className="spin" size={14}/> : guide ? <RefreshCw size={14}/> : <MapIcon size={14}/>} {guide ? "重新生成" : "生成导览"}</button>
        </nav>
      </ProductToolbar>
      <button className="project-mobile-index-v138" onClick={() => setMobileIndex(true)} type="button"><Menu size={15}/>导览章节</button>
      <div className="project-layout-v138">
        {mobileIndex && <button className="project-index-scrim-v138" aria-label="关闭导览章节" onClick={() => setMobileIndex(false)}/>}
        <aside className={`project-index-v138 ${mobileIndex ? "is-open" : ""}`}>
          <header><strong>项目导览</strong><button aria-label="关闭导览章节" onClick={() => setMobileIndex(false)} type="button"><X size={16}/></button></header>
          <nav>{([['overview', '概览', summary.file_count], ['architecture', '架构', guide?.architecture.length || areas.length], ['route', '阅读顺序', route.length], ['files', '关键文件', files.length], ['knowledge', '知识点', knowledge.length]] as [Section, string, number][]).map(([value, label, count]) => (
            <button className={section === value ? "active" : ""} key={value} onClick={() => choose(value)} type="button"><span>{iconFor(value)}</span><strong>{label}</strong><small>{count}</small></button>
          ))}</nav>
          <dl><Meta label="文件" value={summary.file_count}/><Meta label="代码行" value={summary.total_lines}/><Meta label="语言" value={summary.language_summary || "待扫描"}/><Meta label="更新" value={formatTime(summary.updated_at)}/></dl>
        </aside>

        <div className={`project-stage-v1420 ${inspectTarget ? "has-inspector" : ""}`}>
          <main className="project-content-v138 project-content-v1420">
            {busy && <div className="project-progress-v138"><Loader2 className="spin" size={15}/>正在生成项目导览…</div>}
            {section === "overview" && <Overview guide={guide} areas={areas} workspace={activeWorkspace} onOpenArea={openArea}/>}
            {section === "architecture" && <ArchitectureView areas={areas} codeMap={codeMap} expandedArea={expandedArea} guide={guide} onExpandedArea={setExpandedArea} onInspect={inspect}/>}
            {section === "route" && <RouteView items={route} workspace={activeWorkspace} onInspect={inspect}/>}
            {section === "files" && <FileTable items={files} onInspect={inspect}/>}
            {section === "knowledge" && <Knowledge items={knowledge} onInspect={inspect}/>}
          </main>
          <ProjectSourceInspector workspace={activeWorkspace} target={inspectTarget} onClose={() => setInspectTarget(null)}/>
        </div>
      </div>
    </section>
  );
}

function Overview({ guide, areas, workspace, onOpenArea }: {
  guide: ProjectGuide | null;
  areas: Area[];
  workspace: WorkspaceDetail;
  onOpenArea: (area: Area) => void;
}) {
  return (
    <article className="project-overview-v138 project-overview-v1420">
      <header><span>{guide ? `生成于 ${formatTime(guide.generated_at)}` : "本地文件快照"}</span><h3>{guide?.title || workspace.summary.name}</h3><p>{guide?.summary || `已扫描 ${workspace.summary.file_count} 个文件和 ${workspace.summary.total_lines} 行代码。先从核心区域进入源码，生成正式导览后可获得更完整的架构说明与阅读路线。`}</p></header>
      <section><h4>核心区域</h4><div className="project-area-grid-v1420">{areas.map((area) => (
        <button key={area.name} onClick={() => onOpenArea(area)} type="button">
          <span><FolderTree size={15}/><strong>{area.name}</strong></span>
          <small>{area.fileCount} 文件 · {area.totalLines} 行</small>
          <em>{area.languages.join(" / ") || "未知语言"}</em>
          <ChevronRight size={15}/>
        </button>
      ))}</div></section>
    </article>
  );
}

function ArchitectureView({ areas, codeMap, expandedArea, guide, onExpandedArea, onInspect }: {
  areas: Area[];
  codeMap: CodeMap | null;
  expandedArea: string | null;
  guide: ProjectGuide | null;
  onExpandedArea: (value: string | null) => void;
  onInspect: (target: InspectTarget) => void;
}) {
  return (
    <section className="project-section-v138 project-section-v1420">
      <header><Layers3 size={16}/><div><strong>项目架构</strong><span>{areas.length} 个核心区域</span></div></header>
      <div className="project-architecture-v1420">
        {areas.map((area) => {
          const open = expandedArea === area.name;
          const guideItem = guide?.architecture.find((item) => item.path ? topLevelArea(item.path) === area.name : `${item.title} ${item.detail}`.toLocaleLowerCase().includes(area.name.toLocaleLowerCase()));
          const dependencyCount = codeMap?.dependencies.filter((item) => topLevelArea(item.source_path) === area.name).length || 0;
          const representative = [...area.files].sort((a, b) => b.metrics.risk_count - a.metrics.risk_count || b.metrics.complexity_score - a.metrics.complexity_score).slice(0, 8);
          return (
            <article className={open ? "is-open" : ""} key={area.name}>
              <button aria-expanded={open} onClick={() => onExpandedArea(open ? null : area.name)} type="button">
                <span><FolderTree size={16}/><strong>{area.name}</strong></span>
                <small>{area.fileCount} 文件 · {dependencyCount} 条依赖 · {area.languages.join(" / ") || "未知语言"}</small>
                <ChevronRight size={16}/>
              </button>
              {open && <div><p>{guideItem?.detail || `该区域包含 ${area.fileCount} 个文件、${area.totalLines} 行代码。建议先阅读复杂度或风险较高的代表文件，再沿依赖关系向外展开。`}</p><div className="project-representative-files-v1420">{representative.map((file) => (
                <button key={file.id} onClick={() => onInspect({ path: file.path, title: projectBasename(file.path), context: `${area.name} 的代表文件`, source: "guide" })} type="button">
                  <code>{file.path}</code><span>{file.language || "文本"} · {file.metrics.total_lines} 行</span><small>复杂度 {file.metrics.complexity_score} · 风险 {file.metrics.risk_count}</small>
                </button>
              ))}</div></div>}
            </article>
          );
        })}
      </div>
    </section>
  );
}

function RouteView({ items, workspace, onInspect }: { items: ProjectGuideItem[]; workspace: WorkspaceDetail; onInspect: (target: InspectTarget) => void }) {
  return (
    <section className="project-section-v138 project-section-v1420"><header><Route size={16}/><div><strong>推荐阅读顺序</strong><span>{items.length} 步</span></div></header>
      <ol className="project-route-v1420">{items.map((item, index) => (
        <li key={`${item.title}-${index}`}><span>{index + 1}</span><div><strong>{item.title}</strong><p>{item.detail}</p>{item.path && <button onClick={() => { const file = findWorkspaceFile(workspace, item.path!); onInspect({ path: item.path!, line: file ? detectEntryLine(file) : 1, title: item.title, context: `阅读路线第 ${index + 1} 步`, source: "guide" }); }} type="button"><FileCode2 size={14}/><code>{item.path}</code><ChevronRight size={14}/></button>}</div></li>
      ))}{!items.length && <p className="muted">暂无内容。</p>}</ol>
    </section>
  );
}

function FileTable({ items, onInspect }: { items: ProjectGuideItem[]; onInspect: (target: InspectTarget) => void }) {
  return (
    <section className="project-section-v138 project-section-v1420"><header><FileCode2 size={16}/><div><strong>关键文件</strong><span>{items.length} 个</span></div></header>
      <div className="project-table-v138 project-file-table-v1420"><div className="head"><span>文件</span><span>关注点</span><span aria-hidden="true"/></div>{items.map((item, index) => (
        item.path ? <button key={`${item.title}-${index}`} onClick={() => onInspect({ path: item.path!, title: item.title, context: item.detail, source: "guide" })} type="button"><code>{item.path}</code><span>{item.detail}</span><ChevronRight size={15}/></button> : <div key={`${item.title}-${index}`}><strong>{item.title}</strong><span>{item.detail}</span><span/></div>
      ))}</div>
    </section>
  );
}

function Knowledge({ items, onInspect }: { items: KnowledgeItem[]; onInspect: (target: InspectTarget) => void }) {
  return <section className="project-section-v138 project-section-v1420"><header><BookOpen size={16}/><div><strong>建议复习的知识点</strong><span>{items.length} 项</span></div></header><p className="project-section-intro-v1420">知识点来自当前文件类型与导览摘要；没有可靠文件来源时不会提供跳转。</p><div className="knowledge-list-v138">{items.map((item) => item.path ? <button key={item.label} onClick={() => onInspect({ path: item.path!, title: item.label, context: "知识点来源文件", source: "guide" })} type="button"><span>{item.label}</span><FileCode2 size={13}/></button> : <span key={item.label}>{item.label}</span>)}{!items.length && <p className="muted">暂无可推断知识点。</p>}</div></section>;
}

function Meta({ label, value }: { label: string; value: string | number }) { return <div><dt>{label}</dt><dd>{value}</dd></div>; }
function iconFor(value: Section) { return value === "overview" ? <MapIcon size={14}/> : value === "architecture" ? <Layers3 size={14}/> : value === "route" ? <Route size={14}/> : value === "files" ? <FileCode2 size={14}/> : <BookOpen size={14}/>; }

function buildAreas(workspace: WorkspaceDetail): Area[] {
  const areas = new Map<string, WorkspaceFile[]>();
  for (const file of workspace.files) {
    const name = topLevelArea(file.path);
    areas.set(name, [...(areas.get(name) || []), file]);
  }
  return [...areas].map(([name, files]) => ({
    name,
    files,
    fileCount: files.length,
    totalLines: files.reduce((sum, file) => sum + file.metrics.total_lines, 0),
    languages: [...new Set(files.map((file) => file.language).filter(Boolean))].slice(0, 4)
  })).sort((a, b) => b.fileCount - a.fileCount || b.totalLines - a.totalLines);
}

function fallbackRoute(workspace: WorkspaceDetail): ProjectGuideItem[] {
  return [...workspace.files].sort((a, b) => b.metrics.complexity_score - a.metrics.complexity_score || b.metrics.total_lines - a.metrics.total_lines).slice(0, 8).map((file, index) => ({
    title: `第 ${index + 1} 步：阅读 ${projectBasename(file.path)}`,
    detail: `关注 ${file.language || "文本"} 结构、复杂度 ${file.metrics.complexity_score} 和 ${file.metrics.risk_count} 个风险点。`,
    path: file.path
  }));
}

function fallbackFiles(workspace: WorkspaceDetail): ProjectGuideItem[] {
  return [...workspace.files].sort((a, b) => b.metrics.risk_count - a.metrics.risk_count || b.metrics.complexity_score - a.metrics.complexity_score).slice(0, 12).map((file) => ({
    title: projectBasename(file.path),
    detail: `${file.language || "文本"} · ${file.metrics.total_lines} 行 · 复杂度 ${file.metrics.complexity_score} · 风险 ${file.metrics.risk_count}`,
    path: file.path
  }));
}

function buildKnowledge(workspace: WorkspaceDetail, guide: ProjectGuide | null): KnowledgeItem[] {
  const result = new Map<string, string | undefined>();
  const add = (label: string, path?: string | null) => {
    const reliablePath = path && findWorkspaceFile(workspace, path) ? path : undefined;
    if (!result.has(label) || (!result.get(label) && reliablePath)) result.set(label, reliablePath);
  };
  for (const item of guide?.architecture || []) {
    const text = `${item.title} ${item.detail}`;
    if (/API|接口|路由/i.test(text)) add("接口设计与请求链路", item.path);
    if (/SQL|SQLite|数据库|存储/i.test(text)) add("本地数据建模", item.path);
  }
  for (const file of workspace.files) {
    const path = file.path.toLocaleLowerCase();
    if (/\.(tsx|jsx|vue)$/.test(path)) add("前端组件与状态管理", file.path);
    if (/\.rs$/.test(path)) add("Rust 模块与错误处理", file.path);
    if (/\.py$/.test(path)) add("Python 服务与脚本结构", file.path);
    if (/test|spec/.test(path)) add("测试设计", file.path);
    if (/config|settings|env/.test(path)) add("配置管理", file.path);
  }
  return [...result].slice(0, 12).map(([label, path]) => ({ label, path }));
}

function detectEntryLine(file: WorkspaceFile): number {
  const patterns = [
    /^\s*(?:export\s+)?(?:async\s+)?function\s+/,
    /^\s*(?:export\s+)?(?:default\s+)?class\s+/,
    /^\s*(?:pub\s+)?(?:async\s+)?fn\s+/,
    /^\s*(?:def|class)\s+/,
    /^\s*(?:int|void|char|float|double|auto|class|struct)\s+[A-Za-z_][\w:<>]*\s*[({]/
  ];
  const lines = file.content.replace(/\r\n/g, "\n").split("\n");
  const index = lines.findIndex((line) => patterns.some((pattern) => pattern.test(line)));
  return index >= 0 ? index + 1 : 1;
}
