import { ArrowLeft, FileCode2, GitBranch, Languages, Map as MapIcon, Menu, Network, RefreshCw, Search, Shapes, X } from "lucide-react";
import { useMemo, useState } from "react";
import type { CodeMap, WorkspaceDetail, WorkspaceFileHotspot } from "../types";
import { ProductToolbar } from "./ProductShell";
type Section = "overview" | "languages" | "hotspots" | "symbols" | "dependencies";
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
    const symbols = useMemo(() => { if (!codeMap)
        return []; const q = query.toLowerCase(); return codeMap.symbols.filter(x => (symbolKind === "all" || x.kind === symbolKind) && (!q || `${x.name} ${x.file_path} ${x.signature}`.toLowerCase().includes(q))).slice(0, symbolLimit); }, [codeMap, query, symbolKind, symbolLimit]);
    const dependencies = useMemo(() => { if (!codeMap)
        return []; const q = query.toLowerCase(); return codeMap.dependencies.filter(x => (dependencyKind === "all" || x.kind === dependencyKind) && (!q || `${x.source_path} ${x.target}`.toLowerCase().includes(q))).slice(0, dependencyLimit); }, [codeMap, query, dependencyKind, dependencyLimit]);
    const hotspots = useMemo(() => { if (!codeMap)
        return []; const q = query.toLowerCase(); return codeMap.hotspot_files.filter(x => (language === "all" || x.language === language) && (!q || x.path.toLowerCase().includes(q))).sort((a, b) => compareHotspots(a, b, hotspotSort)); }, [codeMap, query, language, hotspotSort]);
    if (!activeWorkspace)
        return <section className="project-empty-v138"><MapIcon size={28}/><strong>尚未打开工作区</strong><p>返回审查工作台导入一个本地项目，再查看代码地图。</p><button onClick={onBack} type="button"><ArrowLeft size={15}/>返回审查工作台</button></section>;
    const summary = activeWorkspace.summary;
    const counts = { overview: summary.file_count, languages: codeMap?.languages.length || 0, hotspots: codeMap?.hotspot_files.length || 0, symbols: codeMap?.symbols.length || 0, dependencies: codeMap?.dependencies.length || 0 };
    function choose(value: Section) { setSection(value); setMobileIndex(false); setQuery(""); }
    return <section className="project-understanding-v138 code-map-v138"><ProductToolbar><div className="product-toolbar-context-next">{summary.name} · {summary.file_count} 文件</div><nav className="product-toolbar-actions-next"><button onClick={onBack} type="button"><ArrowLeft size={14}/>工作台</button><button onClick={onOpenGuide} type="button"><MapIcon size={14}/>项目导览</button><button className="primary-button" onClick={onRefresh} type="button"><RefreshCw size={14}/>刷新地图</button></nav></ProductToolbar><button className="project-mobile-index-v138" onClick={() => setMobileIndex(true)} type="button"><Menu size={15}/>地图章节</button><div className="project-layout-v138">{mobileIndex && <button className="project-index-scrim-v138" aria-label="关闭地图章节" onClick={() => setMobileIndex(false)}/>}<aside className={`project-index-v138 ${mobileIndex ? "is-open" : ""}`}><header><strong>代码地图</strong><button aria-label="关闭地图章节" onClick={() => setMobileIndex(false)} type="button"><X size={16}/></button></header><nav>{([['overview', '概览'], ['languages', '语言'], ['hotspots', '热点文件'], ['symbols', '符号'], ['dependencies', '依赖']] as [
        Section,
        string
    ][]).map(([value, label]) => <button className={section === value ? "active" : ""} key={value} onClick={() => choose(value)} type="button"><span>{iconFor(value)}</span><strong>{label}</strong><small>{counts[value]}</small></button>)}</nav><dl><Meta label="文件" value={summary.file_count}/><Meta label="代码行" value={summary.total_lines}/><Meta label="更新" value={summary.updated_at.slice(0, 10)}/></dl></aside><main className="project-content-v138">{!codeMap ? <MapEmpty onRefresh={onRefresh}/> : <>{section === "overview" && <MapOverview map={codeMap} workspace={activeWorkspace}/>} {section === "languages" && <LanguageList map={codeMap}/>} {section === "hotspots" && <Hotspots items={hotspots} query={query} language={language} languages={codeMap.languages.map(x => x.language)} sort={hotspotSort} onQuery={setQuery} onLanguage={setLanguage} onSort={setHotspotSort}/>} {section === "symbols" && <Symbols items={symbols} total={codeMap.symbols.length} query={query} kind={symbolKind} kinds={[...new Set(codeMap.symbols.map(x => x.kind))]} onQuery={setQuery} onKind={setSymbolKind} onMore={() => setSymbolLimit(x => x + 100)}/>} {section === "dependencies" && <Dependencies items={dependencies} total={codeMap.dependencies.length} query={query} kind={dependencyKind} kinds={[...new Set(codeMap.dependencies.map(x => x.kind))]} onQuery={setQuery} onKind={setDependencyKind} onMore={() => setDependencyLimit(x => x + 100)}/>}</>}</main></div></section>;
}
function MapEmpty({ onRefresh }: {
    onRefresh: () => void;
}) { return <div className="map-empty-v138"><Network size={26}/><strong>代码地图尚未加载</strong><p>加载当前工作区的语言、热点、符号和依赖索引。</p><button onClick={onRefresh} type="button"><RefreshCw size={14}/>加载代码地图</button></div>; }
function MapOverview({ map, workspace }: {
    map: CodeMap;
    workspace: WorkspaceDetail;
}) { return <section className="map-overview-v138"><header><span>静态扫描结果</span><h3>{workspace.summary.name}</h3><p>{workspace.summary.language_summary || "尚无语言摘要"}</p></header><dl><Meta label="语言" value={map.languages.length}/><Meta label="热点文件" value={map.hotspot_files.length}/><Meta label="符号" value={map.symbols.length}/><Meta label="依赖" value={map.dependencies.length}/></dl><article><h4>主要语言</h4>{map.languages.slice(0, 6).map(x => <div key={x.language}><strong>{x.language}</strong><span>{x.file_count} 文件 · {x.total_lines} 行</span></div>)}</article></section>; }
function LanguageList({ map }: {
    map: CodeMap;
}) { const total = Math.max(1, map.languages.reduce((s, x) => s + x.total_lines, 0)); return <section className="map-section-v138"><header><Languages size={16}/><div><strong>语言分布</strong><span>{map.languages.length} 种语言</span></div></header><div className="map-language-list-v138">{map.languages.map(x => <div key={x.language}><span>{x.language}</span><strong>{x.file_count} 文件</strong><small>{x.total_lines} 行 · {Math.round(x.total_lines / total * 100)}%</small><i style={{ width: `${Math.max(3, x.total_lines / total * 100)}%` }}/></div>)}</div></section>; }
function Toolbar({ query, onQuery, children }: {
    query: string;
    onQuery: (v: string) => void;
    children: JSX.Element | JSX.Element[];
}) { return <div className="map-toolbar-v138"><label><Search size={14}/><input value={query} onChange={e => onQuery(e.target.value)} placeholder="搜索当前列表"/></label>{children}</div>; }
function Hotspots({ items, query, language, languages, sort, onQuery, onLanguage, onSort }: {
    items: WorkspaceFileHotspot[];
    query: string;
    language: string;
    languages: string[];
    sort: "risk" | "complexity" | "lines" | "path";
    onQuery: (v: string) => void;
    onLanguage: (v: string) => void;
    onSort: (v: "risk" | "complexity" | "lines" | "path") => void;
}) { return <section className="map-section-v138"><header><FileCode2 size={16}/><div><strong>热点文件</strong><span>{items.length} 个结果</span></div></header><Toolbar query={query} onQuery={onQuery}><select value={language} onChange={e => onLanguage(e.target.value)}><option value="all">全部语言</option>{languages.map(x => <option key={x}>{x}</option>)}</select><select value={sort} onChange={e => onSort(e.target.value as typeof sort)}><option value="risk">风险优先</option><option value="complexity">复杂度优先</option><option value="lines">代码行优先</option><option value="path">路径排序</option></select></Toolbar><div className="map-table-v138 hotspots"><div className="head"><span>文件</span><span>语言</span><span>行数</span><span>复杂度</span><span>风险</span></div>{items.map(x => <div key={x.path}><code>{x.path}</code><span>{x.language || "文本"}</span><span>{x.total_lines}</span><span>{x.complexity_score}</span><strong>{x.risk_count}</strong></div>)}</div></section>; }
function Symbols({ items, total, query, kind, kinds, onQuery, onKind, onMore }: {
    items: CodeMap["symbols"];
    total: number;
    query: string;
    kind: string;
    kinds: string[];
    onQuery: (v: string) => void;
    onKind: (v: string) => void;
    onMore: () => void;
}) { return <section className="map-section-v138"><header><Shapes size={16}/><div><strong>符号索引</strong><span>{items.length} / {total}</span></div></header><Toolbar query={query} onQuery={onQuery}><select value={kind} onChange={e => onKind(e.target.value)}><option value="all">全部类型</option>{kinds.map(x => <option key={x}>{kindLabel(x)}</option>)}</select></Toolbar><div className="map-table-v138 symbols"><div className="head"><span>名称</span><span>类型</span><span>文件与行号</span><span>签名</span></div>{items.map(x => <div key={x.id}><strong>{x.name}</strong><span>{kindLabel(x.kind)}</span><code>{x.file_path}:{x.line}</code><span>{x.signature || "-"}</span></div>)}</div>{items.length < total && <button className="map-more-v138" onClick={onMore} type="button">继续显示</button>}</section>; }
function Dependencies({ items, total, query, kind, kinds, onQuery, onKind, onMore }: {
    items: CodeMap["dependencies"];
    total: number;
    query: string;
    kind: string;
    kinds: string[];
    onQuery: (v: string) => void;
    onKind: (v: string) => void;
    onMore: () => void;
}) { return <section className="map-section-v138"><header><GitBranch size={16}/><div><strong>依赖索引</strong><span>{items.length} / {total}</span></div></header><Toolbar query={query} onQuery={onQuery}><select value={kind} onChange={e => onKind(e.target.value)}><option value="all">全部类型</option>{kinds.map(x => <option key={x}>{dependencyLabel(x)}</option>)}</select></Toolbar><div className="map-table-v138 dependencies"><div className="head"><span>来源</span><span>目标</span><span>类型</span><span>行号</span></div>{items.map(x => <div key={x.id}><code>{x.source_path}</code><strong>{x.target}</strong><span>{dependencyLabel(x.kind)}</span><span>{x.line}</span></div>)}</div>{items.length < total && <button className="map-more-v138" onClick={onMore} type="button">继续显示</button>}</section>; }
function Meta({ label, value }: {
    label: string;
    value: string | number;
}) { return <div><dt>{label}</dt><dd>{value}</dd></div>; }
function iconFor(v: Section) { return v === "overview" ? <MapIcon size={14}/> : v === "languages" ? <Languages size={14}/> : v === "hotspots" ? <FileCode2 size={14}/> : v === "symbols" ? <Shapes size={14}/> : <GitBranch size={14}/>; }
function compareHotspots(a: WorkspaceFileHotspot, b: WorkspaceFileHotspot, sort: string) { if (sort === "complexity")
    return b.complexity_score - a.complexity_score; if (sort === "lines")
    return b.total_lines - a.total_lines; if (sort === "path")
    return a.path.localeCompare(b.path); return b.risk_count - a.risk_count || b.complexity_score - a.complexity_score; }
function kindLabel(v: string) { return ({ function: "函数", class: "类", method: "方法", binding: "变量", struct: "结构体", enum: "枚举" } as Record<string, string>)[v] || v; }
function dependencyLabel(v: string) { return ({ import: "导入", from: "来自", require: "引用", use: "使用", include: "包含" } as Record<string, string>)[v] || v; }
