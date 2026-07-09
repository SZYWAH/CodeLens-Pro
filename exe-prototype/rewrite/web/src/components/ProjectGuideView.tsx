import { BookOpen, Compass, FileCode2, FolderTree, Layers3, Loader2, Map as MapIcon, Route, Sparkles } from "lucide-react";
import { useMemo, type ReactNode } from "react";
import type { ProjectGuide, ProjectGuideItem, WorkspaceDetail } from "../types";
import { formatTime } from "../utils/display";

type ProjectGuideViewProps = {
  activeWorkspace: WorkspaceDetail | null;
  guide: ProjectGuide | null;
  busy: boolean;
  onGenerate: () => void;
};

type TopArea = {
  name: string;
  fileCount: number;
  totalLines: number;
  languages: string[];
};

export function ProjectGuideView({ activeWorkspace, guide, busy, onGenerate }: ProjectGuideViewProps) {
  const topAreas = useMemo(() => (activeWorkspace ? buildTopAreas(activeWorkspace) : []), [activeWorkspace]);
  const knowledgePoints = useMemo(() => (activeWorkspace ? buildKnowledgePoints(activeWorkspace, guide) : []), [activeWorkspace, guide]);
  const routeItems = useMemo(
    () => (activeWorkspace ? (guide?.reading_order.length ? guide.reading_order : buildFallbackReadOrder(activeWorkspace)) : []),
    [activeWorkspace, guide]
  );
  const keyFiles = useMemo(
    () => (activeWorkspace ? (guide?.key_files.length ? guide.key_files : buildFallbackKeyFiles(activeWorkspace)) : []),
    [activeWorkspace, guide]
  );

  if (!activeWorkspace) {
    return (
      <div className="workbench-empty-next">
        <MapIcon size={38} />
        <h3>请先打开一个工作区</h3>
        <p>项目导览会基于当前工作区的代码地图生成架构摘要、模块说明、关键文件和推荐阅读顺序。</p>
      </div>
    );
  }

  return (
    <section className="project-guide-page-next">
      <div className="project-guide-hero-next">
        <div>
          <span>
            <Compass size={14} />
            项目导览
          </span>
          <h3>{activeWorkspace.summary.name}</h3>
          <p>把文件列表升级成可进入项目的路线图：先看结构，再看热点文件，最后进入报告、卡片和 Agent 闭环。</p>
        </div>
        <div className="button-row">
          <button className="primary-button" onClick={onGenerate} disabled={busy}>
            {busy ? <Loader2 className="spin" size={18} /> : <MapIcon size={18} />}
            生成项目导览
          </button>
        </div>
      </div>

      <section className="project-guide-board-next">
        <div className="project-guide-board-head-next">
          <div>
            <span>
              <MapIcon size={15} />
              项目进入路线图
            </span>
            <h4>{guide ? "已生成本地项目导览" : "等待生成项目导览"}</h4>
            <p>从目录结构、热点文件、阅读路径和知识点四个方向进入项目，让分析结果更接近原项目的导览体验。</p>
          </div>
          <strong>{activeWorkspace.summary.file_count}</strong>
        </div>
        <div className="project-guide-flow-next">
          {[
            ["结构", "识别目录与模块边界"],
            ["路径", "按顺序阅读关键文件"],
            ["风险", "结合热点和复杂度审查"],
            ["沉淀", "进入报告、卡片和 Agent 闭环"]
          ].map(([title, detail], index) => (
            <article key={title}>
              <span>{index + 1}</span>
              <strong>{title}</strong>
              <small>{detail}</small>
            </article>
          ))}
        </div>
      </section>

      <div className="project-overview-next">
        <article>
          <span>工作区路径</span>
          <strong>{compactPath(activeWorkspace.summary.root_path)}</strong>
        </article>
        <article>
          <span>文件数量</span>
          <strong>{activeWorkspace.summary.file_count}</strong>
        </article>
        <article>
          <span>代码行数</span>
          <strong>{activeWorkspace.summary.total_lines}</strong>
        </article>
        <article>
          <span>语言分布</span>
          <strong>{activeWorkspace.summary.language_summary || "待扫描"}</strong>
        </article>
      </div>

      {guide ? (
        <div className="project-guide-grid-next project-guide-grid-rich-next">
          <article className="project-guide-summary-next">
            <span>
              <Sparkles size={15} />
              导览摘要
            </span>
            <h3>{guide.title}</h3>
            <p>{guide.summary}</p>
            <small>生成时间：{formatTime(guide.generated_at)}</small>
          </article>
          <ProjectStructurePanel areas={topAreas} />
          <GuideList icon={<Layers3 size={16} />} title="架构摘要" items={guide.architecture} variant="architecture" />
          <GuideList icon={<Route size={16} />} title="推荐阅读顺序" items={routeItems} variant="route" />
          <GuideList icon={<FileCode2 size={16} />} title="关键文件" items={keyFiles} variant="files" />
          <KnowledgePanel items={knowledgePoints} />
        </div>
      ) : (
        <div className="project-guide-grid-next project-guide-grid-rich-next">
          <ProjectStructurePanel areas={topAreas} />
          <GuideList icon={<Route size={16} />} title="预估阅读顺序" items={routeItems} variant="route" />
          <GuideList icon={<FileCode2 size={16} />} title="热点关键文件" items={keyFiles} variant="files" />
          <KnowledgePanel items={knowledgePoints} />
          <div className="workbench-empty-next compact">
            <MapIcon size={34} />
            <h3>还没有生成正式导览</h3>
            <p>当前内容来自本地文件快照的预估结果。点击“生成项目导览”后，可以得到更完整的架构摘要、阅读路线和关键文件说明。</p>
          </div>
        </div>
      )}
    </section>
  );
}

