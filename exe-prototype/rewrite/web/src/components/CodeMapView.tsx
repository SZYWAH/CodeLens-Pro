import { ArrowLeft, ChevronRight, ExternalLink, FileCode2, GitBranch, Languages, List, Map as MapIcon, Menu, Network, RefreshCw, Search, Shapes, Workflow, X } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import type { CodeMap, WorkspaceDetail, WorkspaceFileHotspot } from "../types";
import type { InspectTarget } from "../utils/projectNavigation";
import { projectBasename, resolveWorkspaceDependencies } from "../utils/projectNavigation";
import { AccessibleListbox, type ListboxOption } from "./AccessibleListbox";
import { ProductToolbar } from "./ProductShell";
import { ProjectSourceInspector } from "./ProjectSourceInspector";

const ProjectDependencyGraph = lazy(() => import("./ProjectDependencyGraph").then((module) => ({ default: module.ProjectDependencyGraph })));

type Section = "overview" | "languages" | "hotspots" | "symbols" | "dependencies";
type DependencyMode = "graph" | "list";

export function CodeMapView({ activeWorkspace, codeMap, onRefresh, onBack, onOpenGuide }: {
  activeWorkspace: WorkspaceDetail | null;
  codeMap: CodeMap | null;
  onRefresh: () => void;
  onBack: () => void;
  onOpenGuide: () => void;
}) {
  const [section, setSection] = useState<Section>("overview");
  const [mobileIndex, setMobileIndex] = useState(false);
  const [query, setQuery] = useState("");
  const [language, setLanguage] = useState("all");
  const [symbolKind, setSymbolKind] = useState("all");
  const [dependencyKind, setDependencyKind] = useState("all");
  const [hotspotSort, setHotspotSort] = useState<"risk" | "complexity" | "lines" | "path">("risk");
  const [symbolLimit, setSymbolLimit] = useState(100);
  const [dependencyLimit, setDependencyLimit] = useState(100);
  const [dependencyMode, setDependencyMode] = useState<DependencyMode>("list");
  const [inspectTarget, setInspectTarget] = useState<InspectTarget | null>(null);

  useEffect(() => {
    setInspectTarget(null);
    setQuery("");
    setLanguage("all");
    setSymbolKind("all");
    setDependencyKind("all");
    setDependencyMode("list");
  }, [activeWorkspace?.summary.id]);

  const inspect = useCallback((target: InspectTarget) => setInspectTarget(target), []);
  const symbols = useMemo(() => {
    if (!codeMap) return [];
    const needle = query.toLocaleLowerCase();
    return codeMap.symbols.filter((item) => (symbolKind === "all" || item.kind === symbolKind) && (!needle || `${item.name} ${item.file_path} ${item.signature}`.toLocaleLowerCase().includes(needle))).slice(0, symbolLimit);
  }, [codeMap, query, symbolKind, symbolLimit]);
  const resolvedDependencies = useMemo(() => activeWorkspace && codeMap ? resolveWorkspaceDependencies(activeWorkspace, codeMap.dependencies) : [], [activeWorkspace, codeMap]);
  const dependencies = useMemo(() => {
    const needle = query.toLocaleLowerCase();
    return resolvedDependencies.filter((item) => (dependencyKind === "all" || item.kind === dependencyKind) && (!needle || `${item.source_path} ${item.target} ${item.targetFile?.path || ""}`.toLocaleLowerCase().includes(needle))).slice(0, dependencyLimit);
  }, [dependencyKind, dependencyLimit, query, resolvedDependencies]);
  const hotspots = useMemo(() => {
    if (!codeMap) return [];
    const needle = query.toLocaleLowerCase();
    return codeMap.hotspot_files.filter((item) => (language === "all" || item.language === language) && (!needle || item.path.toLocaleLowerCase().includes(needle))).sort((a, b) => compareHotspots(a, b, hotspotSort));
  }, [codeMap, query, language, hotspotSort]);

  if (!activeWorkspace) {
    return <section className="project-empty-v138"><MapIcon size={28}/><strong>尚未打开工作区</strong><p>返回项目总览导入一个本地项目，再查看代码地图。</p><button onClick={onBack} type="button"><ArrowLeft size={15}/>返回项目总览</button></section>;
  }

  const summary = activeWorkspace.summary;
  const counts = { overview: summary.file_count, languages: codeMap?.languages.length || 0, hotspots: codeMap?.hotspot_files.length || 0, symbols: codeMap?.symbols.length || 0, dependencies: codeMap?.dependencies.length || 0 };
  function choose(value: Section) {
    setSection(value);
    setMobileIndex(false);
    setQuery("");
  }
  function openLanguage(value: string) {
    setLanguage(value);
    setQuery("");
    setSection("hotspots");
  }

  return (
    <section className="project-understanding-v138 project-understanding-v1420 code-map-v138">
      <ProductToolbar>
        <div className="product-toolbar-context-next">{summary.name} · {summary.file_count} 文件</div>
        <nav className="product-toolbar-actions-next">
          <button onClick={onBack} type="button"><ArrowLeft size={14}/>项目总览</button>
          <button onClick={onOpenGuide} type="button"><MapIcon size={14}/>项目导览</button>
          <button className="primary-button" onClick={onRefresh} type="button"><RefreshCw size={14}/>刷新地图</button>
        </nav>
      </ProductToolbar>
      <button className="project-mobile-index-v138" onClick={() => setMobileIndex(true)} type="button"><Menu size={15}/>地图章节</button>
      <div className="project-layout-v138">
        {mobileIndex && <button className="project-index-scrim-v138" aria-label="关闭地图章节" onClick={() => setMobileIndex(false)}/>}
        <aside className={`project-index-v138 ${mobileIndex ? "is-open" : ""}`}>
          <header><strong>代码地图</strong><button aria-label="关闭地图章节" onClick={() => setMobileIndex(false)} type="button"><X size={16}/></button></header>
          <nav>{([['overview', '概览'], ['languages', '语言'], ['hotspots', '热点文件'], ['symbols', '符号'], ['dependencies', '依赖']] as [Section, string][]).map(([value, label]) => (
            <button className={section === value ? "active" : ""} key={value} onClick={() => choose(value)} type="button"><span>{iconFor(value)}</span><strong>{label}</strong><small>{counts[value]}</small></button>
          ))}</nav>
          <dl><Meta label="文件" value={summary.file_count}/><Meta label="代码行" value={summary.total_lines}/><Meta label="更新" value={summary.updated_at.slice(0, 10)}/></dl>
        </aside>

        <div className={`project-stage-v1420 ${inspectTarget ? "has-inspector" : ""}`}>
          <main className="project-content-v138 project-content-v1420">
            {!codeMap ? <MapEmpty onRefresh={onRefresh}/> : <>
              {section === "overview" && <MapOverview map={codeMap} workspace={activeWorkspace} onSection={choose} onLanguage={openLanguage}/>}
              {section === "languages" && <LanguageList map={codeMap} onLanguage={openLanguage}/>}
              {section === "hotspots" && <Hotspots items={hotspots} query={query} language={language} languages={codeMap.languages.map((item) => item.language)} sort={hotspotSort} onInspect={inspect} onQuery={setQuery} onLanguage={setLanguage} onSort={setHotspotSort}/>}
              {section === "symbols" && <Symbols items={symbols} total={codeMap.symbols.length} query={query} kind={symbolKind} kinds={[...new Set(codeMap.symbols.map((item) => item.kind))]} onInspect={inspect} onQuery={setQuery} onKind={setSymbolKind} onMore={() => setSymbolLimit((value) => value + 100)}/>}
              {section === "dependencies" && <Dependencies workspace={activeWorkspace} resolvedItems={resolvedDependencies} items={dependencies} total={resolvedDependencies.length} query={query} kind={dependencyKind} kinds={[...new Set(codeMap.dependencies.map((item) => item.kind))]} mode={dependencyMode} selectedPath={inspectTarget?.path} onInspect={inspect} onMode={setDependencyMode} onQuery={setQuery} onKind={setDependencyKind} onMore={() => setDependencyLimit((value) => value + 100)}/>}
            </>}
          </main>
          <ProjectSourceInspector workspace={activeWorkspace} target={inspectTarget} onClose={() => setInspectTarget(null)}/>
        </div>
      </div>
    </section>
  );
}

