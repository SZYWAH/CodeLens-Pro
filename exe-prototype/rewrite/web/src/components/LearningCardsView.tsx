import { ArrowUpRight, BookOpen, Check, ChevronLeft, Download, FileText, GraduationCap, Loader2, Plus, RefreshCw, Search, ShieldAlert, SlidersHorizontal, Tag, Trash2, X } from "lucide-react";
import type { FormEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CardMaterial, Finding, LearningCard, LearningCardCandidate, LearningCenterData } from "../types";
import { useOverlayFocus } from "../hooks/useOverlayFocus";
import { AccessibleListbox, type ListboxOption } from "./AccessibleListbox";
import { ProductToolbar } from "./ProductShell";

type Difficulty = "easy" | "medium" | "hard";
type Source = "manual" | "finding" | "workspace";
type DrawerTab = "candidates" | "manual";

const statusOptions: ListboxOption[] = [
  { value: "all", label: "全部状态" },
  { value: "new", label: "未掌握" },
  { value: "reviewing", label: "复习中" },
  { value: "mastered", label: "已掌握" }
];

const difficultyOptions: ListboxOption[] = [
  { value: "all", label: "全部难度" },
  { value: "hard", label: "高强度" },
  { value: "medium", label: "中强度" },
  { value: "easy", label: "入门" }
];

const sourceOptions: ListboxOption[] = [
  { value: "all", label: "全部来源" },
  { value: "finding", label: "问题来源" },
  { value: "workspace", label: "项目来源" },
  { value: "manual", label: "手动创建" }
];

const sortOptions: ListboxOption[] = [
  { value: "review", label: "复习优先" },
  { value: "newest", label: "最近更新" },
  { value: "oldest", label: "最早创建" }
];

