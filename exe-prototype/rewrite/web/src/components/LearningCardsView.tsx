import {
  BookOpen,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Download,
  Filter,
  GraduationCap,
  Layers3,
  Link2,
  Loader2,
  RotateCcw,
  Save,
  Search,
  Sparkles,
  Tag,
  Target,
  Trash2
} from "lucide-react";
import type { FormEvent } from "react";
import { useMemo, useState } from "react";
import type { CardMaterial, LearningCard, LearningCardCandidate, LearningCenterData } from "../types";

type LearningCardDifficulty = "easy" | "medium" | "hard";
type CardSource = "manual" | "finding" | "workspace";

export function LearningCardsView(props: {
  cards: LearningCard[];
  materials: CardMaterial[];
  candidates: LearningCardCandidate[];
  selectedCandidateIds: string[];
  activeCardId: string | null;
  center?: LearningCenterData | null;
  status: string;
  tag: string;
  manualTitle: string;
  manualContent: string;
  manualTags: string;
  onStatusFilter: (value: string) => void;
  onTagChange: (value: string) => void;
  onManualTitleChange: (value: string) => void;
  onManualContentChange: (value: string) => void;
  onManualTagsChange: (value: string) => void;
  onToggleCandidate: (id: string, selected: boolean) => void;
  onApproveCandidates: () => void;
  onRejectCandidate: (id: string) => void;
  onGenerateCandidates: () => void;
  onCreateManual: (event: FormEvent) => void;
  onSearch: () => void;
  onUpdate: (id: string, status: string) => void;
  onDelete: (id: string) => void;
  onGenerateMaterial: (id: string) => void;
  onSelectCard: (id: string) => void;
  onExportCards?: () => void;
  busy: boolean;
}) {
  const [difficultyFilter, setDifficultyFilter] = useState<"all" | LearningCardDifficulty>("all");
  const [sourceFilter, setSourceFilter] = useState<"all" | CardSource>("all");
  const [sortMode, setSortMode] = useState<"review" | "newest" | "oldest">("review");

  const stats = learningCardStats(props.cards);
  const tags = learningTagCloud(props.cards);
  const selectedCandidateCount = props.selectedCandidateIds.length;
  const masteredPercent = stats.total ? Math.round((stats.mastered / stats.total) * 100) : 0;
  const activeCard = props.cards.find((card) => card.id === props.activeCardId) || null;
  const activeMaterials = props.activeCardId ? props.materials.filter((material) => material.card_id === props.activeCardId) : props.materials;
  const latestMaterial = activeMaterials[0] || props.materials[0] || null;

  const visibleCards = useMemo(() => {
    return props.cards
      .filter((card) => difficultyFilter === "all" || cardDifficulty(card) === difficultyFilter)
      .filter((card) => sourceFilter === "all" || cardSource(card) === sourceFilter)
      .sort((left, right) => compareCards(left, right, sortMode));
  }, [props.cards, difficultyFilter, sourceFilter, sortMode]);

  const reviewQueue = useMemo(
    () => visibleCards.filter((card) => card.status !== "mastered").slice(0, 8),
    [visibleCards]
  );
  const difficultyStats = useMemo(() => learningDifficultyStats(props.cards), [props.cards]);
  const dailyReviewTarget = props.center?.review_cards.length || reviewQueue.length;

  return (
    <section className="cards-page-next">
      <div className="cards-library-next">
        <div className="cards-hero-next">
          <div>
            <span>知识卡片</span>
            <h3>知识卡片体系</h3>
            <p>围绕报告、问题、项目和手动记录沉淀长期知识，形成“候选审核、卡片入库、材料生成、复习追踪、导出归档”的闭环。</p>
          </div>
          <div className="cards-stats-next">
            <small>总数 <strong>{stats.total}</strong></small>
            <small>未掌握 <strong>{stats.newCount}</strong></small>
            <small>复习中 <strong>{stats.reviewing}</strong></small>
            <small>已掌握 <strong>{stats.mastered}</strong></small>
          </div>
        </div>

        <section className="learning-progress-next">
          <ProgressItem icon={<Sparkles size={16} />} title="捕获候选" value={props.candidates.length} detail="从报告和问题提取知识点" />
          <ProgressItem icon={<CheckCircle2 size={16} />} title="审核入库" value={selectedCandidateCount} detail="人工确认后写入卡片" />
          <ProgressItem icon={<Clock3 size={16} />} title="复习队列" value={dailyReviewTarget} detail="今日优先复习的卡片" />
          <ProgressItem icon={<BookOpen size={16} />} title="掌握进度" value={`${masteredPercent}%`} detail="已掌握卡片占比" />
        </section>

        <section className="card-review-dashboard-next">
          <article>
            <span><Target size={15} />今日复习</span>
            <strong>{reviewQueue[0]?.title || "暂无待复习卡片"}</strong>
            <p>{reviewQueue.length ? `还有 ${reviewQueue.length} 张卡片需要巩固，建议先处理高强度和复习中的条目。` : "当前筛选范围内没有待复习内容，可以生成候选或创建新卡片。"}</p>
          </article>
          <article>
            <span><CalendarDays size={15} />沉淀节奏</span>
            <strong>{props.center?.today.card_count ?? stats.total}</strong>
            <p>今日新增或关联的知识卡片数量，用来观察学习沉淀是否跟上项目审查节奏。</p>
          </article>
          <article>
            <span><Layers3 size={15} />强度分布</span>
            <strong>{difficultyStats.hard} / {difficultyStats.medium} / {difficultyStats.easy}</strong>
            <p>高强度 / 中强度 / 入门卡片，优先把高风险问题转成可复习知识。</p>
          </article>
        </section>

        <form className="searchbar card-filter-row-next" onSubmit={(event) => { event.preventDefault(); props.onSearch(); }}>
          <Search size={18} />
          <input value={props.tag} onChange={(event) => props.onTagChange(event.target.value)} placeholder="按标签筛选，例如 安全、测试、重构" />
          <select value={props.status} onChange={(event) => props.onStatusFilter(event.target.value)}>
            <option value="all">全部状态</option>
            <option value="new">未掌握</option>
            <option value="reviewing">复习中</option>
            <option value="mastered">已掌握</option>
          </select>
          <select value={difficultyFilter} onChange={(event) => setDifficultyFilter(event.target.value as "all" | LearningCardDifficulty)}>
            <option value="all">全部强度</option>
            <option value="hard">高强度</option>
            <option value="medium">中强度</option>
            <option value="easy">入门</option>
          </select>
          <select value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value as "all" | CardSource)}>
            <option value="all">全部来源</option>
            <option value="finding">问题来源</option>
            <option value="workspace">项目来源</option>
            <option value="manual">手动创建</option>
          </select>
          <select value={sortMode} onChange={(event) => setSortMode(event.target.value as "review" | "newest" | "oldest")}>
            <option value="review">复习优先</option>
            <option value="newest">最新更新</option>
            <option value="oldest">最早创建</option>
          </select>
          <button type="submit">
            <Filter size={16} />
            筛选
          </button>
        </form>

        <div className="card-toolbar-next">
          <div className="tag-cloud-next">
            {tags.map((tag) => <button type="button" key={tag.name} onClick={() => props.onTagChange(tag.name)}><Tag size={13} />{tagLabel(tag.name)}<span>{tag.count}</span></button>)}
            {tags.length === 0 && <span>暂无标签，创建或生成卡片后会自动出现。</span>}
          </div>
          {props.onExportCards && (
            <button className="secondary-button" type="button" onClick={props.onExportCards} disabled={props.busy || props.cards.length === 0}>
              <Download size={16} />
              导出卡组
            </button>
          )}
        </div>

        <section className="card-candidate-review-next">
          <div className="report-head">
            <div>
              <h3>卡片候选审核</h3>
              <p>从报告和问题中提取候选知识点，人工确认后才写入知识卡片，避免把噪声直接放进复习库。</p>
            </div>
            <div className="button-row wrap">
              <button className="secondary-button" type="button" onClick={props.onGenerateCandidates}>
                <GraduationCap size={16} />
                从当前报告生成
              </button>
              <button className="primary-button" type="button" disabled={props.busy || selectedCandidateCount === 0} onClick={props.onApproveCandidates}>
                {props.busy ? <Loader2 className="spin" size={16} /> : <CheckCircle2 size={16} />}
                通过选中 {selectedCandidateCount ? `(${selectedCandidateCount})` : ""}
              </button>
            </div>
          </div>
          <div className="simple-list">
            {props.candidates.map((candidate) => (
              <label className="candidate-card" key={candidate.id}>
                <input type="checkbox" checked={props.selectedCandidateIds.includes(candidate.id)} onChange={(event) => props.onToggleCandidate(candidate.id, event.target.checked)} />
                <span>
                  <strong>{candidate.title}</strong>
                  <small>{candidateSourceLabel(candidate.source_kind)} · {difficultyLabel(candidate.difficulty)} · {candidate.tags.map(tagLabel).join("、") || "暂无标签"}</small>
                  <p>{candidate.content}</p>
                </span>
                <button className="mini-button" type="button" onClick={(event) => { event.preventDefault(); props.onRejectCandidate(candidate.id); }}>拒绝</button>
              </label>
            ))}
            {props.candidates.length === 0 && <p className="muted">暂无待审核候选。打开报告后可一键生成。</p>}
          </div>
        </section>

        <form className="control-panel" onSubmit={props.onCreateManual}>
          <div className="section-title-next">
            <span>手动沉淀</span>
            <h3>手动创建卡片</h3>
          </div>
          <div className="two-fields">
            <label>卡片标题<input value={props.manualTitle} onChange={(event) => props.onManualTitleChange(event.target.value)} placeholder="例如：为什么要参数化查询" /></label>
            <label>标签<input value={props.manualTags} onChange={(event) => props.onManualTagsChange(event.target.value)} placeholder="逗号分隔，如 安全,SQL" /></label>
          </div>
          <label>卡片内容<textarea value={props.manualContent} onChange={(event) => props.onManualContentChange(event.target.value)} placeholder="记录知识点、来源、复习提示..." /></label>
          <div className="button-row end">
            <button className="primary-button" disabled={props.busy} type="submit">
              {props.busy ? <Loader2 className="spin" size={18} /> : <Save size={18} />}
              创建卡片
            </button>
          </div>
        </form>

        <div className="card-grid">
          {visibleCards.map((card) => {
            const difficulty = cardDifficulty(card);
            return (
              <article className={props.activeCardId === card.id ? "learning-card active" : "learning-card"} key={card.id}>
                <button className="plain-card-button" onClick={() => props.onSelectCard(card.id)} type="button">
                  <div className="tag-row">
                    <span className={`card-difficulty-pill-next ${difficulty}`}>{difficultyLabel(difficulty)}</span>
                    <span>{cardSourceLabel(cardSource(card))}</span>
                    <span>{cardStatusLabel(card.status)}</span>
                  </div>
                  <h3>{card.title}</h3>
                  <p>{card.content}</p>
                  <small className="card-time-next">更新：{formatShortDate(card.updated_at)} · 创建：{formatShortDate(card.created_at)}</small>
                </button>
                <div className="button-row wrap">
                  <button className="mini-button" type="button" onClick={() => props.onUpdate(card.id, "new")}>未掌握</button>
                  <button className="mini-button" type="button" onClick={() => props.onUpdate(card.id, "reviewing")}>复习中</button>
                  <button className="mini-button" type="button" onClick={() => props.onUpdate(card.id, "mastered")}>已掌握</button>
                  <button className="mini-button" type="button" onClick={() => props.onGenerateMaterial(card.id)}>生成材料</button>
                  <button className="icon-button danger" type="button" onClick={() => props.onDelete(card.id)} aria-label="删除知识卡片"><Trash2 size={16} /></button>
                </div>
              </article>
            );
          })}
          {visibleCards.length === 0 && <div className="empty">当前筛选条件下暂无知识卡片。可以清空筛选、从问题清单生成，或手动创建。</div>}
        </div>
      </div>

      <article className="card-material-next">
        <div className="report-head">
          <div>
            <h3>{activeCard ? activeCard.title : "复习会话"}</h3>
            <p>{activeCard ? `状态：${cardStatusLabel(activeCard.status)} · 强度：${difficultyLabel(cardDifficulty(activeCard))} · 来源：${cardSourceLabel(cardSource(activeCard))}` : "选择卡片后查看来源、学习材料和复习自检步骤。"}</p>
          </div>
          {activeCard && (
            <div className="button-row wrap">
              <button className="secondary-button" type="button" onClick={() => props.onUpdate(activeCard.id, "new")}>
                <RotateCcw size={16} />
                仍未掌握
              </button>
              <button className="primary-button" type="button" onClick={() => props.onGenerateMaterial(activeCard.id)} disabled={props.busy}>
                {props.busy ? <Loader2 className="spin" size={16} /> : <GraduationCap size={16} />}
                生成材料
              </button>
            </div>
          )}
        </div>

        {activeCard ? (
          <>
            <section className="card-focus-next">
              <span>卡片内容</span>
              <p>{activeCard.content}</p>
              <div className="card-meta-grid-next">
                <small><Link2 size={14} />{activeCard.finding_id ? "关联问题" : activeCard.workspace_id ? "关联项目" : "手动记录"}</small>
                <small><Tag size={14} />{activeCard.tags.map(tagLabel).join("、") || "暂无标签"}</small>
                <small><Clock3 size={14} />{formatShortDate(activeCard.updated_at)}</small>
              </div>
              <div className="card-active-actions-next">
                <button className="mini-button" type="button" onClick={() => props.onUpdate(activeCard.id, "reviewing")}>标记复习中</button>
                <button className="mini-button" type="button" onClick={() => props.onUpdate(activeCard.id, "mastered")}>标记已掌握</button>
              </div>
            </section>

            <section className="card-review-session-next">
              <div className="section-title-next">
                <span><Target size={15} />复习自检</span>
                <h3>掌握这张卡片前需要回答的问题</h3>
              </div>
              <ol>
                <li>我能不能用一句话解释它对应的代码问题或设计经验？</li>
                <li>我能不能指出项目中可能出现同类问题的位置？</li>
                <li>我能不能写出一个检查步骤、测试用例或修复动作？</li>
              </ol>
            </section>

            <section className="card-material-summary-next">
              <article><span>学习材料</span><strong>{activeMaterials.length}</strong></article>
              <article><span>当前状态</span><strong>{cardStatusLabel(activeCard.status)}</strong></article>
              <article><span>卡片强度</span><strong>{difficultyLabel(cardDifficulty(activeCard))}</strong></article>
            </section>
          </>
        ) : (
          <div className="empty">从左侧选择一张卡片开始复习。</div>
        )}

        <section className="card-review-queue-next">
          <div className="section-title-next">
            <span><Layers3 size={15} />复习队列</span>
            <h3>下一批需要巩固的卡片</h3>
          </div>
          <div className="simple-list">
            {reviewQueue.map((card) => (
              <button className="review-card-row-next" key={card.id} onClick={() => props.onSelectCard(card.id)} type="button">
                <strong>{card.title}</strong>
                <span>{cardStatusLabel(card.status)} · {difficultyLabel(cardDifficulty(card))} · {card.tags.map(tagLabel).slice(0, 3).join("、") || "暂无标签"}</span>
              </button>
            ))}
            {reviewQueue.length === 0 && <p className="muted">暂无待复习卡片。</p>}
          </div>
        </section>

        {latestMaterial ? (
          <div className="report-document-rich">{latestMaterial.content.split("\n").map((line, index) => renderMarkdownLine(line, index))}</div>
        ) : (
          <div className="empty">选择卡片后点击“生成材料”，这里会显示可复习内容。</div>
        )}
      </article>
    </section>
  );
}