function MapEmpty({ onRefresh }: { onRefresh: () => void }) {
  return <div className="map-empty-v138"><Network size={26}/><strong>代码地图尚未加载</strong><p>加载当前工作区的语言、热点、符号和依赖索引。</p><button onClick={onRefresh} type="button"><RefreshCw size={14}/>加载代码地图</button></div>;
}

function MapOverview({ map, workspace, onSection, onLanguage }: {
  map: CodeMap;
  workspace: WorkspaceDetail;
  onSection: (section: Section) => void;
  onLanguage: (language: string) => void;
}) {
  const metrics: { section: Section; label: string; value: number }[] = [
    { section: "languages", label: "语言", value: map.languages.length },
    { section: "hotspots", label: "热点文件", value: map.hotspot_files.length },
    { section: "symbols", label: "符号", value: map.symbols.length },
    { section: "dependencies", label: "依赖", value: map.dependencies.length }
  ];
  return (
    <section className="map-overview-v138 map-overview-v1420">
      <header><span>静态扫描结果</span><h3>{workspace.summary.name}</h3><p>{workspace.summary.language_summary || "尚无语言摘要"}</p></header>
      <div className="map-metrics-v1420">{metrics.map((metric) => <button key={metric.section} onClick={() => onSection(metric.section)} type="button"><span>{metric.label}</span><strong>{metric.value}</strong><ChevronRight size={15}/></button>)}</div>
      <article><h4>主要语言</h4>{map.languages.slice(0, 8).map((item) => <button key={item.language} onClick={() => onLanguage(item.language)} type="button"><strong>{item.language}</strong><span>{item.file_count} 文件 · {item.total_lines} 行</span><ChevronRight size={14}/></button>)}</article>
    </section>
  );
}

