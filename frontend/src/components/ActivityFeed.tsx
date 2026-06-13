import { Bot, Clock3, FileText, Orbit, Sparkles } from "lucide-react";
import type { ActivityItem } from "../types";

export function ActivityFeed({
  items,
  compact = false,
  onOpenGalaxy,
}: {
  items: ActivityItem[];
  compact?: boolean;
  onOpenGalaxy?: () => void;
}) {
  return (
    <section className={["activity-feed", compact ? "activity-feed-compact" : ""].filter(Boolean).join(" ")}>
      <div className="activity-feed-head">
        <div>
          <span>Live Workspace</span>
          <h3>最近活动</h3>
        </div>
        {onOpenGalaxy ? (
          <button className="activity-galaxy-button" onClick={onOpenGalaxy} type="button" title="打开活动星图">
            <Orbit size={15} />
          </button>
        ) : (
          <Clock3 size={16} />
        )}
      </div>
      <div className="activity-feed-list">
        {items.length ? items.slice(0, compact ? 6 : 10).map((item) => (
          <article className="activity-feed-item" key={item.id}>
            <div className={`activity-feed-icon activity-feed-icon-${item.kind}`}>
              {item.kind === "agent" ? <Sparkles size={15} /> : item.kind === "chat" ? <Bot size={15} /> : <FileText size={15} />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="activity-feed-title">{item.title}</div>
              <div className="activity-feed-subtitle">{item.subtitle || item.status}</div>
            </div>
            <time>{formatActivityTime(item.created_at)}</time>
          </article>
        )) : (
          <div className="activity-feed-empty">暂无活动，生成一份报告后这里会亮起来。</div>
        )}
      </div>
    </section>
  );
}

function formatActivityTime(value: string) {
  try {
    return new Intl.DateTimeFormat("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  } catch {
    return value;
  }
}
