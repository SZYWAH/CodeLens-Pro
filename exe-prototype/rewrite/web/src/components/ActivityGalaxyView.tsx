import { Activity, AlertTriangle, ArrowRight, CalendarDays, CheckCircle2, Clock3, Compass, ExternalLink, Filter, GitMerge, RefreshCw, Route, Search, Target, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { ActivityGalaxyData, ActivitySummary } from "../types";
import { ActivityGalaxyCanvas } from "./ActivityGalaxyCanvas";

type GalaxyTimeRange = "all" | "7d" | "30d" | "90d";
type WorkflowStageKey = "workspace" | "report" | "finding" | "card" | "log" | "agent" | "chat" | "activity";

type WorkflowStage = {
  key: WorkflowStageKey;
  label: string;
  shortLabel: string;
  description: string;
  count: number;
  weight: number;
  nodeId: string | null;
  strongestLabel: string;
};

type ClosureLane = {
  key: string;
  from: WorkflowStage;
  to: WorkflowStage;
  label: string;
  description: string;
  linkWeight: number;
  complete: boolean;
  missing: string[];
  focusNodeId: string | null;
  openNodeId: string | null;
  strongestLabel: string;
};

type GalaxyCommandCard = {
  key: string;
  label: string;
  title: string;
  detail: string;
  metric: string;
  tone: "ready" | "warning" | "missing";
  nodeId: string;
};

type GalaxyQualityItem = {
  key: string;
  label: string;
  detail: string;
  ok: boolean;
};

export function ActivityGalaxyView({
  summary,
  galaxy,
  onRefresh,
  onOpenNode
}: {
  summary: ActivitySummary | null;
  galaxy: ActivityGalaxyData | null;
  onRefresh: () => void;
  onOpenNode: (nodeId: string) => void;
}) {
  const nodes = galaxy?.nodes || [];
  const links = galaxy?.links || [];
  const dailyCounts = summary?.daily_counts || [];
  const [query, setQuery] = useState("");
  const [activeGroup, setActiveGroup] = useState("all");
  const [timeRange, setTimeRange] = useState<GalaxyTimeRange>("all");
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const queryText = query.trim().toLowerCase();
  const cutoffDate = useMemo(() => getCutoffDate(timeRange), [timeRange]);
  const groupOptions = useMemo(() => buildGroupOptions(nodes), [nodes]);
  const filteredNodes = useMemo(
    () => nodes.filter((node) => nodeMatchesFilter(node, activeGroup, queryText)),
    [activeGroup, nodes, queryText]
  );
  const filteredLinks = useMemo(() => {
    const visibleIds = new Set(filteredNodes.map((node) => node.id));
    return links.filter((link) => visibleIds.has(link.source) && visibleIds.has(link.target));
  }, [filteredNodes, links]);
  const visibleDailyCounts = useMemo(
    () => dailyCounts.filter((item) => isAfterCutoff(item.date, cutoffDate)),
    [cutoffDate, dailyCounts]
  );
  const visibleRecentEvents = useMemo(
    () => (summary?.recent_events || []).filter((event) => eventMatchesFilter(event, activeGroup, queryText, cutoffDate, selectedDay)),
    [activeGroup, cutoffDate, queryText, selectedDay, summary?.recent_events]
  );
  const filteredGalaxy = useMemo(
    () => (galaxy ? { nodes: filteredNodes, links: filteredLinks } : null),
    [filteredLinks, filteredNodes, galaxy]
  );
  const maxDaily = Math.max(...visibleDailyCounts.map((item) => item.count), 1);
  const totalActivity = visibleDailyCounts.reduce((sum, item) => sum + item.count, 0);
  const strongestLinks = [...filteredLinks].sort((left, right) => right.weight - left.weight).slice(0, 8);
  const focusedNode = filteredNodes.find((node) => node.id === focusedNodeId) || filteredNodes[0] || null;
  const selectedNode = filteredNodes.find((node) => node.id === selectedNodeId) || null;
  const focusedLinks = focusedNode
    ? filteredLinks.filter((link) => link.source === focusedNode.id || link.target === focusedNode.id).slice(0, 6)
    : [];
  const selectedLinks = selectedNode
    ? filteredLinks.filter((link) => link.source === selectedNode.id || link.target === selectedNode.id).slice(0, 8)
    : [];
  const selectedEvents = selectedNode
    ? visibleRecentEvents.filter((event) => eventBelongsToNode(event, selectedNode.id)).slice(0, 6)
    : [];
  const phaseItems = useMemo(() => buildPhaseItems(filteredNodes, summary), [filteredNodes, summary]);
  const workflowStages = useMemo(() => buildWorkflowStages(filteredNodes, summary), [filteredNodes, summary]);
  const closureLanes = useMemo(() => buildClosureLanes(workflowStages, filteredNodes, filteredLinks, summary), [filteredLinks, filteredNodes, summary, workflowStages]);
  const globalWorkflowStages = useMemo(() => buildWorkflowStages(nodes, summary), [nodes, summary]);
  const globalClosureLanes = useMemo(() => buildClosureLanes(globalWorkflowStages, nodes, links, summary), [globalWorkflowStages, links, nodes, summary]);
  const maturity = useMemo(() => buildGalaxyMaturity(globalWorkflowStages, globalClosureLanes, summary, nodes, links), [globalClosureLanes, globalWorkflowStages, links, nodes, summary]);
  const commandCards = useMemo(() => buildGalaxyCommandCards(globalWorkflowStages, globalClosureLanes, summary), [globalClosureLanes, globalWorkflowStages, summary]);
  const qualityItems = useMemo(() => buildGalaxyQualityItems(globalWorkflowStages, globalClosureLanes, summary, nodes, links, dailyCounts), [dailyCounts, globalClosureLanes, globalWorkflowStages, links, nodes, summary]);
  const completedStageCount = workflowStages.filter((stage) => stage.count > 0).length;
  const completedLaneCount = closureLanes.filter((lane) => lane.complete).length;

  useEffect(() => {
    if (focusedNodeId && !filteredNodes.some((node) => node.id === focusedNodeId)) {
      setFocusedNodeId(null);
    }
    if (selectedNodeId && !filteredNodes.some((node) => node.id === selectedNodeId)) {
      setSelectedNodeId(null);
    }
  }, [filteredNodes, focusedNodeId, selectedNodeId]);

  function resetFilters() {
    setQuery("");
    setActiveGroup("all");
    setTimeRange("all");
    setFocusedNodeId(null);
    setSelectedNodeId(null);
    setSelectedDay(null);
  }

  function selectNode(nodeId: string | null) {
    setFocusedNodeId(nodeId);
    setSelectedNodeId(nodeId);
  }

  return (
    <section className="activity-galaxy-page-next">
      <div className="activity-galaxy-header-next galaxy-hero-next">
        <div>
          <span>活动星图</span>
          <h3>活动星图</h3>
          <p>把本地报告、工作区、问题、卡片、日志、对话和 Agent 任务组织成一张可点击的成长轨迹图，用来复盘项目审查闭环。</p>
        </div>
        <div className="galaxy-hero-actions-next">
          <button className="primary-button" onClick={onRefresh}>
            <RefreshCw size={18} />
            刷新活动
          </button>
        </div>
      </div>

      <section className="galaxy-command-center-next">
        <article className="galaxy-maturity-card-next">
          <span>闭环成熟度</span>
          <strong>{maturity.score}</strong>
          <p>{maturity.label}</p>
          <div className="galaxy-maturity-bar-next">
            <i style={{ width: `${maturity.score}%` }} />
          </div>
          <small>{maturity.detail}</small>
        </article>
        <div className="galaxy-command-grid-next">
          {commandCards.map((card) => (
            <button className={`galaxy-command-card-next ${card.tone}`} key={card.key} onClick={() => onOpenNode(card.nodeId)} type="button">
              <span>{card.label}</span>
              <strong>{card.title}</strong>
              <p>{card.detail}</p>
              <em>{card.metric}</em>
            </button>
          ))}
        </div>
        <article className="galaxy-quality-card-next">
          <span>数据质量</span>
          <div>
            {qualityItems.map((item) => (
              <button className={item.ok ? "ok" : "warn"} key={item.key} onClick={() => onOpenNode(qualityNodeForItem(item.key))} type="button">
                {item.ok ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
                <strong>{item.label}</strong>
                <small>{item.detail}</small>
              </button>
            ))}
          </div>
        </article>
      </section>

      <ActivityGalaxyCanvas summary={summary} galaxy={filteredGalaxy} focusedNodeId={focusedNodeId} selectedNodeId={selectedNodeId} onFocusNode={setFocusedNodeId} onOpenNode={selectNode} />

      <div className="galaxy-dashboard-next">
        <GalaxyMetric label="显示节点" value={filteredNodes.length} />
        <GalaxyMetric label="显示关系" value={filteredLinks.length} />
        <GalaxyMetric label="活动" value={totalActivity} />
        <GalaxyMetric label="报告" value={summary?.report_count || 0} />
        <GalaxyMetric label="卡片" value={summary?.card_count || 0} />
        <GalaxyMetric label="Agent" value={summary?.agent_task_count || 0} />
      </div>

      <section className="galaxy-toolbar-next" aria-label="活动星图筛选">
        <label className="galaxy-search-next">
          <Search size={16} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索节点、关系或最近活动" />
        </label>
        <div className="galaxy-filter-tabs-next" aria-label="活动类型筛选">
          <span>
            <Filter size={14} />
            类型
          </span>
          {groupOptions.map((item) => (
            <button
              className={activeGroup === item.value ? "active" : ""}
              key={item.value}
              onClick={() => setActiveGroup(item.value)}
              type="button"
            >
              {item.label}
              <strong>{item.count}</strong>
            </button>
          ))}
        </div>
        <label className="galaxy-range-next">
          <CalendarDays size={16} />
          <select value={timeRange} onChange={(event) => setTimeRange(event.target.value as GalaxyTimeRange)}>
            <option value="all">全部时间</option>
            <option value="7d">近 7 天</option>
            <option value="30d">近 30 天</option>
            <option value="90d">近 90 天</option>
          </select>
        </label>
        <button className="ghost-button" onClick={resetFilters} type="button">
          重置筛选
        </button>
      </section>

      <section className="galaxy-product-map-next">
        <div className="galaxy-phase-strip-next">
          {phaseItems.map((item, index) => (
            <button
              className={item.nodeId && focusedNodeId === item.nodeId ? "galaxy-phase-next active" : "galaxy-phase-next"}
              disabled={!item.nodeId}
              key={item.key}
              onClick={() => item.nodeId && selectNode(item.nodeId)}
              onMouseEnter={() => setFocusedNodeId(item.nodeId)}
              onMouseLeave={() => setFocusedNodeId(null)}
              type="button"
            >
              <span>{index + 1}</span>
              <strong>{item.label}</strong>
              <small>
                {item.count} 个节点 / {item.weight} 活跃度
              </small>
            </button>
          ))}
        </div>
        <article className="galaxy-focus-summary-next">
          <span>
            <Compass size={15} />
            当前焦点
          </span>
          <h3>{focusedNode ? focusedNode.label : "暂无活动节点"}</h3>
          <p>{focusedNode ? `${groupLabel(focusedNode.group)} / 活跃权重 ${focusedNode.weight}` : "生成报告、卡片、日志或 Agent 计划后，星图会显示完整闭环。"}</p>
          <div>
            <small>直接关联</small>
            <strong>{focusedLinks.length}</strong>
          </div>
          {focusedNode && (
            <button className="ghost-button" onClick={() => selectNode(focusedNode.id)} type="button">
              <Target size={15} />
              查看节点详情
            </button>
          )}
        </article>
      </section>

      <section className="galaxy-closure-panel-next" aria-label="项目审查闭环路径">
        <div className="galaxy-closure-head-next">
          <div className="section-title-next">
            <span>审查闭环</span>
            <h3>工作区 → 报告 → 问题 → 卡片 → 日志 → Agent</h3>
          </div>
          <p>
            这里把星图里的活动重新组织成工作主线：先建立项目上下文，再产生报告和问题，随后沉淀学习材料、复盘日志，并交给 Agent 形成可确认的改进计划。
          </p>
          <div className="galaxy-closure-score-next">
            <strong>{completedStageCount}/{workflowStages.length}</strong>
            <span>阶段已有数据</span>
            <small>{completedLaneCount}/{closureLanes.length} 条关键路径已贯通</small>
          </div>
        </div>

        <div className="galaxy-closure-rail-next">
          {workflowStages.map((stage, index) => (
            <button
              className={stage.count > 0 ? "complete" : "missing"}
              disabled={!stage.nodeId}
              key={stage.key}
              onClick={() => stage.nodeId && selectNode(stage.nodeId)}
              onMouseEnter={() => setFocusedNodeId(stage.nodeId)}
              onMouseLeave={() => setFocusedNodeId(null)}
              type="button"
            >
              <span>{index + 1}</span>
              <strong>{stage.label}</strong>
              <small>{stage.count > 0 ? `${stage.count} 个沉淀项` : "等待补齐"}</small>
            </button>
          ))}
        </div>

        <div className="galaxy-closure-lanes-next">
          {closureLanes.map((lane) => (
            <article className={lane.complete ? "complete" : "missing"} key={lane.key}>
              <div>
                <span>{lane.complete ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}</span>
                <strong>{lane.label}</strong>
                <small>{lane.linkWeight > 0 ? `关系强度 ${lane.linkWeight}` : "尚未形成直接关系"}</small>
              </div>
              <p>{lane.complete ? lane.description : `待补齐：${lane.missing.join("、")}`}</p>
              <em>{lane.strongestLabel}</em>
              <div className="galaxy-closure-actions-next">
                <button className="ghost-button" disabled={!lane.focusNodeId} onClick={() => lane.focusNodeId && selectNode(lane.focusNodeId)} type="button">
                  <Target size={14} />
                  定位星点
                </button>
                <button className="ghost-button" disabled={!lane.openNodeId} onClick={() => lane.openNodeId && onOpenNode(lane.openNodeId)} type="button">
                  <ExternalLink size={14} />
                  打开关联内容
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>

      {selectedNode && (
        <section className="galaxy-inspector-next" aria-label="星图节点详情">
          <div className="galaxy-inspector-head-next">
            <div>
              <span>{isEntityNode(selectedNode.id) ? "实体星点" : "聚合星点"}</span>
              <h3>{selectedNode.label}</h3>
              <p>
                {groupLabel(selectedNode.group)} / 活跃权重 {selectedNode.weight} / {selectedLinks.length} 条关联路径
              </p>
            </div>
            <div className="button-row">
              <button className="ghost-button" onClick={() => onOpenNode(selectedNode.id)} type="button">
                <ExternalLink size={15} />
                打开关联内容
              </button>
              <button className="icon-button" onClick={() => setSelectedNodeId(null)} type="button" aria-label="关闭节点详情">
                <X size={16} />
              </button>
            </div>
          </div>
          <div className="galaxy-inspector-grid-next">
            <article>
              <span>节点身份</span>
              <strong>{nodeKindLabel(selectedNode.id, selectedNode.group)}</strong>
              <p>{nodeIdentity(selectedNode.id)}</p>
            </article>
            <article>
              <span>闭环位置</span>
              <strong>{phaseLabelForGroup(selectedNode.group)}</strong>
              <p>{phaseHintForGroup(selectedNode.group)}</p>
            </article>
            <article>
              <span>下一步动作</span>
              <strong>{nextActionForNode(selectedNode.id, selectedNode.group)}</strong>
              <p>点击“打开关联内容”进入对应页面继续审查、复盘或沉淀。</p>
            </article>
          </div>
          <div className="galaxy-inspector-body-next">
            <article>
              <div className="section-title-next">
                <span>路径</span>
                <h3>与当前星点相连</h3>
              </div>
              <div className="galaxy-link-list-next compact">
                {selectedLinks.map((link) => (
                  <button key={`${link.source}-${link.target}-selected`} onClick={() => selectNode(link.target === selectedNode.id ? link.source : link.target)} type="button">
                    <Route size={15} />
                    <span>{nodeLabel(filteredNodes, link.source)}</span>
                    <ArrowRight size={14} />
                    <span>{nodeLabel(filteredNodes, link.target)}</span>
                    <strong>{link.weight}</strong>
                  </button>
                ))}
                {selectedLinks.length === 0 && <p className="muted">暂无直接路径。</p>}
              </div>
            </article>
            <article>
              <div className="section-title-next">
                <span>活动</span>
                <h3>相关最近记录</h3>
              </div>
              <div className="galaxy-inspector-events-next">
                {selectedEvents.map((event) => (
                  <button key={event.id} onClick={() => selectNode(nodeIdForEvent(event))} type="button">
                    <Clock3 size={15} />
                    <span>{event.title}</span>
                    <small>
                      {formatTime(event.created_at)} / {activityLabel(event.event_type)}
                    </small>
                  </button>
                ))}
                {selectedEvents.length === 0 && <p className="muted">暂无与该星点直接匹配的最近记录。</p>}
              </div>
            </article>
          </div>
        </section>
      )}

      <section className="galaxy-data-panel-next">
        <article>
          <div className="section-title-next">
            <span>活动类型</span>
            <h3>节点图例</h3>
          </div>
          <div className="galaxy-legend-next">
            {filteredNodes.map((node) => (
              <button
                className={focusedNodeId === node.id ? "active" : ""}
                key={node.id}
                onClick={() => selectNode(node.id)}
                onMouseEnter={() => setFocusedNodeId(node.id)}
                onMouseLeave={() => setFocusedNodeId(null)}
                type="button"
              >
                <span style={{ background: galaxyGroupColor(node.group) }} />
                {node.label}
                <strong>{node.weight}</strong>
              </button>
            ))}
            {filteredNodes.length === 0 && <p className="muted">当前筛选条件下暂无节点。</p>}
          </div>
        </article>

        <article>
          <div className="section-title-next">
            <span>关系强度</span>
            <h3>关键闭环路径</h3>
          </div>
          <div className="galaxy-link-list-next">
            {strongestLinks.map((link) => (
              <button
                className={focusedNodeId === link.source || focusedNodeId === link.target ? "active" : ""}
                key={`${link.source}-${link.target}`}
                onClick={() => selectNode(link.target)}
                onMouseEnter={() => setFocusedNodeId(link.target)}
                onMouseLeave={() => setFocusedNodeId(null)}
                type="button"
              >
                <Route size={15} />
                <span>{nodeLabel(filteredNodes, link.source)}</span>
                <ArrowRight size={14} />
                <span>{nodeLabel(filteredNodes, link.target)}</span>
                <strong>{link.weight}</strong>
              </button>
            ))}
            {strongestLinks.length === 0 && <p className="muted">暂无关系数据。</p>}
          </div>
        </article>

        <article>
          <div className="section-title-next">
            <span>每日活跃</span>
            <h3>近日活跃度</h3>
          </div>
          <div className="galaxy-days-next">
            {visibleDailyCounts.slice(-24).map((day) => (
              <button
                className={selectedDay === day.date ? "active" : ""}
                key={day.date}
                onClick={() => setSelectedDay((value) => (value === day.date ? null : day.date))}
                title={`${day.date}：${day.count} 次活动`}
                type="button"
              >
                <span style={{ height: `${Math.max(8, Math.round((day.count / maxDaily) * 56))}px` }} />
                <small>{day.date.slice(5)}</small>
              </button>
            ))}
            {visibleDailyCounts.length === 0 && <p className="muted">当前时间范围内暂无每日活动数据。</p>}
          </div>
        </article>
      </section>

      <section className="galaxy-focus-path-next">
        <div className="section-title-next">
          <span>焦点路径</span>
          <h3>当前节点的直接关系</h3>
        </div>
        <div className="galaxy-focus-path-list-next">
          {focusedLinks.map((link) => (
            <button key={`${link.source}-${link.target}-focus`} onClick={() => selectNode(link.target === focusedNode?.id ? link.source : link.target)} type="button">
              <GitMerge size={16} />
              <span>{nodeLabel(filteredNodes, link.source)}</span>
              <ArrowRight size={14} />
              <span>{nodeLabel(filteredNodes, link.target)}</span>
              <strong>{link.weight}</strong>
            </button>
          ))}
          {focusedLinks.length === 0 && <p className="muted">暂无可展示的焦点关系。</p>}
        </div>
      </section>

      <section className="galaxy-recent-next">
        <div className="section-title-next">
          <span>最近活动</span>
          <h3>本地轨迹</h3>
        </div>
        <div className="galaxy-recent-list-next">
          {visibleRecentEvents.slice(0, 12).map((event) => (
            <article key={event.id}>
              <Activity size={16} />
              <div>
                <strong>{event.title}</strong>
                <span>
                  {formatTime(event.created_at)} / {activityLabel(event.event_type)}
                </span>
              </div>
              <button className="mini-button" onClick={() => selectNode(nodeIdForEvent(event))} type="button">
                定位星点
              </button>
            </article>
          ))}
          {visibleRecentEvents.length === 0 && <p className="muted">当前筛选条件下暂无最近活动。</p>}
        </div>
      </section>
    </section>
  );
}

function GalaxyMetric({ label, value }: { label: string; value: number }) {
  return (
    <article className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function buildGalaxyMaturity(
  stages: WorkflowStage[],
  lanes: ClosureLane[],
  summary: ActivitySummary | null,
  nodes: ActivityGalaxyData["nodes"],
  links: ActivityGalaxyData["links"]
) {
  const completedStages = stages.filter((stage) => stage.count > 0).length;
  const completedLanes = lanes.filter((lane) => lane.complete).length;
  const activeDays = (summary?.daily_counts || []).filter((item) => item.count > 0).length;
  const eventCount = summary?.recent_events.length || 0;
  const stageScore = (completedStages / Math.max(1, stages.length)) * 40;
  const laneScore = (completedLanes / Math.max(1, lanes.length)) * 28;
  const relationScore = Math.min(16, links.length * 2);
  const activityScore = Math.min(10, eventCount);
  const continuityScore = Math.min(6, activeDays * 1.5);
  const score = Math.min(100, Math.round(stageScore + laneScore + relationScore + activityScore + continuityScore));
  const label = score >= 85 ? "本地工作闭环已经比较完整" : score >= 62 ? "主线已成形，仍有关键缺口" : score >= 36 ? "已有可复盘数据，闭环还偏松散" : "星图还在积累第一批长期数据";
  const detail = `${completedStages}/${stages.length} 个阶段有数据，${completedLanes}/${lanes.length} 条关键路径贯通，${nodes.length} 个星点、${links.length} 条关系。`;
  return { score, label, detail };
}

function buildGalaxyCommandCards(
  stages: WorkflowStage[],
  lanes: ClosureLane[],
  summary: ActivitySummary | null
): GalaxyCommandCard[] {
  const reportStage = stageByKey(stages, "report");
  const findingStage = stageByKey(stages, "finding");
  const cardStage = stageByKey(stages, "card");
  const logStage = stageByKey(stages, "log");
  const agentStage = stageByKey(stages, "agent");
  const firstMissingStage = stages.find((stage) => stage.count === 0);
  const firstMissingLane = lanes.find((lane) => !lane.complete);
  const latestEvent = summary?.recent_events?.[0] || null;
  const nextMissingNode = firstMissingStage ? aggregateNodeForStage(firstMissingStage.key) : firstMissingLane ? aggregateNodeForStage(firstMissingLane.to.key) : "activity";

  return [
    {
      key: "latest",
      label: "继续最近工作",
      title: latestEvent?.title || "暂无最近活动",
      detail: latestEvent ? `${activityLabel(latestEvent.event_type)} · ${formatTime(latestEvent.created_at)}` : "生成报告、卡片、日志或 Agent 计划后，这里会出现可继续处理的入口。",
      metric: latestEvent ? "打开关联" : "等待活动",
      tone: latestEvent ? "ready" : "missing",
      nodeId: latestEvent ? nodeIdForEvent(latestEvent) : "activity"
    },
    {
      key: "gap",
      label: "补齐闭环缺口",
      title: firstMissingStage ? `缺少${firstMissingStage.shortLabel}` : firstMissingLane ? firstMissingLane.label : "关键路径已基本贯通",
      detail: firstMissingStage ? firstMissingStage.description : firstMissingLane ? `当前路径待补齐：${firstMissingLane.missing.join("、")}` : "可以继续打开星图节点复盘真实项目轨迹。",
      metric: firstMissingStage || firstMissingLane ? "去补齐" : "查看星图",
      tone: firstMissingStage || firstMissingLane ? "warning" : "ready",
      nodeId: nextMissingNode
    },
    {
      key: "learning",
      label: "学习沉淀",
      title: cardStage.count > 0 || logStage.count > 0 ? "卡片和日志已开始积累" : "学习沉淀还未形成",
      detail: `知识卡片 ${cardStage.count}，学习日志 ${logStage.count}。报告和问题应该持续转成可复习材料。`,
      metric: cardStage.count > 0 ? "打开卡片" : "建立卡片",
      tone: cardStage.count > 0 || logStage.count > 0 ? "ready" : "warning",
      nodeId: cardStage.count > 0 ? "cards" : "logs"
    },
    {
      key: "agent",
      label: "Agent 改进",
      title: agentStage.count > 0 ? "已有 Agent 计划" : "Agent 闭环待启动",
      detail: agentStage.count > 0 ? `${agentStage.count} 个 Agent 计划可继续确认、执行和追踪。` : `报告 ${reportStage.count}，问题 ${findingStage.count}，可继续生成改进计划。`,
      metric: agentStage.count > 0 ? "打开 Agent" : "生成计划",
      tone: agentStage.count > 0 ? "ready" : reportStage.count + findingStage.count > 0 ? "warning" : "missing",
      nodeId: "agent"
    }
  ];
}

function buildGalaxyQualityItems(
  stages: WorkflowStage[],
  lanes: ClosureLane[],
  summary: ActivitySummary | null,
  nodes: ActivityGalaxyData["nodes"],
  links: ActivityGalaxyData["links"],
  dailyCounts: ActivitySummary["daily_counts"]
): GalaxyQualityItem[] {
  const stageCount = stages.filter((stage) => stage.count > 0).length;
  const laneCount = lanes.filter((lane) => lane.complete).length;
  const activeDayCount = dailyCounts.filter((day) => day.count > 0).length;
  const recentCount = summary?.recent_events.length || 0;
  return [
    {
      key: "coverage",
      label: "主线覆盖",
      detail: `${stageCount}/${stages.length} 个工作阶段已有数据`,
      ok: stageCount >= Math.min(5, stages.length)
    },
    {
      key: "relation",
      label: "关系密度",
      detail: `${nodes.length} 个节点连接出 ${links.length} 条关系`,
      ok: links.length >= Math.max(1, Math.floor(nodes.length * 0.6))
    },
    {
      key: "recent",
      label: "近期轨迹",
      detail: `${recentCount} 条最近活动可追踪`,
      ok: recentCount > 0
    },
    {
      key: "daily",
      label: "长期复盘",
      detail: `${activeDayCount} 天有活动记录`,
      ok: activeDayCount >= 3
    },
    {
      key: "agent",
      label: "Agent 闭环",
      detail: `${stageByKey(stages, "agent").count} 个 Agent 计划，${laneCount}/${lanes.length} 条路径贯通`,
      ok: stageByKey(stages, "agent").count > 0 && laneCount >= 3
    }
  ];
}

function stageByKey(stages: WorkflowStage[], key: WorkflowStageKey) {
  return stages.find((stage) => stage.key === key) || {
    key,
    label: key,
    shortLabel: key,
    description: "",
    count: 0,
    weight: 0,
    nodeId: null,
    strongestLabel: "暂无代表星点"
  };
}

function aggregateNodeForStage(key: WorkflowStageKey) {
  const map: Record<WorkflowStageKey, string> = {
    workspace: "workspaces",
    report: "reports",
    finding: "findings",
    card: "cards",
    log: "logs",
    agent: "agent",
    chat: "chats",
    activity: "activity"
  };
  return map[key];
}

function qualityNodeForItem(key: string) {
  const map: Record<string, string> = {
    coverage: "workspaces",
    relation: "activity",
    recent: "activity",
    daily: "logs",
    agent: "agent"
  };
  return map[key] || "activity";
}

function buildGroupOptions(nodes: ActivityGalaxyData["nodes"]) {
  const groups = Array.from(new Set(nodes.map((node) => node.group)));
  return [
    { value: "all", label: "全部", count: nodes.length },
    ...groups.map((group) => ({
      value: group,
      label: groupLabel(group),
      count: nodes.filter((node) => node.group === group).length
    }))
  ];
}

function nodeMatchesFilter(node: ActivityGalaxyData["nodes"][number], activeGroup: string, queryText: string) {
  const groupMatched = activeGroup === "all" || node.group === activeGroup || node.id === activeGroup;
  if (!groupMatched) return false;
  if (!queryText) return true;
  return [node.id, node.label, node.group, groupLabel(node.group)].some((value) => value.toLowerCase().includes(queryText));
}

function eventMatchesFilter(
  event: NonNullable<ActivitySummary["recent_events"]>[number],
  activeGroup: string,
  queryText: string,
  cutoffDate: Date | null,
  selectedDay: string | null
) {
  if (!isAfterCutoff(event.created_at, cutoffDate)) return false;
  if (selectedDay && !event.created_at.startsWith(selectedDay)) return false;
  const group = eventGroup(event.event_type, event.entity_kind);
  if (activeGroup !== "all" && group !== activeGroup && event.entity_kind !== activeGroup) return false;
  if (!queryText) return true;
  return [event.title, event.detail, event.event_type, event.entity_kind || "", activityLabel(event.event_type), groupLabel(group)]
    .some((value) => value.toLowerCase().includes(queryText));
}

function nodeIdForEvent(event: NonNullable<ActivitySummary["recent_events"]>[number]) {
  const kind = event.entity_kind;
  const id = event.entity_id;
  if (kind === "report" && id) return `report:${id}`;
  if (kind === "workspace" && id) return `workspace:${id}`;
  if (kind === "finding" && id) return `finding:${id}`;
  if (kind === "learning_card" && id) return `card:${id}`;
  if (kind === "card_material" && id) return `card_material:${id}`;
  if (kind === "daily_log" && id) return `daily_log:${id}`;
  if (kind === "chat_session" && id) return `chat:${id}`;
  if (kind === "agent_task" && id) return `agent_task:${id}`;
  if (kind && id) return `${kind}:${id}`;
  return `event:${event.id}`;
}

function eventBelongsToNode(event: NonNullable<ActivitySummary["recent_events"]>[number], nodeId: string) {
  if (nodeIdForEvent(event) === nodeId) return true;
  return hubIdForEvent(event) === nodeId;
}

function hubIdForEvent(event: NonNullable<ActivitySummary["recent_events"]>[number]) {
  const source = event.entity_kind || event.event_type;
  const map: Record<string, string> = {
    workspace: "workspaces",
    report: "reports",
    finding: "findings",
    learning_card: "cards",
    card_material: "cards",
    card_candidate: "cards",
    daily_log: "logs",
    chat_session: "chats",
    agent_task: "agent",
    product_archive: "reports",
    guide: "reports",
    export: "reports",
    import: "reports",
    card: "cards",
    chat: "chats"
  };
  return map[source] || "activity";
}

function isEntityNode(nodeId: string) {
  return nodeId.includes(":") || nodeId.startsWith("event:");
}

function nodeKindLabel(nodeId: string, group: string) {
  if (!isEntityNode(nodeId)) return `${groupLabel(group)}聚合`;
  const kind = nodeId.slice(0, nodeId.indexOf(":"));
  const labels: Record<string, string> = {
    report: "分析报告",
    workspace: "项目工作区",
    finding: "问题清单项",
    card: "知识卡片",
    card_material: "学习材料",
    daily_log: "每日日志",
    chat: "AI 对话会话",
    agent_task: "Agent 任务",
    event: "活动记录"
  };
  return labels[kind] || "本地活动实体";
}

function nodeIdentity(nodeId: string) {
  if (!isEntityNode(nodeId)) return `聚合节点：${nodeId}`;
  const separator = nodeId.indexOf(":");
  const id = separator >= 0 ? nodeId.slice(separator + 1) : nodeId;
  return `实体 ID：${shortId(id)}`;
}

function phaseLabelForGroup(group: string) {
  const labels: Record<string, string> = {
    analysis: "分析主线",
    review: "问题审查",
    learning: "学习沉淀",
    ai: "AI 追问",
    agent: "Agent 改进",
    logs: "复盘日志"
  };
  return labels[group] || groupLabel(group);
}

function phaseHintForGroup(group: string) {
  const hints: Record<string, string> = {
    analysis: "从项目、文件和报告进入审查流程。",
    review: "把报告中的风险拆成可跟踪的问题。",
    learning: "把高价值问题沉淀为卡片和材料。",
    ai: "围绕报告、文件和问题继续对话追问。",
    agent: "把目标拆成可确认、可备份的改进计划。",
    logs: "把当天活动汇总为长期成长轨迹。"
  };
  return hints[group] || "本地活动会继续沉淀到工作闭环。";
}

function nextActionForNode(nodeId: string, group: string) {
  if (nodeId.startsWith("report:") || nodeId === "reports") return "打开报告阅读器";
  if (nodeId.startsWith("workspace:") || nodeId === "workspaces") return "进入项目工作区";
  if (nodeId.startsWith("finding:") || nodeId === "findings") return "查看问题状态";
  if (nodeId.startsWith("card:") || nodeId === "cards") return "复习知识卡片";
  if (nodeId.startsWith("chat:") || nodeId === "chats") return "继续 AI 对话";
  if (nodeId.startsWith("agent_task:") || nodeId === "agent") return "审查 Agent 计划";
  if (nodeId.startsWith("daily_log:") || nodeId === "logs") return "打开每日日志";
  return `继续处理${phaseLabelForGroup(group)}`;
}

function getCutoffDate(timeRange: GalaxyTimeRange) {
  if (timeRange === "all") return null;
  const days = timeRange === "7d" ? 7 : timeRange === "30d" ? 30 : 90;
  const date = new Date();
  date.setDate(date.getDate() - days + 1);
  date.setHours(0, 0, 0, 0);
  return date;
}

function isAfterCutoff(value: string, cutoffDate: Date | null) {
  if (!cutoffDate) return true;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return true;
  return date >= cutoffDate;
}

function eventGroup(eventType: string, entityKind?: string | null) {
  const source = entityKind || eventType;
  const map: Record<string, string> = {
    workspace: "analysis",
    workspaces: "analysis",
    report: "analysis",
    reports: "analysis",
    guide: "analysis",
    export: "analysis",
    import: "analysis",
    product_archive: "analysis",
    finding: "review",
    findings: "review",
    card: "learning",
    cards: "learning",
    learning_card: "learning",
    card_material: "learning",
    card_candidate: "learning",
    daily_log: "logs",
    log: "logs",
    logs: "logs",
    agent: "agent",
    agents: "agent",
    agent_task: "agent",
    chat: "ai",
    chats: "ai",
    chat_session: "ai"
  };
  return map[source] || source;
}

function buildWorkflowStages(nodes: ActivityGalaxyData["nodes"], summary: ActivitySummary | null): WorkflowStage[] {
  const definitions: Array<Omit<WorkflowStage, "count" | "weight" | "nodeId" | "strongestLabel"> & { count: number }> = [
    {
      key: "workspace",
      label: "项目工作区",
      shortLabel: "工作区",
      description: "真实项目上下文和文件快照，是后续审查链路的起点。",
      count: summary?.workspace_count || 0
    },
    {
      key: "report",
      label: "分析报告",
      shortLabel: "报告",
      description: "项目、单文件和对比分析产生的结构化阅读材料。",
      count: summary?.report_count || 0
    },
    {
      key: "finding",
      label: "问题清单",
      shortLabel: "问题",
      description: "从报告中拆出的风险、重构点和测试缺口。",
      count: summary?.finding_count || 0
    },
    {
      key: "card",
      label: "知识卡片",
      shortLabel: "卡片",
      description: "把高价值问题沉淀为可复习的知识单元。",
      count: summary?.card_count || 0
    },
    {
      key: "log",
      label: "每日日志",
      shortLabel: "日志",
      description: "按日期复盘分析、学习和改进活动。",
      count: summary?.daily_counts?.length || 0
    },
    {
      key: "agent",
      label: "Agent 计划",
      shortLabel: "Agent",
      description: "把问题和目标拆成可确认、可追踪的改进步骤。",
      count: summary?.agent_task_count || 0
    }
  ];

  return definitions.map((definition) => {
    const relatedNodes = nodes.filter((node) => nodeMatchesStage(node, definition.key));
    const primary = [...relatedNodes].sort((left, right) => {
      const leftEntity = isEntityNode(left.id) ? 1 : 0;
      const rightEntity = isEntityNode(right.id) ? 1 : 0;
      return rightEntity - leftEntity || right.weight - left.weight;
    })[0];
    return {
      ...definition,
      weight: relatedNodes.reduce((sum, node) => sum + node.weight, 0),
      nodeId: primary?.id || null,
      strongestLabel: primary?.label || "暂无代表星点"
    };
  });
}

function buildClosureLanes(
  stages: WorkflowStage[],
  nodes: ActivityGalaxyData["nodes"],
  links: ActivityGalaxyData["links"],
  summary: ActivitySummary | null
): ClosureLane[] {
  const stageMap = new Map(stages.map((stage) => [stage.key, stage]));
  const laneDefinitions: Array<{ from: WorkflowStageKey; to: WorkflowStageKey; label: string; description: string }> = [
    {
      from: "workspace",
      to: "report",
      label: "项目进入分析",
      description: "工作区已经转化为可阅读、可追踪的分析报告。"
    },
    {
      from: "report",
      to: "finding",
      label: "报告拆成问题",
      description: "报告中的风险点已经沉淀到问题清单，后续可以筛选和跟踪状态。"
    },
    {
      from: "finding",
      to: "card",
      label: "问题沉淀学习",
      description: "高价值问题已经转成知识卡片，形成可复习的学习资产。"
    },
    {
      from: "card",
      to: "log",
      label: "学习进入复盘",
      description: "卡片、报告和对话活动已经进入每日学习记录。"
    },
    {
      from: "finding",
      to: "agent",
      label: "问题触发改进计划",
      description: "问题已经进一步转化为 Agent 可执行前的计划、步骤和风险说明。"
    },
    {
      from: "report",
      to: "chat",
      label: "报告继续追问",
      description: "报告内容可以继续进入 AI 对话，用上下文追问细节和替代方案。"
    }
  ];
  const chatStage = buildVirtualChatStage(nodes, summary);
  const allStages = new Map<WorkflowStageKey, WorkflowStage>([...stageMap, ["chat", chatStage]]);

  return laneDefinitions.map((definition) => {
    const from = allStages.get(definition.from)!;
    const to = allStages.get(definition.to)!;
    const linkWeight = links.reduce((sum, link) => {
      const source = nodes.find((node) => node.id === link.source);
      const target = nodes.find((node) => node.id === link.target);
      if (!source || !target) return sum;
      const direct = nodeMatchesStage(source, from.key) && nodeMatchesStage(target, to.key);
      const reverse = nodeMatchesStage(source, to.key) && nodeMatchesStage(target, from.key);
      return direct || reverse ? sum + link.weight : sum;
    }, 0);
    const missing = [from.count === 0 ? from.shortLabel : "", to.count === 0 ? to.shortLabel : ""].filter(Boolean);
    const focusNodeId = to.nodeId || from.nodeId;
    return {
      key: `${from.key}-${to.key}`,
      from,
      to,
      label: definition.label,
      description: definition.description,
      linkWeight,
      complete: from.count > 0 && to.count > 0,
      missing,
      focusNodeId,
      openNodeId: focusNodeId,
      strongestLabel: to.count > 0 ? `代表星点：${to.strongestLabel}` : `下一步建议：先补齐${to.shortLabel}`
    };
  });
}

function buildVirtualChatStage(nodes: ActivityGalaxyData["nodes"], summary: ActivitySummary | null): WorkflowStage {
  const relatedNodes = nodes.filter((node) => nodeMatchesStage(node, "chat"));
  const primary = [...relatedNodes].sort((left, right) => right.weight - left.weight)[0];
  return {
    key: "chat",
    label: "AI 对话",
    shortLabel: "对话",
    description: "围绕报告、问题和项目上下文继续追问。",
    count: summary?.chat_count || Math.max(0, relatedNodes.filter((node) => isEntityNode(node.id)).length),
    weight: relatedNodes.reduce((sum, node) => sum + node.weight, 0),
    nodeId: primary?.id || null,
    strongestLabel: primary?.label || "暂无代表星点"
  };
}

function nodeMatchesStage(node: ActivityGalaxyData["nodes"][number], stage: WorkflowStageKey) {
  if (stage === "workspace") return node.id === "workspaces" || node.id.startsWith("workspace:");
  if (stage === "report") return node.id === "reports" || node.id.startsWith("report:");
  if (stage === "finding") return node.id === "findings" || node.id.startsWith("finding:");
  if (stage === "card") return node.id === "cards" || node.id.startsWith("card:") || node.id.startsWith("card_material:");
  if (stage === "log") return node.id === "logs" || node.id.startsWith("daily_log:");
  if (stage === "agent") return node.id === "agent" || node.id.startsWith("agent_task:");
  if (stage === "chat") return node.id === "chats" || node.id.startsWith("chat:");
  if (stage === "activity") return node.id === "activity" || node.id.startsWith("event:");
  return false;
}

function buildPhaseItems(nodes: ActivityGalaxyData["nodes"], summary: ActivitySummary | null) {
  const phaseConfig = [
    { key: "workspaces", label: "项目工作区", groups: ["workspaces"], fallback: summary?.workspace_count || 0 },
    { key: "reports", label: "分析报告", groups: ["reports", "analysis"], fallback: summary?.report_count || 0 },
    { key: "findings", label: "问题清单", groups: ["findings", "review"], fallback: summary?.finding_count || 0 },
    { key: "cards", label: "学习沉淀", groups: ["cards", "logs", "learning"], fallback: (summary?.card_count || 0) + (summary?.daily_counts?.length || 0) },
    { key: "agent", label: "Agent 改进", groups: ["agents", "agent", "ai", "chats"], fallback: (summary?.agent_task_count || 0) + (summary?.chat_count || 0) }
  ];

  return phaseConfig.map((item) => {
    const relatedNodes = nodes.filter((node) => item.groups.includes(node.group) || item.groups.includes(node.id));
    const primary = [...relatedNodes].sort((left, right) => right.weight - left.weight)[0];
    return {
      key: item.key,
      label: item.label,
      count: relatedNodes.length || item.fallback,
      weight: relatedNodes.reduce((sum, node) => sum + node.weight, 0) || item.fallback,
      nodeId: primary?.id || null
    };
  });
}

function nodeLabel(nodes: ActivityGalaxyData["nodes"], id: string) {
  return nodes.find((node) => node.id === id)?.label || id;
}

function galaxyGroupColor(group: string) {
  const colors: Record<string, string> = {
    reports: "#72e4c4",
    workspaces: "#8fb8ff",
    findings: "#ffb86b",
    cards: "#d8b4fe",
    chats: "#f7a8c8",
    agents: "#fde68a",
    logs: "#a7f3d0",
    analysis: "#8fb8ff",
    review: "#ffb86b",
    learning: "#d8b4fe",
    ai: "#f7a8c8",
    agent: "#fde68a"
  };
  return colors[group] || "#93c5fd";
}

function groupLabel(value: string) {
  const labels: Record<string, string> = {
    reports: "报告",
    workspaces: "工作区",
    findings: "问题",
    cards: "知识卡片",
    chats: "AI 对话",
    agents: "Agent 任务",
    logs: "每日日志",
    analysis: "项目分析",
    review: "审查闭环",
    learning: "学习沉淀",
    ai: "AI 对话",
    agent: "Agent 任务"
  };
  return labels[value] || value;
}

function activityLabel(value: string) {
  const labels: Record<string, string> = {
    workspace: "工作区",
    report: "报告",
    finding: "问题",
    card: "知识卡片",
    daily_log: "每日日志",
    guide: "项目导览",
    agent: "Agent",
    chat: "对话",
    export: "导出",
    import: "导入"
  };
  return labels[value] || "活动";
}

function formatTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { hour12: false });
}

function shortId(value: string) {
  return value.length > 16 ? `${value.slice(0, 8)}...${value.slice(-6)}` : value;
}