function LanguageList({ map, onLanguage }: { map: CodeMap; onLanguage: (language: string) => void }) {
  const total = Math.max(1, map.languages.reduce((sum, item) => sum + item.total_lines, 0));
  return <section className="map-section-v138 map-section-v1420"><header><Languages size={16}/><div><strong>语言分布</strong><span>{map.languages.length} 种语言</span></div></header><div className="map-language-list-v138">{map.languages.map((item) => <button key={item.language} onClick={() => onLanguage(item.language)} type="button"><span>{item.language}</span><strong>{item.file_count} 文件</strong><small>{item.total_lines} 行 · {Math.round(item.total_lines / total * 100)}%</small><i style={{ width: `${Math.max(3, item.total_lines / total * 100)}%` }}/><ChevronRight size={14}/></button>)}</div></section>;
}

function Toolbar({ query, onQuery, children }: { query: string; onQuery: (value: string) => void; children: JSX.Element | JSX.Element[] }) {
  return <div className="map-toolbar-v138 map-toolbar-v1420"><label><Search size={14}/><input value={query} onChange={(event) => onQuery(event.target.value)} placeholder="搜索当前列表"/></label>{children}</div>;
}

function Hotspots({ items, query, language, languages, sort, onInspect, onQuery, onLanguage, onSort }: {
  items: WorkspaceFileHotspot[];
  query: string;
  language: string;
  languages: string[];
  sort: "risk" | "complexity" | "lines" | "path";
  onInspect: (target: InspectTarget) => void;
  onQuery: (value: string) => void;
  onLanguage: (value: string) => void;
  onSort: (value: "risk" | "complexity" | "lines" | "path") => void;
}) {
  const sortOptions: ListboxOption[] = [{ value: "risk", label: "风险优先" }, { value: "complexity", label: "复杂度优先" }, { value: "lines", label: "代码行优先" }, { value: "path", label: "路径排序" }];
  return <section className="map-section-v138 map-section-v1420"><header><FileCode2 size={16}/><div><strong>热点文件</strong><span>{items.length} 个结果</span></div></header><Toolbar query={query} onQuery={onQuery}><AccessibleListbox compact label="语言" value={language} onChange={onLanguage} options={[{ value: "all", label: "全部语言" }, ...languages.map((value) => ({ value, label: value }))]}/><AccessibleListbox compact label="排序" value={sort} onChange={(value) => onSort(value as typeof sort)} options={sortOptions}/></Toolbar><div className="map-table-v138 map-table-v1420 hotspots"><div className="head"><span>文件</span><span>语言</span><span>行数</span><span>复杂度</span><span>风险</span><span/></div>{items.map((item) => <button key={item.path} onClick={() => onInspect({ path: item.path, title: projectBasename(item.path), context: `复杂度 ${item.complexity_score} · 风险 ${item.risk_count}`, source: "hotspot" })} type="button"><code>{item.path}</code><span>{item.language || "文本"}</span><span>{item.total_lines}</span><span>{item.complexity_score}</span><strong>{item.risk_count}</strong><ChevronRight size={14}/></button>)}</div></section>;
}