function ProgressItem({ icon, title, value, detail }: { icon: JSX.Element; title: string; value: number | string; detail: string }) {
  return (
    <article>
      <span>{icon}{title}</span>
      <strong>{value}</strong>
      <p>{detail}</p>
    </article>
  );
}

function learningCardStats(cards: LearningCard[]) {
  return {
    total: cards.length,
    newCount: cards.filter((card) => card.status === "new").length,
    reviewing: cards.filter((card) => card.status === "reviewing").length,
    mastered: cards.filter((card) => card.status === "mastered").length
  };
}

function learningDifficultyStats(cards: LearningCard[]) {
  return cards.reduce(
    (stats, card) => {
      stats[cardDifficulty(card)] += 1;
      return stats;
    },
    { easy: 0, medium: 0, hard: 0 } as Record<LearningCardDifficulty, number>
  );
}

function learningTagCloud(cards: LearningCard[]) {
  const map = new Map<string, number>();
  for (const card of cards) {
    for (const tag of card.tags) map.set(tag, (map.get(tag) || 0) + 1);
  }
  return Array.from(map.entries()).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 18);
}

function compareCards(left: LearningCard, right: LearningCard, sortMode: "review" | "newest" | "oldest") {
  if (sortMode === "newest") return right.updated_at.localeCompare(left.updated_at);
  if (sortMode === "oldest") return left.created_at.localeCompare(right.created_at);
  const statusPriority: Record<string, number> = { reviewing: 0, new: 1, mastered: 2 };
  const leftPriority = statusPriority[left.status] ?? 3;
  const rightPriority = statusPriority[right.status] ?? 3;
  if (leftPriority !== rightPriority) return leftPriority - rightPriority;
  const difficultyPriority: Record<LearningCardDifficulty, number> = { hard: 0, medium: 1, easy: 2 };
  return difficultyPriority[cardDifficulty(left)] - difficultyPriority[cardDifficulty(right)] || right.updated_at.localeCompare(left.updated_at);
}

