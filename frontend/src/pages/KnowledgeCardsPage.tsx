import {
  BookMarked,
  Check,
  ChevronDown,
  ExternalLink,
  Loader2,
  NotebookPen,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { CalendarPopover, dateKeyFromIso } from "../components/CalendarPopover";
import { LearningCardCandidatePanel } from "../components/LearningCardCandidatePanel";
import { CodeSnippetBlock, MarkdownDocument } from "../components/MarkdownDocument";
import { api } from "../lib/api";
import { formatTime } from "../lib/format";
import type {
  LearningCardCandidate,
  LearningCardItem,
  LearningCardMaterialItem,
  LearningCardStatus,
  LearningCardTagSuggestion,
} from "../types";

const statusOptions: Array<{ value: LearningCardStatus | ""; label: string }> = [
  { value: "", label: "全部" },
  { value: "new", label: "新卡片" },
  { value: "reviewing", label: "复习中" },
  { value: "bookmarked", label: "收藏" },
  { value: "mastered", label: "已掌握" },
];

export function KnowledgeCardsPage({
  openCardId,
  onOpenCardConsumed,
  onOpenSourceReport,
}: {
  openCardId?: string | null;
  onOpenCardConsumed?: () => void;
  onOpenSourceReport?: (reportId: string) => void;
}) {
  const [cards, setCards] = useState<LearningCardItem[]>([]);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<LearningCardStatus | "">("");
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftExplanation, setDraftExplanation] = useState("");
  const [draftTags, setDraftTags] = useState("");
  const [selectedCard, setSelectedCard] = useState<LearningCardItem | null>(null);
  const [selectedMaterial, setSelectedMaterial] = useState<LearningCardMaterialItem | null>(null);
  const [materialCache, setMaterialCache] = useState<Record<string, LearningCardMaterialItem>>({});
  const [materialLoading, setMaterialLoading] = useState(false);
  const [materialGenerating, setMaterialGenerating] = useState(false);
  const [notesDraft, setNotesDraft] = useState("");
  const [savingNotes, setSavingNotes] = useState(false);
  const [candidateCards, setCandidateCards] = useState<LearningCardCandidate[]>([]);
  const [tagSuggestions, setTagSuggestions] = useState<LearningCardTagSuggestion[]>([]);
  const [selectedSuggestionIds, setSelectedSuggestionIds] = useState<Set<string>>(() => new Set());
  const [tagSuggesting, setTagSuggesting] = useState(false);
  const [tagApplying, setTagApplying] = useState(false);

  const dateMarkers = useMemo(() => {
    return cards.reduce<Record<string, number>>((acc, card) => {
      const key = dateKeyFromIso(card.created_at);
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {});
  }, [cards]);
  const visibleCards = useMemo(
    () => selectedDate ? cards.filter((card) => dateKeyFromIso(card.created_at) === selectedDate) : cards,
    [cards, selectedDate],
  );
  const statusLabelText = statusOptions.find((option) => option.value === status)?.label ?? "全部";

  async function load() {
    setLoading(true);
    setError("");
    try {
      setCards(await api.learningCards({ query, status: status || undefined }));
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "知识卡片加载失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [status]);

  useEffect(() => {
    if (!openCardId || !cards.length) return;
    const card = cards.find((item) => item.id === openCardId);
    if (card) {
      void openCard(card);
      onOpenCardConsumed?.();
    }
  }, [openCardId, cards]);

  async function generate() {
    setGenerating(true);
    setNotice("");
    setError("");
    setCandidateCards([]);
    try {
      const result = await api.generateLearningCards(12);
      setCandidateCards(result.candidates ?? []);
      setNotice(result.candidates?.length ? `已从历史报告提炼 ${result.candidates.length} 张候选卡片，跳过 ${result.skipped} 个重复知识点。` : "未从历史报告中提炼到新的候选卡片。");
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "生成知识卡片失败");
    } finally {
      setGenerating(false);
    }
  }

  async function createManualCard() {
    if (!draftTitle.trim() || !draftExplanation.trim()) return;
    setError("");
    try {
      await api.createLearningCard({
        title: draftTitle,
        explanation: draftExplanation,
        source_type: "manual",
        tags: normalizeTagInput(draftTags || draftTitle).slice(0, 6),
      });
      setDraftTitle("");
      setDraftExplanation("");
      setDraftTags("");
      setCreateOpen(false);
      await load();
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "创建知识卡片失败");
    }
  }

  async function updateStatus(card: LearningCardItem, nextStatus: LearningCardStatus) {
    const updated = await api.updateLearningCard(card.id, { status: nextStatus });
    setCards((current) => current.map((item) => item.id === card.id ? updated : item));
    setSelectedCard((current) => current?.id === updated.id ? updated : current);
  }

  async function removeCard(card: LearningCardItem) {
    await api.deleteLearningCard(card.id);
    setCards((current) => current.filter((item) => item.id !== card.id));
    setSelectedCard((current) => current?.id === card.id ? null : current);
  }

  async function openCard(card: LearningCardItem) {
    setSelectedCard(card);
    setNotesDraft(card.notes ?? "");
    if (materialCache[card.id]) {
      setSelectedMaterial(materialCache[card.id]);
      setMaterialLoading(false);
      return;
    }

    setSelectedMaterial(null);
    setMaterialLoading(true);
    try {
      const material = await api.learningCardMaterial(card.id);
      setSelectedMaterial(material);
      setMaterialCache((current) => ({ ...current, [card.id]: material }));
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "学习资料加载失败");
    } finally {
      setMaterialLoading(false);
    }
  }

  async function generateMaterial() {
    if (!selectedCard) return;
    setMaterialGenerating(true);
    setError("");
    try {
      const material = await api.generateLearningCardMaterial(selectedCard.id);
      setSelectedMaterial(material);
      setMaterialCache((current) => ({ ...current, [selectedCard.id]: material }));
      setNotice("学习资料已生成。");
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "生成学习资料失败");
    } finally {
      setMaterialGenerating(false);
    }
  }

  async function saveNotes() {
    if (!selectedCard) return;
    setSavingNotes(true);
    setError("");
    try {
      const updated = await api.updateLearningCard(selectedCard.id, { notes: notesDraft });
      setCards((current) => current.map((item) => item.id === updated.id ? updated : item));
      setSelectedCard(updated);
      setNotice("笔记已保存。");
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "保存笔记失败");
    } finally {
      setSavingNotes(false);
    }
  }

  async function suggestTags() {
    setTagSuggesting(true);
    setNotice("");
    setError("");
    try {
      const result = await api.suggestLearningCardTags(120);
      setTagSuggestions(result.suggestions);
      setSelectedSuggestionIds(new Set(result.suggestions.map((item) => item.id)));
      setNotice(result.suggestions.length ? `AI 给出了 ${result.suggestions.length} 条标签整理建议，请确认后再应用。` : "当前标签已经比较干净，暂未发现需要整理的建议。");
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "AI 标签整理失败");
    } finally {
      setTagSuggesting(false);
    }
  }

  async function applyTagSuggestions() {
    const selected = tagSuggestions.filter((item) => selectedSuggestionIds.has(item.id));
    if (!selected.length) return;
    setTagApplying(true);
    setError("");
    try {
      const result = await api.applyLearningCardTagSuggestions(selected);
      setNotice(`已根据确认项更新 ${result.updated} 张知识卡片。`);
      setTagSuggestions([]);
      setSelectedSuggestionIds(new Set());
      await load();
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "应用标签整理建议失败");
    } finally {
      setTagApplying(false);
    }
  }

  return (
    <div className="page-scroll learning-page knowledge-page">
      <section className="learning-hero compact-learning-hero">
        <div>
          <span className="learning-kicker"><BookMarked size={14} /> Knowledge Cards</span>
          <h2>知识卡片</h2>
          <p>从报告和手动记录中沉淀知识点，形成可复习、可标记掌握状态的学习资产。</p>
        </div>
        <div className="learning-hero-actions learning-card-hero-actions">
          <button className="btn btn-primary" onClick={generate} disabled={generating} type="button">
            {generating ? <Loader2 className="animate-spin" size={15} /> : <RefreshCw size={15} />}
            从历史报告智能提炼
          </button>
          <button className="btn btn-secondary" onClick={suggestTags} disabled={tagSuggesting} type="button">
            {tagSuggesting ? <Loader2 className="animate-spin" size={15} /> : <Sparkles size={15} />}
            AI 整理标签
          </button>
        </div>
      </section>

      {error ? <div className="chat-panel-error">{error}</div> : null}
      {notice ? <div className="learning-notice">{notice}</div> : null}

      <section className="learning-surface learning-card-controls compact-learning-controls">
        <button className="btn btn-primary" onClick={() => setCreateOpen(true)} type="button">
          <Plus size={15} />
          新建
        </button>
        <div className="learning-search">
          <Search size={15} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => event.key === "Enter" && void load()} placeholder="搜索知识点、解释或标签" />
        </div>
        <div className="knowledge-filter-cluster">
          <div className="filter-popover-wrap">
            <button className="filter-popover-trigger" onClick={() => setStatusMenuOpen((value) => !value)} type="button">
              <span>按状态：{statusLabelText}</span>
              <ChevronDown size={15} />
            </button>
            {statusMenuOpen ? (
              <div className="filter-popover-menu">
                {statusOptions.map((option) => (
                  <button
                    key={option.label}
                    className={status === option.value ? "active" : ""}
                    onClick={() => {
                      setStatus(option.value);
                      setStatusMenuOpen(false);
                    }}
                    type="button"
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <CalendarPopover
            value={selectedDate}
            onChange={setSelectedDate}
            markers={dateMarkers}
            label={selectedDate ? `按日期：${selectedDate.slice(5)}` : "按日期"}
          />
        </div>
        <button className="btn btn-secondary" onClick={load} disabled={loading} type="button">
          <RefreshCw className={loading ? "animate-spin" : ""} size={15} />
          查询
        </button>
      </section>

      {createOpen ? (
        <ManualCardDialog
          draftExplanation={draftExplanation}
          draftTags={draftTags}
          draftTitle={draftTitle}
          onClose={() => {
            setCreateOpen(false);
            setDraftTitle("");
            setDraftExplanation("");
            setDraftTags("");
          }}
          onExplanationChange={setDraftExplanation}
          onSave={() => void createManualCard()}
          onTagsChange={setDraftTags}
          onTitleChange={setDraftTitle}
        />
      ) : null}

      {candidateCards.length ? (
        <LearningCardCandidatePanel
          candidates={candidateCards}
          title="历史报告候选卡片"
          description="这些候选来自最近报告的语义提炼。你可以编辑后选择保存。"
          onDismiss={() => setCandidateCards([])}
          onSaved={async (created, skipped) => {
            setNotice(`已保存 ${created} 张知识卡片，跳过 ${skipped} 张重复卡片。`);
            setCandidateCards([]);
            await load();
          }}
        />
      ) : null}

      {tagSuggestions.length ? (
        <TagSuggestionPanel
          applying={tagApplying}
          selectedIds={selectedSuggestionIds}
          suggestions={tagSuggestions}
          onApply={() => void applyTagSuggestions()}
          onDismiss={() => {
            setTagSuggestions([]);
            setSelectedSuggestionIds(new Set());
          }}
          onToggle={(id) => {
            setSelectedSuggestionIds((current) => {
              const next = new Set(current);
              if (next.has(id)) next.delete(id);
              else next.add(id);
              return next;
            });
          }}
        />
      ) : null}

      <section className="learning-card-board">
        {visibleCards.map((card) => (
          <KnowledgeCard key={card.id} card={card} onOpen={() => openCard(card)} onRemove={() => void removeCard(card)} onStatus={(next) => void updateStatus(card, next)} />
        ))}
        {!cards.length ? <div className="learning-empty-card">还没有知识卡片，可以先从最近报告生成一批。</div> : null}
        {cards.length && !visibleCards.length ? <div className="learning-empty-card">当前筛选下没有知识卡片。</div> : null}
      </section>

      {selectedCard ? (
        <KnowledgeCardDetail
          card={selectedCard}
          material={selectedMaterial}
          materialLoading={materialLoading}
          materialGenerating={materialGenerating}
          notesDraft={notesDraft}
          savingNotes={savingNotes}
          onClose={() => setSelectedCard(null)}
          onGenerateMaterial={() => void generateMaterial()}
          onNotesChange={setNotesDraft}
          onSaveNotes={() => void saveNotes()}
          onStatus={(next) => void updateStatus(selectedCard, next)}
          onOpenSourceReport={onOpenSourceReport}
        />
      ) : null}
    </div>
  );
}

function ManualCardDialog({
  draftTitle,
  draftExplanation,
  draftTags,
  onTitleChange,
  onExplanationChange,
  onTagsChange,
  onSave,
  onClose,
}: {
  draftTitle: string;
  draftExplanation: string;
  draftTags: string;
  onTitleChange: (value: string) => void;
  onExplanationChange: (value: string) => void;
  onTagsChange: (value: string) => void;
  onSave: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const dialog = (
    <div className="knowledge-create-overlay" role="dialog" aria-modal="true" aria-label="新建知识卡片">
      <section className="knowledge-create-card">
        <div className="knowledge-create-head">
          <div>
            <span><Plus size={14} /> New Card</span>
            <h3>新建知识卡片</h3>
          </div>
          <button className="icon-button" onClick={onClose} type="button" title="关闭">
            <X size={16} />
          </button>
        </div>
        <input value={draftTitle} onChange={(event) => onTitleChange(event.target.value)} placeholder="知识点标题，例如：异常处理" autoFocus />
        <textarea value={draftExplanation} onChange={(event) => onExplanationChange(event.target.value)} placeholder="用一两句话说明这个知识点的核心含义。" />
        <input value={draftTags} onChange={(event) => onTagsChange(event.target.value)} placeholder="标签，用顿号、逗号或空格分隔" />
        <div className="knowledge-create-actions">
          <button className="btn btn-secondary" onClick={onClose} type="button">取消</button>
          <button className="btn btn-primary" onClick={onSave} disabled={!draftTitle.trim() || !draftExplanation.trim()} type="button">
            <Check size={15} />
            保存卡片
          </button>
        </div>
      </section>
    </div>
  );
  return createPortal(dialog, document.body);
}

function KnowledgeCard({
  card,
  onOpen,
  onStatus,
  onRemove,
}: {
  card: LearningCardItem;
  onOpen: () => void;
  onStatus: (status: LearningCardStatus) => void;
  onRemove: () => void;
}) {
  return (
    <article className={`knowledge-card knowledge-card-${card.status}`} onClick={onOpen} role="button" tabIndex={0} onKeyDown={(event) => event.key === "Enter" && onOpen()}>
      <div className="knowledge-card-head">
        <div>
          <span>{card.language_label} · {card.difficulty}</span>
          <h3>{card.title}</h3>
        </div>
        <button className="icon-button knowledge-card-delete h-8 w-8" onClick={(event) => { event.stopPropagation(); onRemove(); }} type="button" title="删除">
          <Trash2 size={14} />
        </button>
      </div>
      <p>{card.explanation}</p>
      {card.code_excerpt ? <CodeSnippetBlock code={card.code_excerpt} language={languageForCodeBlock(card.language_label)} compact /> : null}
      <div className="knowledge-tags">
        {card.tags.slice(0, 3).map((tag) => <span key={tag}>{tag}</span>)}
        {card.tags.length > 3 ? <span>+{card.tags.length - 3}</span> : null}
      </div>
      <div className="knowledge-card-foot">
        <time>{formatTime(card.updated_at)}</time>
        <div>
          <button onClick={(event) => { event.stopPropagation(); onStatus("bookmarked"); }} className={card.status === "bookmarked" ? "active" : ""} type="button"><Star size={13} /> 收藏</button>
          <button onClick={(event) => { event.stopPropagation(); onStatus("reviewing"); }} className={card.status === "reviewing" ? "active" : ""} type="button">复习</button>
          <button onClick={(event) => { event.stopPropagation(); onStatus("mastered"); }} className={card.status === "mastered" ? "active" : ""} type="button"><Check size={13} /> 掌握</button>
        </div>
      </div>
    </article>
  );
}

function KnowledgeCardDetail({
  card,
  material,
  materialLoading,
  materialGenerating,
  notesDraft,
  savingNotes,
  onClose,
  onGenerateMaterial,
  onNotesChange,
  onSaveNotes,
  onStatus,
  onOpenSourceReport,
}: {
  card: LearningCardItem;
  material: LearningCardMaterialItem | null;
  materialLoading: boolean;
  materialGenerating: boolean;
  notesDraft: string;
  savingNotes: boolean;
  onClose: () => void;
  onGenerateMaterial: () => void;
  onNotesChange: (value: string) => void;
  onSaveNotes: () => void;
  onStatus: (status: LearningCardStatus) => void;
  onOpenSourceReport?: (reportId: string) => void;
}) {
  const [splitPercent, setSplitPercent] = useState(58);
  const [resizingSplit, setResizingSplit] = useState(false);
  const materialContent = normalizeLearningMaterialMarkdown(material?.content_markdown || card.detail_markdown || card.explanation);
  const hasSourceReport = card.source_type === "report" && Boolean(card.source_id);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  useEffect(() => {
    if (!resizingSplit) return;
    function handlePointerMove(event: PointerEvent) {
      const splitBody = document.querySelector<HTMLElement>(".knowledge-fullscreen-body");
      if (!splitBody) return;
      const rect = splitBody.getBoundingClientRect();
      if (!rect.width) return;
      const nextPercent = ((event.clientX - rect.left) / rect.width) * 100;
      setSplitPercent(Number(Math.min(72, Math.max(38, nextPercent)).toFixed(1)));
    }
    function handlePointerUp() {
      setResizingSplit(false);
    }
    document.body.classList.add("is-resizing-knowledge-split");
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
    return () => {
      document.body.classList.remove("is-resizing-knowledge-split");
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };
  }, [resizingSplit]);

  const detail = (
    <div className="knowledge-fullscreen-overlay" role="dialog" aria-modal="true" aria-label={`${card.title} 学习详情`}>
      <div className="knowledge-fullscreen-shell">
        <header className="knowledge-fullscreen-header">
          <div className="flex min-w-0 items-center gap-3">
            <div className="h-6 w-1 rounded-full bg-pine" />
            <div>
              <p className="text-[0.68rem] font-black uppercase tracking-[0.24em] text-pine">Learning Card</p>
              <h2 className="truncate text-base font-black text-ink">{card.title}</h2>
            </div>
          </div>
          <div className="knowledge-fullscreen-actions">
            <button className="btn btn-secondary" onClick={onGenerateMaterial} disabled={materialGenerating} type="button">
              {materialGenerating ? <Loader2 className="animate-spin" size={15} /> : <Sparkles size={15} />}
              {material?.cached ? "重新生成资料" : "生成资料"}
            </button>
            {material?.updated_at ? <span>更新：{formatTime(material.updated_at)}</span> : null}
            <button className="icon-button" onClick={onClose} type="button" title="关闭">
              <X size={18} />
            </button>
          </div>
        </header>

        <div className="knowledge-fullscreen-body" style={{ "--knowledge-split": `${splitPercent}%` } as CSSProperties}>
          <section className="knowledge-material-pane">
            <div className="knowledge-detail-head">
              <div>
                <span>学习资料 · {material?.cached ? "已缓存" : "即时讲解"}</span>
                <h2>{card.title}</h2>
              </div>
            </div>
            <div className="knowledge-material-document">
              {materialLoading ? (
                <p className="learning-empty"><Loader2 className="animate-spin" size={16} /> 正在加载学习资料...</p>
              ) : (
                <MarkdownDocument content={materialContent} className="knowledge-material-markdown" />
              )}
            </div>
            <div className="knowledge-source-strip">
              {(material?.source_links ?? card.resource_links ?? []).slice(0, 4).map((resource) => (
                <a key={resource.url} href={resource.url} target="_blank" rel="noreferrer">
                  {resource.title}<ExternalLink size={11} />
                </a>
              ))}
            </div>
          </section>

          <button
            className="knowledge-fullscreen-resizer"
            onPointerDown={(event) => {
              event.preventDefault();
              setResizingSplit(true);
            }}
            title="拖拽调整学习资料和个人卡片宽度"
            type="button"
            aria-label="拖拽调整学习资料和个人卡片宽度"
          >
            <span />
          </button>

          <section className="knowledge-personal-pane">
            <div className="knowledge-card-summary">
              <span>{card.language_label} · {card.difficulty} · {statusLabel(card.status)}</span>
              <h3>{card.title}</h3>
              <p>{card.explanation}</p>
            </div>

            {card.code_excerpt ? (
              <section className="knowledge-detail-section">
                <h3>相关代码片段</h3>
                <CodeSnippetBlock code={card.code_excerpt} language={languageForCodeBlock(card.language_label)} />
              </section>
            ) : null}

            <section className="knowledge-detail-section">
              <h3>来源与延伸阅读</h3>
              <div className="knowledge-source-report">
                <span>{card.source_id ? `来源：${card.source_type === "report" ? "历史报告" : card.source_type}` : "来源：手动记录"}</span>
                {hasSourceReport ? (
                  <button className="btn btn-secondary h-8" onClick={() => onOpenSourceReport?.(card.source_id ?? "")} type="button">
                    查看来源报告
                  </button>
                ) : null}
              </div>
              <div className="knowledge-resource-list">
                {(card.resource_links ?? []).map((resource) => (
                  <a key={resource.url} href={resource.url} target="_blank" rel="noreferrer">
                    <strong>{resource.title}<ExternalLink size={12} /></strong>
                    {resource.description ? <span>{resource.description}</span> : null}
                  </a>
                ))}
                {!card.resource_links?.length ? <p className="learning-empty">暂无推荐资源。</p> : null}
              </div>
            </section>

            <section className="knowledge-detail-section">
              <h3><NotebookPen size={15} /> 我的笔记</h3>
              <textarea value={notesDraft} onChange={(event) => onNotesChange(event.target.value)} placeholder="记录你自己的理解、例子、疑问或下次复习要注意的点。" />
              <div className="knowledge-detail-actions">
                <div>
                  <button onClick={() => onStatus("bookmarked")} className={card.status === "bookmarked" ? "active" : ""} type="button"><Star size={13} /> 收藏</button>
                  <button onClick={() => onStatus("reviewing")} className={card.status === "reviewing" ? "active" : ""} type="button">复习中</button>
                  <button onClick={() => onStatus("mastered")} className={card.status === "mastered" ? "active" : ""} type="button"><Check size={13} /> 已掌握</button>
                </div>
                <button className="btn btn-primary" onClick={onSaveNotes} disabled={savingNotes} type="button">
                  {savingNotes ? <Loader2 className="animate-spin" size={15} /> : <NotebookPen size={15} />}
                  保存笔记
                </button>
              </div>
            </section>

            <div className="knowledge-tags">
              {card.tags.map((tag) => <span key={tag}>{tag}</span>)}
            </div>
          </section>
        </div>
      </div>
    </div>
  );

  return typeof document === "undefined" ? detail : createPortal(detail, document.body);
}

function TagSuggestionPanel({
  suggestions,
  selectedIds,
  applying,
  onToggle,
  onApply,
  onDismiss,
}: {
  suggestions: LearningCardTagSuggestion[];
  selectedIds: Set<string>;
  applying: boolean;
  onToggle: (id: string) => void;
  onApply: () => void;
  onDismiss: () => void;
}) {
  return (
    <section className="learning-surface tag-suggestion-panel">
      <div className="tag-suggestion-head">
        <div>
          <span><Sparkles size={14} /> AI 标签整理建议</span>
          <h3>确认后再应用到知识卡片</h3>
        </div>
        <button className="icon-button" onClick={onDismiss} type="button" title="关闭建议">
          <X size={16} />
        </button>
      </div>
      <div className="tag-suggestion-list">
        {suggestions.map((suggestion) => (
          <label className="tag-suggestion-item" key={suggestion.id}>
            <input checked={selectedIds.has(suggestion.id)} onChange={() => onToggle(suggestion.id)} type="checkbox" />
            <span>
              <strong>{suggestion.title}</strong>
              <em>{suggestion.reason}</em>
              <i>
                {suggestion.from_tags.length ? `原标签：${suggestion.from_tags.join("、")}` : ""}
                {suggestion.to_tags.length ? ` -> 新标签：${suggestion.to_tags.join("、")}` : ""}
                {` · 影响 ${suggestion.card_ids.length} 张卡片`}
              </i>
            </span>
          </label>
        ))}
      </div>
      <div className="tag-suggestion-actions">
        <button className="btn btn-secondary" onClick={onDismiss} type="button">暂不应用</button>
        <button className="btn btn-primary" onClick={onApply} disabled={applying || !selectedIds.size} type="button">
          {applying ? <Loader2 className="animate-spin" size={15} /> : <Check size={15} />}
          应用已选建议
        </button>
      </div>
    </section>
  );
}

function statusLabel(status: LearningCardStatus) {
  if (status === "mastered") return "已掌握";
  if (status === "reviewing") return "复习中";
  if (status === "bookmarked") return "收藏";
  return "新卡片";
}

function normalizeLearningMaterialMarkdown(content: string) {
  const sectionTitles = ["概念解释", "适用场景", "最小示例", "常见误区", "延伸阅读"];
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const normalized: string[] = [];
  let inFence = false;

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();
    if (trimmed.startsWith("```")) {
      inFence = !inFence;
      normalized.push(line);
      continue;
    }
    if (!inFence) {
      const title = sectionTitles.find((item) => trimmed === item || trimmed === `## ${item}` || trimmed === `### ${item}`);
      if (title) {
        if (normalized.length && normalized[normalized.length - 1] !== "") normalized.push("");
        normalized.push(`## ${title}`);
        normalized.push("");
        continue;
      }
    }
    normalized.push(line);
  }

  return normalized.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function normalizeTagInput(value: string[] | string) {
  const source = Array.isArray(value) ? value : value.split(/[、,\s]+/);
  const result: string[] = [];
  const seen = new Set<string>();
  for (const raw of source) {
    const tag = String(raw || "").trim().replace(/^#/, "");
    const key = tag.toLowerCase();
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    result.push(tag.slice(0, 32));
    if (result.length >= 8) break;
  }
  return result;
}

function languageForCodeBlock(languageLabel: string) {
  const normalized = languageLabel.toLowerCase();
  if (normalized.includes("python")) return "python";
  if (normalized.includes("typescript")) return "typescript";
  if (normalized.includes("javascript")) return "javascript";
  if (normalized.includes("java")) return "java";
  if (normalized.includes("c++") || normalized.includes("cpp")) return "cpp";
  if (normalized.includes("sql")) return "sql";
  return "";
}