function Symbols({ items, total, query, kind, kinds, onInspect, onQuery, onKind, onMore }: {
  items: CodeMap["symbols"];
  total: number;
  query: string;
  kind: string;
  kinds: string[];
  onInspect: (target: InspectTarget) => void;
  onQuery: (value: string) => void;
  onKind: (value: string) => void;
  onMore: () => void;
}) {
  return <section className="map-section-v138 map-section-v1420"><header><Shapes size={16}/><div><strong>符号索引</strong><span>{items.length} / {total}</span></div></header><Toolbar query={query} onQuery={onQuery}><AccessibleListbox compact label="符号类型" value={kind} onChange={onKind} options={[{ value: "all", label: "全部类型" }, ...kinds.map((value) => ({ value, label: kindLabel(value) }))]}/></Toolbar><div className="map-table-v138 map-table-v1420 symbols"><div className="head"><span>名称</span><span>类型</span><span>文件与行号</span><span>签名</span><span/></div>{items.map((item) => <button key={item.id} onClick={() => onInspect({ path: item.file_path, line: item.line, title: item.name, context: item.signature || `${kindLabel(item.kind)}声明`, source: "symbol" })} type="button"><strong>{item.name}</strong><span>{kindLabel(item.kind)}</span><code>{item.file_path}:{item.line}</code><span>{item.signature || "-"}</span><ChevronRight size={14}/></button>)}</div>{items.length < total && <button className="map-more-v138" onClick={onMore} type="button">继续显示</button>}</section>;
}

