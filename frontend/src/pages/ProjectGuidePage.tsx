import { Compass, FileCode2, FolderTree, Map, RefreshCw, Route } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { ProjectGuideResponse } from "../types";

export function ProjectGuidePage() {
  const [guide, setGuide] = useState<ProjectGuideResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      setGuide(await api.projectGuide());
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
    <div className="page-scroll learning-page project-guide-page">
      <section className="learning-hero project-guide-hero">
        <div>
          <span className="learning-kicker"><Compass size={14} /> Project Guide</span>
          <h2>项目导读</h2>
          <p>基于 VS Code 插件同步的项目结构，面向初学者推断入口、核心目录、阅读顺序和可能涉及的知识点。</p>
        </div>
        <button className="btn btn-secondary" onClick={load} disabled={loading} type="button">
          <RefreshCw className={loading ? "animate-spin" : ""} size={15} />
          刷新导读
        </button>
      </section>

      {error ? <div className="chat-panel-error">{error}</div> : null}

      <section className="learning-surface project-overview">
        <div>
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
          <div className="learning-section-head"><h3><FileCode2 size={16} /> 入口候选</h3></div>
          <div className="project-path-list">
            {(guide?.entry_candidates ?? []).map((item) => (
              <article key={item.path}>
                <strong>{item.path}</strong>
                <p>{item.reason}</p>
              </article>
            ))}
            {guide && !guide.entry_candidates.length ? <p className="learning-empty">暂未从项目树中识别到入口候选，建议确认插件同步是否完整。</p> : null}
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