export function LearningCardsView(props: {
  cards: LearningCard[];
  materials: CardMaterial[];
  candidates: LearningCardCandidate[];
  selectedCandidateIds: string[];
  activeCardId: string | null;
  sourceFinding: Finding | null;
  sourceReportTitle: string | null;
  center?: LearningCenterData | null;
  status: string;
  query: string;
  manualTitle: string;
  manualContent: string;
  manualTags: string;
  busy: boolean;
  onStatusFilter: (value: string) => Promise<void>;
  onQueryChange: (value: string) => void;
  onManualTitleChange: (value: string) => void;
  onManualContentChange: (value: string) => void;
  onManualTagsChange: (value: string) => void;
  onToggleCandidate: (id: string, selected: boolean) => void;
  onApproveCandidates: () => Promise<void>;
  onRejectCandidate: (id: string) => Promise<void>;
  onGenerateCandidates: () => Promise<void>;
  onCreateManual: (event: FormEvent) => Promise<void>;
  onUpdate: (id: string, status: string) => Promise<unknown>;
  onDelete: (id: string) => Promise<void>;
  onGenerateMaterial: (id: string) => Promise<void>;
  onSelectCard: (id: string | null) => Promise<void>;
  onOpenFindings: () => void;
  onOpenSourceFinding?: () => void;
  onOpenSourceReport?: () => void;
  onExportCards?: () => void;
}) {
  const [difficulty, setDifficulty] = useState<"all" | Difficulty>("all");
  const [source, setSource] = useState<"all" | Source>("all");
  const [sort, setSort] = useState<"review" | "newest" | "oldest">("review");
  const [drawer, setDrawer] = useState<DrawerTab | null>(null);
  const [mobileIndexOpen, setMobileIndexOpen] = useState(false);
  const [filterPanelOpen, setFilterPanelOpen] = useState(false);
  const [filterBusy, setFilterBusy] = useState(false);
  const [pendingCardId, setPendingCardId] = useState<string | null>(null);
  const [statusOverrides, setStatusOverrides] = useState<Record<string, string>>({});
  const [deleteTarget, setDeleteTarget] = useState<LearningCard | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const deleteTriggerRef = useRef<HTMLButtonElement | null>(null);
  const deleteDialogRef = useRef<HTMLElement | null>(null);
  const deleteCancelRef = useRef<HTMLButtonElement | null>(null);
  const mobileIndexTriggerRef = useRef<HTMLButtonElement | null>(null);
  const mobileIndexRef = useRef<HTMLElement | null>(null);
  const mobileIndexCloseRef = useRef<HTMLButtonElement | null>(null);
  const drawerTriggerRef = useRef<HTMLElement | null>(null);
  const drawerRef = useRef<HTMLElement | null>(null);
  const drawerCloseRef = useRef<HTMLButtonElement | null>(null);
  const filterTriggerRef = useRef<HTMLButtonElement | null>(null);
  const filterPanelRef = useRef<HTMLDivElement | null>(null);
  const previousCardCountRef = useRef(props.cards.length);

  const effectiveStatus = (card: LearningCard) => statusOverrides[card.id] || card.status;
  const visible = useMemo(() => {
    const normalizedQuery = props.query.trim().toLowerCase();
    return props.cards
      .filter((card) => !normalizedQuery || `${card.title} ${card.content} ${card.tags.join(" ")}`.toLowerCase().includes(normalizedQuery))
      .filter((card) => props.status === "all" || effectiveStatus(card) === props.status)
      .filter((card) => difficulty === "all" || cardDifficulty(card) === difficulty)
      .filter((card) => source === "all" || cardSource(card) === source)
      .sort((left, right) => compareCards(left, right, sort, effectiveStatus));
  }, [props.cards, props.query, props.status, difficulty, source, sort, statusOverrides]);
  const libraryEmpty = props.cards.length === 0;
  const filteredEmpty = !libraryEmpty && visible.length === 0;
  const active = filteredEmpty ? null : visible.find((card) => card.id === props.activeCardId) || visible[0] || null;
  const materials = active ? props.materials.filter((item) => item.card_id === active.id) : [];
  const latestMaterial = materials[0] || null;
  const reviewQueue = visible.filter((card) => effectiveStatus(card) !== "mastered" && card.id !== active?.id);
  const mastered = props.cards.filter((card) => effectiveStatus(card) === "mastered").length;
  const masteredPercent = props.cards.length ? Math.round(mastered / props.cards.length * 100) : 0;
  const activeStatus = active ? effectiveStatus(active) : "new";
  const advancedFilterCount = Number(difficulty !== "all") + Number(source !== "all") + Number(sort !== "review");

  useEffect(() => {
    if (libraryEmpty) {
      if (props.activeCardId) void props.onSelectCard(null);
      return;
    }
    if (filteredEmpty) return;
    const nextId = active?.id || null;
    if (nextId !== props.activeCardId) void props.onSelectCard(nextId);
  }, [active?.id, filteredEmpty, libraryEmpty, props.activeCardId, props.onSelectCard]);

  useEffect(() => {
    const previousCount = previousCardCountRef.current;
    previousCardCountRef.current = props.cards.length;
    if (previousCount !== 0 || props.cards.length === 0) return;
    props.onQueryChange("");
    setDifficulty("all");
    setSource("all");
    setSort("review");
    setFilterPanelOpen(false);
    if (props.status !== "all") void runFilter(() => props.onStatusFilter("all"));
  }, [props.cards.length, props.onQueryChange, props.onStatusFilter, props.status]);

  useEffect(() => {
    if (!filterPanelOpen) return;
    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (filterTriggerRef.current?.contains(target) || filterPanelRef.current?.contains(target)) return;
      if (target instanceof Element && target.closest(".accessible-listbox-popover-v143")) return;
      setFilterPanelOpen(false);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setFilterPanelOpen(false);
      filterTriggerRef.current?.focus();
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [filterPanelOpen]);

  useEffect(() => {
    setStatusOverrides((current) => {
      let changed = false;
      const next = { ...current };
      for (const card of props.cards) {
        if (next[card.id] === card.status) {
          delete next[card.id];
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [props.cards]);

  useOverlayFocus({
    active: mobileIndexOpen,
    containerRef: mobileIndexRef,
    initialFocusRef: mobileIndexCloseRef,
    returnFocusRef: mobileIndexTriggerRef,
    onRequestClose: () => setMobileIndexOpen(false)
  });
  useOverlayFocus({
    active: Boolean(drawer),
    containerRef: drawerRef,
    initialFocusRef: drawerCloseRef,
    returnFocusRef: drawerTriggerRef,
    onRequestClose: () => setDrawer(null)
  });
  useOverlayFocus({
    active: Boolean(deleteTarget),
    containerRef: deleteDialogRef,
    initialFocusRef: deleteCancelRef,
    returnFocusRef: deleteTriggerRef,
    onRequestClose: () => setDeleteTarget(null)
  });

  async function runFilter(action: () => Promise<void>) {
    if (filterBusy) return;
    setFilterBusy(true);
    setActionError(null);
    try {
      await action();
    } catch (error) {
      setActionError(friendlyActionError(error, "筛选卡片失败，请稍后重试。"));
    } finally {
      setFilterBusy(false);
    }
  }

  function resetFilters() {
    props.onQueryChange("");
    setDifficulty("all");
    setSource("all");
    setSort("review");
    setFilterPanelOpen(false);
    if (props.status !== "all") void runFilter(() => props.onStatusFilter("all"));
  }

  async function choose(id: string) {
    if (!id || id === props.activeCardId) return;
    setActionError(null);
    setMobileIndexOpen(false);
    setFilterPanelOpen(false);
    await props.onSelectCard(id);
  }

  async function updateStatus(card: LearningCard, nextStatus: string) {
    if (pendingCardId || effectiveStatus(card) === nextStatus) return;
    const previousStatus = effectiveStatus(card);
    setPendingCardId(card.id);
    setActionError(null);
    setStatusOverrides((current) => ({ ...current, [card.id]: nextStatus }));
    try {
      await props.onUpdate(card.id, nextStatus);
    } catch (error) {
      setStatusOverrides((current) => ({ ...current, [card.id]: previousStatus }));
      setActionError(friendlyActionError(error, "更新掌握状态失败，请稍后重试。"));
    } finally {
      setPendingCardId(null);
    }
  }

  async function deleteCard() {
    if (!deleteTarget || pendingCardId) return;
    const target = deleteTarget;
    setPendingCardId(target.id);
    setActionError(null);
    try {
      await props.onDelete(target.id);
      setDeleteTarget(null);
    } catch (error) {
      setActionError(friendlyActionError(error, "删除卡片失败，请稍后重试。"));
    } finally {
      setPendingCardId(null);
    }
  }

  async function generateMaterial() {
    if (!active || props.busy) return;
    setActionError(null);
    try {
      await props.onGenerateMaterial(active.id);
    } catch (error) {
      setActionError(friendlyActionError(error, "生成学习材料失败，请稍后重试。"));
    }
  }

  async function approveCandidates() {
    setActionError(null);
    try {
      await props.onApproveCandidates();
      setDrawer(null);
    } catch (error) {
      setActionError(friendlyActionError(error, "审核候选失败，请稍后重试。"));
    }
  }

  async function rejectCandidate(id: string) {
    setActionError(null);
    try {
      await props.onRejectCandidate(id);
    } catch (error) {
      setActionError(friendlyActionError(error, "拒绝候选失败，请稍后重试。"));
    }
  }

  async function submitManual(event: FormEvent) {
    event.preventDefault();
    setActionError(null);
    try {
      await props.onCreateManual(event);
      setDrawer(null);
    } catch (error) {
      setActionError(friendlyActionError(error, "创建卡片失败，请稍后重试。"));
    }
  }

  return <section className="cards-workspace-v135" aria-busy={props.busy || filterBusy || Boolean(pendingCardId)}>
    <ProductToolbar>
      <div className="cards-toolbar-context-v141"><strong>{props.cards.length} 张</strong><em>待复习 {props.cards.length - mastered} · 掌握 {masteredPercent}%</em></div>
      <div className="cards-toolbar-actions-v141">
        {filterBusy && <span className="cards-toolbar-loading-v141"><Loader2 className="spin" size={14}/>正在更新</span>}
        {props.onExportCards && !libraryEmpty && <button aria-label="导出知识卡片" className="cards-export-trigger-v152" disabled={props.busy} onClick={props.onExportCards} title="导出知识卡片" type="button"><Download size={15}/></button>}
        {props.candidates.length > 0 && <button aria-label={`审核 ${props.candidates.length} 个候选`} className="cards-candidate-trigger-v152" disabled={props.busy} onClick={(event) => { drawerTriggerRef.current = event.currentTarget; setDrawer("candidates"); }} title={`审核 ${props.candidates.length} 个候选`} type="button"><GraduationCap size={15}/><span>待审核</span><i>{props.candidates.length}</i></button>}
        <button className="primary-button" disabled={props.busy} onClick={(event) => { drawerTriggerRef.current = event.currentTarget; setDrawer("manual"); }} type="button"><Plus size={15}/><span>新增卡片</span></button>
      </div>
    </ProductToolbar>

    {!libraryEmpty && <button className="cards-mobile-index-v135" onClick={() => setMobileIndexOpen(true)} ref={mobileIndexTriggerRef} type="button"><BookOpen size={15}/>卡片索引 · {visible.length}</button>}
    <div className={`cards-layout-v135 ${libraryEmpty ? "is-library-empty" : ""}`}>
      {!libraryEmpty && mobileIndexOpen && <button className="cards-scrim-v135" aria-label="关闭卡片索引" onClick={() => { setMobileIndexOpen(false); setFilterPanelOpen(false); }} type="button"/>}
      {!libraryEmpty && <aside aria-label="卡片索引" className={`cards-index-v135 ${mobileIndexOpen ? "is-open" : ""}`} ref={mobileIndexRef}>
        <header><div><strong>卡片索引</strong><span>{visible.length} 张</span></div><button aria-label="关闭卡片索引" onClick={() => { setMobileIndexOpen(false); setFilterPanelOpen(false); }} ref={mobileIndexCloseRef} type="button"><ChevronLeft size={16}/></button></header>
        <label className="cards-search-v135"><Search size={14}/><input aria-label="搜索知识卡片" onChange={(event) => props.onQueryChange(event.target.value)} placeholder="搜索标题、标签或内容" value={props.query}/></label>
        <div className="cards-filter-controls-v152">
          <AccessibleListbox compact disabled={filterBusy} label="状态" onChange={(value) => void runFilter(() => props.onStatusFilter(value))} options={statusOptions} value={props.status}/>
          <button aria-controls="cards-filter-popover-v152" aria-expanded={filterPanelOpen} aria-haspopup="dialog" aria-label={`筛选与排序${advancedFilterCount ? `，已启用 ${advancedFilterCount} 项` : ""}`} className="cards-filter-trigger-v152" onClick={() => setFilterPanelOpen((current) => !current)} ref={filterTriggerRef} type="button"><SlidersHorizontal size={14}/><span>筛选与排序</span>{advancedFilterCount > 0 && <i>{advancedFilterCount}</i>}</button>
          {filterPanelOpen && <div aria-label="筛选与排序" className="cards-filter-popover-v152" id="cards-filter-popover-v152" ref={filterPanelRef} role="dialog">
            <AccessibleListbox compact label="难度" onChange={(value) => setDifficulty(value as "all" | Difficulty)} options={difficultyOptions} value={difficulty}/>
            <AccessibleListbox compact label="来源" onChange={(value) => setSource(value as "all" | Source)} options={sourceOptions} value={source}/>
            <AccessibleListbox compact label="排序" onChange={(value) => setSort(value as "review" | "newest" | "oldest")} options={sortOptions} value={sort}/>
            <footer><button disabled={filterBusy || (!props.query && props.status === "all" && advancedFilterCount === 0)} onClick={resetFilters} type="button">清除筛选</button></footer>
          </div>}
        </div>
        <div className="cards-list-v135">
          {visible.map((card) => <button aria-current={active?.id === card.id ? "page" : undefined} className={active?.id === card.id ? "active" : ""} key={card.id} onClick={() => void choose(card.id)} type="button"><span className={`card-status-dot-v141 ${effectiveStatus(card)}`}/><strong>{card.title}</strong><small>{statusLabel(effectiveStatus(card))} · {difficultyLabel(cardDifficulty(card))} · {sourceLabel(cardSource(card))}</small><span className="cards-list-tags-v141">{card.tags.slice(0, 2).map((tag) => <i key={tag}>{tag}</i>)}</span></button>)}
          {filteredEmpty && <div className="cards-index-empty-v152"><strong>0 个结果</strong><span>当前卡片库未发生变化。</span></div>}
        </div>
      </aside>}

      <main className={`card-detail-v135 ${libraryEmpty ? "is-library-empty" : filteredEmpty ? "is-filter-empty" : ""}`}>
        {libraryEmpty ? <section className="cards-library-empty-v152">
          <BookOpen size={24}/>
          <h3>建立第一张知识卡片</h3>
          <p>从已确认的问题开始沉淀，也可以手动记录一个需要长期复习的知识点。</p>
          <div className="cards-library-empty-actions-v152">
            <button className="primary-button" onClick={props.onOpenFindings} type="button"><ShieldAlert size={15}/>前往问题清单</button>
            <button onClick={(event) => { drawerTriggerRef.current = event.currentTarget; setDrawer("manual"); }} type="button"><Plus size={15}/>手动创建</button>
            {props.candidates.length > 0 && <button onClick={(event) => { drawerTriggerRef.current = event.currentTarget; setDrawer("candidates"); }} type="button"><GraduationCap size={15}/>审核 {props.candidates.length} 个候选</button>}
          </div>
          {actionError && <p className="card-action-error-v141" role="alert">{actionError}</p>}
        </section> : filteredEmpty ? <section className="cards-filter-empty-v152">
          <SlidersHorizontal size={22}/>
          <h3>没有符合当前条件的卡片</h3>
          <p>卡片仍保留在本地，只是暂时未出现在当前筛选结果中。</p>
          <button disabled={filterBusy} onClick={resetFilters} type="button">清除筛选</button>
          {actionError && <p className="card-action-error-v141" role="alert">{actionError}</p>}
        </section> : active ? <>
          <header className="card-detail-header-v141">
            <div className="card-detail-labels-v141"><span>{statusLabel(activeStatus)}</span><span>{difficultyLabel(cardDifficulty(active))}</span><span>{sourceLabel(cardSource(active))}</span></div>
            <h3>{active.title}</h3>
            <dl className="card-source-grid-v141">
              <div><dt>来源</dt><dd>{props.sourceFinding ? "问题沉淀" : sourceLabel(cardSource(active))}</dd></div>
              <div><dt>更新时间</dt><dd>{formatDate(active.updated_at)}</dd></div>
              {props.sourceFinding && <div className="card-source-reference-v141"><dt>关联问题</dt><dd title={props.sourceFinding.title}>{props.sourceFinding.title}</dd></div>}
              {props.sourceReportTitle && <div className="card-source-reference-v141"><dt>关联报告</dt><dd title={props.sourceReportTitle}>{props.sourceReportTitle}</dd></div>}
            </dl>
            {props.sourceFinding && <div className="card-source-actions-v141"><button onClick={props.onOpenSourceFinding} type="button"><ShieldAlert size={14}/>查看问题</button>{props.sourceReportTitle && <button onClick={props.onOpenSourceReport} type="button"><FileText size={14}/>打开报告</button>}</div>}
            <button aria-label="删除卡片" className="card-delete-trigger-v141" onClick={() => setDeleteTarget(active)} ref={deleteTriggerRef} title="删除卡片" type="button"><Trash2 size={16}/></button>
          </header>

          <section className="card-content-v135"><span>知识内容</span><p>{active.content}</p><div>{active.tags.map((tag) => <span key={tag}><Tag size={12}/>{tag}</span>)}</div></section>
          <section className="card-status-v135" aria-label="掌握状态"><div><span>掌握状态</span><p>状态会保留在本地学习记录中。</p></div><div className="card-status-actions-v141" role="group" aria-label="更新掌握状态"><button aria-pressed={activeStatus === "new"} disabled={Boolean(pendingCardId)} onClick={() => void updateStatus(active, "new")} type="button">未掌握</button><button aria-pressed={activeStatus === "reviewing"} disabled={Boolean(pendingCardId)} onClick={() => void updateStatus(active, "reviewing")} type="button">复习中</button><button aria-pressed={activeStatus === "mastered"} disabled={Boolean(pendingCardId)} onClick={() => void updateStatus(active, "mastered")} type="button"><Check size={14}/>已掌握</button></div></section>
          <section className="card-self-check-v135"><span>复习提示</span><ul><li>用自己的话解释这张卡片对应的知识点。</li><li>回想它在原问题中的影响与检查方式。</li><li>确认是否能写出验证或修复步骤。</li></ul>{reviewQueue[0] && <button onClick={() => void choose(reviewQueue[0].id)} type="button">下一张：{reviewQueue[0].title}<ArrowUpRight size={14}/></button>}</section>
          <section className="card-material-v135"><header><div><span>学习材料</span><strong>{materials.length ? `${materials.length} 份材料` : "尚未生成"}</strong></div><button disabled={props.busy || Boolean(pendingCardId)} onClick={() => void generateMaterial()} type="button">{props.busy ? <Loader2 className="spin" size={14}/> : <RefreshCw size={14}/>} {latestMaterial ? "重新生成" : "生成材料"}</button></header>{latestMaterial ? <article className="report-document-rich">{latestMaterial.content.split("\n").map(renderLine)}</article> : <div className="card-material-empty-v135">生成一份围绕当前知识点的复习材料。</div>}</section>
          {actionError && <p className="card-action-error-v141" role="alert">{actionError}</p>}
        </> : null}
      </main>
    </div>

    {drawer && <><button className="cards-drawer-scrim-v135" aria-label="关闭新增卡片抽屉" onClick={() => setDrawer(null)} type="button"/><aside aria-labelledby="cards-drawer-title-v144" aria-modal="true" className="cards-drawer-v135" ref={drawerRef} role="dialog"><header><strong id="cards-drawer-title-v144">新增与候选</strong><button aria-label="关闭抽屉" onClick={() => setDrawer(null)} ref={drawerCloseRef} type="button"><X size={17}/></button></header><div aria-label="卡片创建方式" className="cards-drawer-tabs-v135" role="tablist"><button aria-controls="cards-candidates-panel-v144" aria-selected={drawer === "candidates"} className={drawer === "candidates" ? "active" : ""} onClick={() => setDrawer("candidates")} role="tab" type="button">候选审核</button><button aria-controls="cards-manual-panel-v144" aria-selected={drawer === "manual"} className={drawer === "manual" ? "active" : ""} onClick={() => setDrawer("manual")} role="tab" type="button">手动创建</button></div>
      {drawer === "candidates" ? <section aria-labelledby="cards-drawer-title-v144" className="card-candidates-v135" id="cards-candidates-panel-v144" role="tabpanel"><div className="cards-drawer-actions-v135"><button disabled={props.busy} onClick={() => void props.onGenerateCandidates()} type="button"><GraduationCap size={14}/>从当前报告生成</button><button className="primary-button" disabled={props.busy || !props.selectedCandidateIds.length} onClick={() => void approveCandidates()} type="button">通过选中 {props.selectedCandidateIds.length || ""}</button></div>{props.candidates.map((candidate) => <article className="card-candidate-row-v144" key={candidate.id}><label htmlFor={`card-candidate-${candidate.id}`}><input checked={props.selectedCandidateIds.includes(candidate.id)} id={`card-candidate-${candidate.id}`} onChange={(event) => props.onToggleCandidate(candidate.id, event.target.checked)} type="checkbox"/><span><strong>{candidate.title}</strong><small>{difficultyLabel(candidate.difficulty)} · {candidate.tags.join("、") || "暂无标签"}</small><p>{candidate.content}</p></span></label><button disabled={props.busy} onClick={() => void rejectCandidate(candidate.id)} type="button">拒绝</button></article>)}{!props.candidates.length && <p className="cards-drawer-empty-v135">暂无待审核候选。打开一份报告后，可在这里生成和审核候选。</p>}</section> : <form aria-labelledby="cards-drawer-title-v144" className="card-manual-v135" id="cards-manual-panel-v144" onSubmit={(event) => void submitManual(event)} role="tabpanel"><label>标题<input onChange={(event) => props.onManualTitleChange(event.target.value)} placeholder="输入知识点标题" value={props.manualTitle}/></label><label>标签<input onChange={(event) => props.onManualTagsChange(event.target.value)} placeholder="使用逗号分隔" value={props.manualTags}/></label><label>内容<textarea onChange={(event) => props.onManualContentChange(event.target.value)} placeholder="记录知识点、来源和复习提示" value={props.manualContent}/></label><button className="primary-button" disabled={props.busy} type="submit">{props.busy ? <Loader2 className="spin" size={15}/> : <Plus size={15}/>}创建卡片</button></form>}
      {actionError && <p className="card-drawer-error-v141" role="alert">{actionError}</p>}
    </aside></>}

    {deleteTarget && <div className="card-delete-layer-v141" role="presentation"><button aria-label="取消删除卡片" className="card-delete-scrim-v141" onClick={() => setDeleteTarget(null)} type="button"/><section aria-labelledby="card-delete-title-v141" aria-modal="true" className="card-delete-dialog-v141" ref={deleteDialogRef} role="dialog"><header><Trash2 size={18}/><div><strong id="card-delete-title-v141">删除这张卡片？</strong><span>{deleteTarget.title}</span></div></header><p>将删除本地卡片及其学习材料，不会修改原项目文件、问题或报告。</p><footer><button className="secondary-button" disabled={Boolean(pendingCardId)} onClick={() => setDeleteTarget(null)} ref={deleteCancelRef} type="button">取消</button><button className="danger-button" disabled={Boolean(pendingCardId)} onClick={() => void deleteCard()} type="button">确认删除</button></footer></section></div>}
  </section>;
}

function cardDifficulty(card: LearningCard): Difficulty {
  const text = `${card.title} ${card.content} ${card.tags.join(" ")}`.toLowerCase();
  if (text.includes("high") || text.includes("安全") || text.includes("security") || card.content.length > 520) return "hard";
  if (text.includes("medium") || text.includes("重构") || text.includes("测试") || card.content.length > 240) return "medium";
  return "easy";
}

function cardSource(card: LearningCard): Source {
  return card.finding_id ? "finding" : card.workspace_id ? "workspace" : "manual";
}

function compareCards(left: LearningCard, right: LearningCard, sort: "review" | "newest" | "oldest", getStatus: (card: LearningCard) => string) {
  if (sort === "newest") return right.updated_at.localeCompare(left.updated_at);
  if (sort === "oldest") return left.created_at.localeCompare(right.created_at);
  const priority: Record<string, number> = { reviewing: 0, new: 1, mastered: 2 };
  return (priority[getStatus(left)] ?? 3) - (priority[getStatus(right)] ?? 3) || right.updated_at.localeCompare(left.updated_at);
}

function statusLabel(value: string) { return ({ new: "未掌握", reviewing: "复习中", mastered: "已掌握" } as Record<string, string>)[value] || value; }
function difficultyLabel(value: string) { return ({ easy: "入门", medium: "中强度", hard: "高强度" } as Record<string, string>)[value] || value; }
function sourceLabel(value: Source) { return ({ finding: "问题来源", workspace: "项目来源", manual: "手动创建" } as Record<Source, string>)[value]; }
function formatDate(value: string) { return value ? value.slice(0, 10) : "未知"; }
function friendlyActionError(error: unknown, fallback: string) { return error instanceof Error && error.message ? error.message : fallback; }
function renderLine(line: string, index: number) { const text = line.trim(); if (text.startsWith("# ")) return <h3 key={index}>{text.slice(2)}</h3>; if (text.startsWith("## ")) return <h4 key={index}>{text.slice(3)}</h4>; if (text.startsWith("- ")) return <p className="doc-list" key={index}>{text}</p>; if (!text) return <div className="doc-gap" key={index}/>; return <p key={index}>{line}</p>; }