function Dependencies({ workspace, resolvedItems, items, total, query, kind, kinds, mode, selectedPath, onInspect, onMode, onQuery, onKind, onMore }: {
  workspace: WorkspaceDetail;
  resolvedItems: ReturnType<typeof resolveWorkspaceDependencies>;
  items: ReturnType<typeof resolveWorkspaceDependencies>;
  total: number;
  query: string;
  kind: string;
  kinds: string[];
  mode: DependencyMode;
  selectedPath?: string;
  onInspect: (target: InspectTarget) => void;
  onMode: (value: DependencyMode) => void;
  onQuery: (value: string) => void;
  onKind: (value: string) => void;
  onMore: () => void;
}) {
  return (
    <section className="map-section-v138 map-section-v1420 dependencies-section-v1420">
      <header>
        <GitBranch size={16}/>
        <div><strong>依赖关系</strong><span>{total} 条依赖</span></div>
        <div className="map-view-switch-v1420" role="tablist" aria-label="依赖查看方式">
          <button aria-controls="dependency-graph-panel" aria-selected={mode === "graph"} className={mode === "graph" ? "active" : ""} onClick={() => onMode("graph")} role="tab" tabIndex={mode === "graph" ? 0 : -1} type="button"><Workflow size={14}/>图谱</button>
          <button aria-controls="dependency-list-panel" aria-selected={mode === "list"} className={mode === "list" ? "active" : ""} onClick={() => onMode("list")} role="tab" tabIndex={mode === "list" ? 0 : -1} type="button"><List size={14}/>列表</button>
        </div>
      </header>
      {mode === "graph" ? (
        <div id="dependency-graph-panel" role="tabpanel">
          <Suspense fallback={<div className="dependency-graph-loading-v1420"><Network size={22}/><strong>正在建立文件依赖图</strong></div>}>
            <ProjectDependencyGraph dependencies={resolvedItems} workspace={workspace} selectedPath={selectedPath} onInspect={onInspect} onClose={() => onMode("list")}/>
          </Suspense>
        </div>
      ) : (
        <div id="dependency-list-panel" role="tabpanel">
          <Toolbar query={query} onQuery={onQuery}>
            <AccessibleListbox compact label="依赖类型" value={kind} onChange={onKind} options={[{ value: "all", label: "全部类型" }, ...kinds.map((value) => ({ value, label: dependencyLabel(value) }))]}/>
          </Toolbar>
          <div className="map-table-v138 map-table-v1420 dependencies">
            <div className="head"><span>来源</span><span>目标</span><span>类型</span><span>行号</span><span/></div>
            {items.map((item) => (
              <div className="map-dependency-row-v1420" key={item.id}>
                <button
                  className="map-dependency-source-v1420"
                  onClick={() => onInspect({ path: item.source_path, line: item.line, title: `依赖 ${item.target}`, context: item.targetFile ? `内部依赖：${item.targetFile.path}` : `外部依赖：${item.target}`, source: "dependency" })}
                  type="button"
                >
                  <code>{item.source_path}</code>
                  <strong title={item.targetFile?.path || item.target}>{item.targetFile?.path || item.target}</strong>
                  <span className={item.external ? "is-external" : "is-internal"}>{item.external ? "外部" : dependencyLabel(item.kind)}</span>
                  <span>{item.line}</span>
                  <ChevronRight size={14}/>
                </button>
                {item.targetFile && (
                  <button
                    aria-label={`打开目标文件 ${item.targetFile.path}`}
                    className="map-dependency-target-v1420"
                    onClick={() => onInspect({ path: item.targetFile!.path, line: 1, title: item.targetFile!.path, context: `由 ${item.source_path} 引用`, source: "dependency" })}
                    title="打开内部目标文件"
                    type="button"
                  >
                    <ExternalLink size={14}/>
                  </button>
                )}
              </div>
            ))}
          </div>
          {items.length < total && <button className="map-more-v138" onClick={onMore} type="button">继续显示</button>}
        </div>
      )}
    </section>
  );
}

function Meta({ label, value }: { label: string; value: string | number }) { return <div><dt>{label}</dt><dd>{value}</dd></div>; }
function iconFor(value: Section) { return value === "overview" ? <MapIcon size={14}/> : value === "languages" ? <Languages size={14}/> : value === "hotspots" ? <FileCode2 size={14}/> : value === "symbols" ? <Shapes size={14}/> : <GitBranch size={14}/>; }
function compareHotspots(a: WorkspaceFileHotspot, b: WorkspaceFileHotspot, sort: string) { if (sort === "complexity") return b.complexity_score - a.complexity_score; if (sort === "lines") return b.total_lines - a.total_lines; if (sort === "path") return a.path.localeCompare(b.path); return b.risk_count - a.risk_count || b.complexity_score - a.complexity_score; }
function kindLabel(value: string) { return ({ function: "函数", class: "类", method: "方法", binding: "变量", struct: "结构体", enum: "枚举" } as Record<string, string>)[value] || value; }
function dependencyLabel(value: string) { return ({ import: "导入", from: "来自", require: "引用", use: "使用", include: "包含" } as Record<string, string>)[value] || value; }
