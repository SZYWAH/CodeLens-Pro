import { Compass, FileCode2, FolderTree, Map, RefreshCw, Route } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { ProjectGuideResponse, ProjectStructureNode, WorkspaceTreeNode } from "../types";

export function ProjectGuideContent({
  guide,
  loading,
  error,
  onRefresh,
  workspaceTree,
  compact = false,
}: {
  guide: ProjectGuideResponse | null;
  loading?: boolean;
  error?: string;
  onRefresh?: () => void;
  workspaceTree?: WorkspaceTreeNode | null;
  compact?: boolean;
}) {
  const projectStructure = guide?.project_structure ?? (workspaceTree ? workspaceTreeToProjectStructure(workspaceTree) : null);

  return (
    <div className={compact ? "project-guide-embedded" : "page-scroll learning-page project-guide-page"}>
      <section className="learning-hero project-guide-hero">
        <div className="project-guide-intro">
          <span className="learning-kicker"><Compass size={14} /> Project Guide</span>
          <h2>项目导读</h2>
          <p>直接读取本地项目结构和少量文件内容，生成项目架构、文件说明、核心区域与推荐阅读顺序。</p>
        </div>
        {onRefresh ? (
          <button className="btn btn-secondary project-guide-refresh" onClick={onRefresh} disabled={loading} type="button">
            <RefreshCw className={loading ? "animate-spin" : ""} size={15} />
            刷新导读
          </button>
        ) : null}
      </section>

      {error ? <div className="chat-panel-error">{error}</div> : null}

      <section className="project-overview">
        <div className="project-overview-main">
          <span>当前项目</span>
          <strong>{guide?.workspace.name || "等待 VS Code 插件同步"}</strong>
          <p>{guide?.workspace.root || "打开 VS Code 项目后，这里会基于项目树生成导读建议。"}</p>
        </div>
        <div className="project-overview-stats">
          <span>{guide?.workspace.file_count ?? 0}<em>文件</em></span>
          <span>{guide?.workspace.directory_count ?? 0}<em>目录</em></span>
          <span>{guide?.workspace.connected ? "在线" : "待连接"}<em>插件</em></span>
        </div>
      </section>

      {guide?.notes.length ? (
        <div className="learning-notice">
          {guide.notes.map((note) => <span key={note}>{note}</span>)}
        </div>
      ) : null}

      <div className="learning-grid learning-grid-main">
        <section className="learning-surface">
          <div className="learning-section-head"><h3><FileCode2 size={16} /> 项目架构</h3></div>
          <div className="project-structure-panel">
            {projectStructure ? (
              <ProjectArchitectureView node={projectStructure} />
            ) : (
              <p className="learning-empty">{guide ? "当前没有可展示的项目架构。" : "打开 VS Code 插件后，这里会展示项目架构与文件说明。"}</p>
            )}
          </div>
        </section>

        <section className="learning-surface">
          <div className="learning-section-head"><h3><FolderTree size={16} /> 核心区域</h3></div>
          <div className="project-area-list">
            {(guide?.core_areas ?? []).map((area) => (
              <article key={area.name}>
                <strong>{area.name}</strong>
                <span>{area.file_count} 个文件</span>
                <p>{area.description}</p>
              </article>
            ))}
          </div>
        </section>
      </div>

      <div className="learning-grid learning-grid-main">
        <section className="learning-surface">
          <div className="learning-section-head"><h3><Route size={16} /> 推荐阅读顺序</h3></div>
          <div className="project-read-order">
            {(guide?.read_order ?? []).map((step) => (
              <article key={step.step}>
                <span>{step.step}</span>
                <div>
                  <strong>{step.title}</strong>
                  <p>{step.paths.length ? step.paths.join(" · ") : "等待更多项目上下文"}</p>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="learning-surface">
          <div className="learning-section-head"><h3><Map size={16} /> 可能涉及的知识点</h3></div>
          <div className="project-knowledge-list">
            {(guide?.knowledge_points ?? []).map((point) => <span key={point}>{point}</span>)}
            {guide && !guide.knowledge_points.length ? <p className="learning-empty">这里会根据文件类型和目录结构推断可能需要复习的知识点。</p> : null}
          </div>
        </section>
      </div>
    </div>
  );
}

export function ProjectGuidePage() {
  const [guide, setGuide] = useState<ProjectGuideResponse | null>(null);
  const [workspaceTree, setWorkspaceTree] = useState<WorkspaceTreeNode | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [nextGuide, nextWorkspace] = await Promise.all([
        api.projectGuide(),
        api.currentWorkspace().catch(() => null),
      ]);
      setGuide(nextGuide);
      setWorkspaceTree(nextWorkspace?.tree ?? null);
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "项目导读加载失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <ProjectGuideContent guide={guide} loading={loading} error={error} onRefresh={load} workspaceTree={workspaceTree} />
  );
}

function ProjectArchitectureView({ node }: { node: ProjectStructureNode }) {
  const lines = ["项目架构：", ...buildArchitectureLines(node)];
  return (
    <pre className="project-architecture-block" aria-label="项目架构与文件说明">
      {lines.join("\n")}
    </pre>
  );
}

function buildArchitectureLines(node: ProjectStructureNode, prefix = "", isLast = true, isRoot = true): string[] {
  const children = node.children ?? [];
  const label = `${node.name || "项目"}${node.type === "directory" ? "/" : ""}`;
  const comment = buildArchitectureComment(node);
  const line = isRoot ? `${label}${comment}` : `${prefix}${isLast ? "└── " : "├── "}${label}${comment}`;
  const childPrefix = isRoot ? "" : `${prefix}${isLast ? "    " : "│   "}`;
  const lines = [line];

  children.forEach((child, index) => {
    lines.push(...buildArchitectureLines(child, childPrefix, index === children.length - 1, false));
  });

  if (node.truncated) {
    lines.push(`${childPrefix}${children.length ? "└── " : ""}... # 已截断，部分节点未展示`);
  }

  return lines;
}

function buildArchitectureComment(node: ProjectStructureNode) {
  const details = [node.description, node.truncated ? "已截断" : ""].filter(Boolean);
  return details.length ? `  # ${details.join("，")}` : "";
}

function workspaceTreeToProjectStructure(node: WorkspaceTreeNode): ProjectStructureNode {
  return {
    name: node.name,
    path: node.path,
    type: node.type,
    description: node.type === "directory" ? "项目目录" : "项目文件",
    children: node.children?.map(workspaceTreeToProjectStructure),
    truncated: node.truncated,
  };
}
