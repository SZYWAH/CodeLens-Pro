import { FileCode2, GitBranch, Layers3, Network, RefreshCw, Route, Shapes } from "lucide-react";
import type { ReactNode } from "react";
import type { CodeMap, WorkspaceDetail } from "../types";

export function CodeMapView({ activeWorkspace, codeMap, onRefresh }: { activeWorkspace: WorkspaceDetail | null; codeMap: CodeMap | null; onRefresh: () => void }) {
  if (!activeWorkspace) {
    return <div className="empty">请先打开一个工作区。</div>;
  }

  const totalSymbols = codeMap?.symbols.length || 0;
  const totalDependencies = codeMap?.dependencies.length || 0;
  const totalHotspots = codeMap?.hotspot_files.length || 0;
  const totalLanguages = codeMap?.languages.length || 0;

  return (
    <section className="code-map-page-next">
      <div className="code-map-hero-next">
        <div>
          <span>代码地图</span>
          <h3>{activeWorkspace.summary.name}</h3>
          <p>把轻量静态扫描结果组织为语言分布、热点文件、符号索引和依赖路径，作为项目导览、问题审查和 Agent 上下文的入口。</p>
        </div>
        <button className="primary-button" onClick={onRefresh}>
          <RefreshCw size={18} />
          刷新代码地图
        </button>
      </div>

      <section className="code-map-dashboard-next">
        <MapMetric icon={<Layers3 size={16} />} label="语言" value={totalLanguages} />
        <MapMetric icon={<FileCode2 size={16} />} label="热点文件" value={totalHotspots} />
        <MapMetric icon={<Shapes size={16} />} label="符号" value={totalSymbols} />
        <MapMetric icon={<Network size={16} />} label="依赖" value={totalDependencies} />
      </section>

      {codeMap ? (
        <>
          <section className="code-map-route-next">
            <RouteStep index={1} title="先看语言分布" detail="确认项目技术栈和主要代码区域。" />
            <RouteStep index={2} title="再看热点文件" detail="优先进入复杂度和风险更高的文件。" />
            <RouteStep index={3} title="最后看符号依赖" detail="围绕函数、类和导入路径定位审查入口。" />
          </section>

          <div className="code-map-grid-next">
            <article className="code-map-panel-next">
              <PanelTitle icon={<Layers3 size={16} />} title="语言分布" />
              <div className="language-bars-next">
                {codeMap.languages.map((item) => (
                  <div key={item.language}>
                    <span>{item.language}</span>
                    <strong>{item.file_count} 文件 / {item.total_lines} 行</strong>
                    <i style={{ width: `${languageWidth(item.total_lines, codeMap.languages)}%` }} />
                  </div>
                ))}
                {codeMap.languages.length === 0 && <p className="muted">暂无语言分布。</p>}
              </div>
            </article>

            <article className="code-map-panel-next">
              <PanelTitle icon={<FileCode2 size={16} />} title="热点文件" />
              <div className="map-list-next">
                {codeMap.hotspot_files.map((item) => (
                  <p key={item.path}>
                    <strong>{item.path}</strong>
                    <span>{item.language || "文本"} · {item.total_lines} 行 · 复杂度 {item.complexity_score} · 风险 {item.risk_count}</span>
                  </p>
                ))}
                {codeMap.hotspot_files.length === 0 && <p className="muted">暂无热点文件。</p>}
              </div>
            </article>

            <article className="code-map-panel-next">
              <PanelTitle icon={<Shapes size={16} />} title="符号列表" />
              <div className="map-list-next dense">
                {codeMap.symbols.slice(0, 100).map((item) => (
                  <p key={item.id}>
                    <strong>{symbolKindLabel(item.kind)} · {item.name}</strong>
                    <span>{item.file_path}:{item.line} {item.signature}</span>
                  </p>
                ))}
                {codeMap.symbols.length === 0 && <p className="muted">暂无符号。</p>}
              </div>
            </article>

            <article className="code-map-panel-next">
              <PanelTitle icon={<GitBranch size={16} />} title="依赖关系" />
              <div className="map-list-next dense">
                {codeMap.dependencies.slice(0, 100).map((item) => (
                  <p key={item.id}>
                    <strong>{dependencyKindLabel(item.kind)} · {item.target}</strong>
                    <span>{item.source_path}:{item.line}</span>
                  </p>
                ))}
                {codeMap.dependencies.length === 0 && <p className="muted">暂无依赖关系。</p>}
              </div>
            </article>
          </div>
        </>
      ) : (
        <div className="workbench-empty-next compact">
          <Route size={34} />
          <h3>还没有加载代码地图</h3>
          <p>点击“刷新代码地图”，加载当前工作区的语言分布、热点文件、符号和依赖关系。</p>
        </div>
      )}
    </section>
  );
}

function MapMetric({ icon, label, value }: { icon: ReactNode; label: string; value: number }) {
  return (
    <article className="metric">
      <span>{icon}{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function RouteStep({ index, title, detail }: { index: number; title: string; detail: string }) {
  return (
    <article>
      <span>{index}</span>
      <strong>{title}</strong>
      <small>{detail}</small>
    </article>
  );
}

function PanelTitle({ icon, title }: { icon: ReactNode; title: string }) {
  return (
    <div className="section-title-next">
      <span>{icon}{title}</span>
      <h3>{title}</h3>
    </div>
  );
}

function languageWidth(lines: number, languages: CodeMap["languages"]) {
  const maxLines = Math.max(...languages.map((item) => item.total_lines), 1);
  return Math.max(8, Math.round((lines / maxLines) * 100));
}

function symbolKindLabel(value: string) {
  const labels: Record<string, string> = {
    function: "函数",
    class: "类",
    method: "方法",
    binding: "变量",
    struct: "结构体",
    enum: "枚举"
  };
  return labels[value] || value;
}

function dependencyKindLabel(value: string) {
  const labels: Record<string, string> = {
    import: "导入",
    from: "来自",
    require: "引用",
    use: "使用",
    include: "包含"
  };
  return labels[value] || value;
}