function cardDifficulty(card: LearningCard): LearningCardDifficulty {
  const text = `${card.title} ${card.content} ${card.tags.join(" ")}`.toLowerCase();
  if (text.includes("high") || text.includes("高风险") || text.includes("安全") || text.includes("security") || card.content.length > 520) return "hard";
  if (text.includes("medium") || text.includes("重构") || text.includes("测试") || text.includes("可靠") || card.content.length > 240) return "medium";
  return "easy";
}

function cardSource(card: LearningCard): CardSource {
  if (card.finding_id) return "finding";
  if (card.workspace_id) return "workspace";
  return "manual";
}

function renderMarkdownLine(line: string, index: number) {
  const trimmed = line.trim();
  if (trimmed.startsWith("# ")) return <h3 key={index}>{trimmed.slice(2)}</h3>;
  if (trimmed.startsWith("## ")) return <h4 key={index}>{trimmed.slice(3)}</h4>;
  if (trimmed.startsWith("- ")) return <p className="doc-list" key={index}>{trimmed}</p>;
  if (!trimmed) return <div className="doc-gap" key={index} />;
  return <p key={index}>{line}</p>;
}

function severityLabel(value: string) {
  const labels: Record<string, string> = { high: "高风险", medium: "中风险", low: "低风险", info: "提示" };
  return labels[value] || value;
}

function categoryLabel(value: string) {
  const labels: Record<string, string> = {
    security: "安全",
    quality: "质量",
    reliability: "可靠性",
    maintainability: "可维护性",
    test: "测试",
    refactor: "重构"
  };
  return labels[value] || value;
}

function cardStatusLabel(value: string) {
  const labels: Record<string, string> = {
    new: "未掌握",
    reviewing: "复习中",
    mastered: "已掌握"
  };
  return labels[value] || value;
}

function difficultyLabel(value: string) {
  const labels: Record<string, string> = { easy: "入门", medium: "中强度", hard: "高强度" };
  return labels[value] || value;
}

function candidateSourceLabel(value: string) {
  const labels: Record<string, string> = {
    report: "报告",
    finding: "问题",
    manual: "手动",
    card: "卡片"
  };
  return labels[value] || "本地分析";
}

function cardSourceLabel(value: CardSource) {
  const labels: Record<CardSource, string> = {
    finding: "问题来源",
    workspace: "项目来源",
    manual: "手动创建"
  };
  return labels[value];
}

function tagLabel(value: string) {
  return severityLabel(categoryLabel(value));
}

function formatShortDate(value: string) {
  if (!value) return "未知";
  return value.slice(0, 10);
}