function ProjectStructurePanel({ areas }: { areas: TopArea[] }) {
  return (
    <article className="project-structure-next">
      <div className="section-title-next">
        <span>
          <FolderTree size={15} />
          项目结构
        </span>
        <h3>核心区域</h3>
      </div>
      <div className="project-area-list-next">
        {areas.map((area) => (
          <div key={area.name}>
            <strong>{area.name}</strong>
            <span>
              {area.fileCount} 个文件 / {area.totalLines} 行
            </span>
            <p>{area.languages.join(" / ") || "未知语言"}</p>
          </div>
        ))}
        {areas.length === 0 && <p className="muted">暂无文件区域。</p>}
      </div>
    </article>
  );
}

function GuideList({ icon, title, items, variant }: { icon: ReactNode; title: string; items: ProjectGuideItem[]; variant: "architecture" | "route" | "files" }) {
  return (
    <article className={`project-guide-list-next ${variant}`}>
      <div className="section-title-next">
        <span>
          {icon}
          {title}
        </span>
        <h3>{title}</h3>
      </div>
      <div className="project-guide-item-list-next">
        {items.map((item, index) => (
          <article key={`${item.title}-${index}`}>
            <span>{variant === "route" ? index + 1 : variant === "files" ? <FileCode2 size={14} /> : <Layers3 size={14} />}</span>
            <div>
              <strong>{item.title}</strong>
              <p>{item.detail}</p>
              {item.path ? <code>{item.path}</code> : null}
            </div>
          </article>
        ))}
        {items.length === 0 && <p className="muted">暂无条目。</p>}
      </div>
    </article>
  );
}

function KnowledgePanel({ items }: { items: string[] }) {
  return (
    <article className="project-knowledge-next">
      <div className="section-title-next">
        <span>
          <BookOpen size={15} />
          知识点
        </span>
        <h3>可能需要复习</h3>
      </div>
      <div>
        {items.map((item) => (
          <span key={item}>{item}</span>
        ))}
        {items.length === 0 && <p className="muted">暂无可推断知识点。</p>}
      </div>
    </article>
  );
}

function buildTopAreas(workspace: WorkspaceDetail): TopArea[] {
  const areas = new Map<string, { fileCount: number; totalLines: number; languages: Set<string> }>();
  for (const file of workspace.files) {
    const name = topAreaName(file.path);
    const area = areas.get(name) || { fileCount: 0, totalLines: 0, languages: new Set<string>() };
    area.fileCount += 1;
    area.totalLines += file.metrics.total_lines;
    if (file.language) area.languages.add(file.language);
    areas.set(name, area);
  }

  return Array.from(areas.entries())
    .map(([name, value]) => ({
      name,
      fileCount: value.fileCount,
      totalLines: value.totalLines,
      languages: Array.from(value.languages).slice(0, 3)
    }))
    .sort((left, right) => right.fileCount - left.fileCount || right.totalLines - left.totalLines)
    .slice(0, 8);
}

function buildFallbackReadOrder(workspace: WorkspaceDetail): ProjectGuideItem[] {
  const sorted = [...workspace.files]
    .sort((left, right) => right.metrics.complexity_score - left.metrics.complexity_score || right.metrics.total_lines - left.metrics.total_lines)
    .slice(0, 5);

  return sorted.map((file, index) => ({
    title: `第 ${index + 1} 步：阅读 ${file.path.split(/[\\/]/).pop() || file.path}`,
    detail: `优先关注 ${file.language || "文本"} 文件，复杂度 ${file.metrics.complexity_score}，共 ${file.metrics.total_lines} 行。`,
    path: file.path
  }));
}

function buildFallbackKeyFiles(workspace: WorkspaceDetail): ProjectGuideItem[] {
  return [...workspace.files]
    .sort((left, right) => right.metrics.risk_count - left.metrics.risk_count || right.metrics.complexity_score - left.metrics.complexity_score)
    .slice(0, 6)
    .map((file) => ({
      title: file.path.split(/[\\/]/).pop() || file.path,
      detail: `${file.language || "文本"} / ${file.metrics.total_lines} 行 / 复杂度 ${file.metrics.complexity_score} / 风险 ${file.metrics.risk_count}`,
      path: file.path
    }));
}

function buildKnowledgePoints(workspace: WorkspaceDetail, guide: ProjectGuide | null) {
  const inferred = new Set<string>();
  if (guide?.architecture.some((item) => /接口|API|路由|请求/i.test(`${item.title} ${item.detail}`))) inferred.add("接口设计与请求链路");
  if (guide?.architecture.some((item) => /数据库|SQLite|SQL|存储/i.test(`${item.title} ${item.detail}`))) inferred.add("本地数据建模");

  for (const file of workspace.files) {
    const path = file.path.toLowerCase();
    if (/\.(tsx|jsx|vue)$/.test(path)) inferred.add("前端组件与状态管理");
    if (/\.(ts|js)$/.test(path)) inferred.add("TypeScript/JavaScript 工程结构");
    if (/\.rs$/.test(path)) inferred.add("Rust 模块与错误处理");
    if (/\.py$/.test(path)) inferred.add("Python 脚本与服务逻辑");
    if (/test|spec/.test(path)) inferred.add("测试设计");
    if (/config|settings|env/.test(path)) inferred.add("配置管理");
  }

  return Array.from(inferred).slice(0, 10);
}

function topAreaName(path: string) {
  const normalized = path.replace(/\\/g, "/");
  const first = normalized.split("/").filter(Boolean)[0];
  return first || "根目录";
}

function compactPath(value: string) {
  if (value.length <= 72) return value;
  return `...${value.slice(-69)}`;
}
