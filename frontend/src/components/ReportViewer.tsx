import { BookMarked, Copy, Loader2, Maximize2, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type FocusEvent } from "react";
import { createPortal } from "react-dom";
import { ChatPanel } from "./ChatPanel";
import { LearningCardCandidatePanel } from "./LearningCardCandidatePanel";
import { extractMarkdownHeadings, MarkdownDocument, type MarkdownHeadingItem } from "./MarkdownDocument";
import type { LearningCardCandidate, LearningCardItem, SettingsResponse } from "../types";

const REPORT_HEADING_ACTIVATION_OFFSET = 96;
const REPORT_HEADING_CLICK_LOCK_MS = 900;
const REPORT_AUTO_FOLLOW_THRESHOLD = 80;

export type ReportContextChatConfig = {
  settings: SettingsResponse | null;
  reportId?: string | null;
  codeContext: string;
  reportContext?: string;
  sessionId?: string | null;
  onSessionIdChange?: (sessionId: string | null) => void;
  onSessionSaved?: (sessionId: string) => void;
};

export type ReportLearningCardsConfig = {
  candidates: LearningCardCandidate[];
  savedCards?: LearningCardItem[];
  notice?: string;
  pendingMessage?: string;
  onDismiss?: () => void;
  onSaved?: (created: number, skipped: number, cards: LearningCardItem[]) => void;
  onOpenCard?: (card: LearningCardItem) => void;
};

export function ReportViewer({
  title,
  content,
  loading,
  error,
  onClear,
  contextChat,
  learningCards
}: {
  title: string;
  content: string;
  loading?: boolean;
  error?: string;
  onClear?: () => void;
  contextChat?: ReportContextChatConfig;
  learningCards?: ReportLearningCardsConfig;
}) {
  const [fullscreen, setFullscreen] = useState(false);
  const [splitPercent, setSplitPercent] = useState(66.7);
  const [resizingSplit, setResizingSplit] = useState(false);
  const [activeHeadingId, setActiveHeadingId] = useState<string | null>(null);
  const readerScrollRef = useRef<HTMLDivElement | null>(null);
  const fullscreenBodyRef = useRef<HTMLDivElement | null>(null);
  const fullscreenReportPaneRef = useRef<HTMLDivElement | null>(null);
  const activeHeadingLockRef = useRef<{ id: string; releaseAt: number } | null>(null);
  const activeHeadingReleaseTimerRef = useRef<number | null>(null);
  const autoFollowBottomRef = useRef(true);
  const lastContentRef = useRef(content);
  const lastAutoFollowKeyRef = useRef("");
  const hasContextChat = Boolean(contextChat && content.trim() && !loading && !error);
  const reportHeadings = useMemo(() => extractMarkdownHeadings(content), [content]);
  const reportHeadingKey = useMemo(() => reportHeadings.map((heading) => heading.id).join("|"), [reportHeadings]);
  const reportAutoFollowKey = [
    content.length,
    learningCards?.pendingMessage ?? "",
    learningCards?.notice ?? "",
    learningCards?.candidates.length ?? 0,
    learningCards?.savedCards?.length ?? 0
  ].join("|");

  useEffect(() => {
    if (!fullscreen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setFullscreen(false);
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [fullscreen]);

  useEffect(() => {
    if (!resizingSplit) return;

    function handlePointerMove(event: PointerEvent) {
      const splitBody = document.querySelector<HTMLElement>(".report-fullscreen-body-split");
      if (!splitBody) return;

      const rect = splitBody.getBoundingClientRect();
      if (!rect.width) return;

      const nextPercent = ((event.clientX - rect.left) / rect.width) * 100;
      const clamped = Math.min(78, Math.max(48, nextPercent));
      setSplitPercent(Number(clamped.toFixed(1)));
    }

    function handlePointerUp() {
      setResizingSplit(false);
    }

    document.body.classList.add("is-resizing-report-split");
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);

    return () => {
      document.body.classList.remove("is-resizing-report-split");
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };
  }, [resizingSplit]);

  useEffect(() => {
    if (!reportHeadings.length) {
      setActiveHeadingId(null);
      return;
    }

    const containers = [readerScrollRef.current, fullscreenReportPaneRef.current, fullscreenBodyRef.current].filter(Boolean) as HTMLElement[];
    if (!containers.length) return;

    function updateActiveHeading() {
      const container = fullscreen && hasContextChat
        ? fullscreenReportPaneRef.current
        : fullscreen
          ? fullscreenBodyRef.current
          : readerScrollRef.current;
      if (!container) return;

      const containerTop = container.getBoundingClientRect().top;
      const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
      autoFollowBottomRef.current = distanceFromBottom <= REPORT_AUTO_FOLLOW_THRESHOLD;
      const lock = activeHeadingLockRef.current;
      if (lock) {
        if (Date.now() < lock.releaseAt) {
          setActiveHeadingId(lock.id);
          return;
        }
        activeHeadingLockRef.current = null;
      }

      const activationOffset = REPORT_HEADING_ACTIVATION_OFFSET;
      const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
      const isAtBottom = maxScrollTop > 0 && container.scrollTop >= maxScrollTop - 2;
      let nextId = reportHeadings[0].id;
      let closestId = reportHeadings[0].id;
      let closestTop = Number.POSITIVE_INFINITY;
      let closestDistance = Number.POSITIVE_INFINITY;

      reportHeadings.forEach((heading) => {
        const node = container.querySelector<HTMLElement>(`#${cssEscape(heading.id)}`);
        if (!node) return;
        const headingTop = node.getBoundingClientRect().top - containerTop;
        const distance = Math.abs(headingTop - activationOffset);
        if (distance < closestDistance) {
          closestDistance = distance;
          closestTop = headingTop;
          closestId = heading.id;
        }
        if (headingTop <= activationOffset) {
          nextId = heading.id;
        }
      });

      if (isAtBottom || (closestTop > activationOffset && closestTop - activationOffset <= activationOffset)) {
        nextId = closestId;
      }

      setActiveHeadingId(nextId);
    }

    updateActiveHeading();
    containers.forEach((container) => container.addEventListener("scroll", updateActiveHeading, { passive: true }));
    window.addEventListener("resize", updateActiveHeading);

    return () => {
      containers.forEach((container) => container.removeEventListener("scroll", updateActiveHeading));
      window.removeEventListener("resize", updateActiveHeading);
    };
  }, [fullscreen, hasContextChat, reportHeadingKey, reportHeadings]);

  useEffect(() => {
    const containers = [readerScrollRef.current, fullscreenReportPaneRef.current, fullscreenBodyRef.current].filter(Boolean) as HTMLElement[];
    if (!containers.length) return;

    function updateAutoFollow() {
      const container = fullscreen && hasContextChat
        ? fullscreenReportPaneRef.current
        : fullscreen
          ? fullscreenBodyRef.current
          : readerScrollRef.current;
      if (!container) return;
      const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
      autoFollowBottomRef.current = distanceFromBottom <= REPORT_AUTO_FOLLOW_THRESHOLD;
    }

    updateAutoFollow();
    containers.forEach((container) => container.addEventListener("scroll", updateAutoFollow, { passive: true }));
    return () => {
      containers.forEach((container) => container.removeEventListener("scroll", updateAutoFollow));
    };
  }, [fullscreen, hasContextChat]);

  useEffect(() => {
    if (loading && !lastContentRef.current && content) {
      autoFollowBottomRef.current = true;
    }
    const contentChanged = reportAutoFollowKey !== lastAutoFollowKeyRef.current;
    lastContentRef.current = content;
    lastAutoFollowKeyRef.current = reportAutoFollowKey;
    if (!contentChanged || !content || !autoFollowBottomRef.current || activeHeadingLockRef.current) return;

    const container = fullscreen && hasContextChat
      ? fullscreenReportPaneRef.current
      : fullscreen
        ? fullscreenBodyRef.current
        : readerScrollRef.current;
    if (!container) return;

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        if (!autoFollowBottomRef.current || activeHeadingLockRef.current) return;
        container.scrollTop = container.scrollHeight;
      });
    });
  }, [content, fullscreen, hasContextChat, loading, reportAutoFollowKey]);

  useEffect(() => {
    return () => {
      if (activeHeadingReleaseTimerRef.current !== null) {
        window.clearTimeout(activeHeadingReleaseTimerRef.current);
      }
    };
  }, []);

  async function copyReport() {
    if (content) {
      await navigator.clipboard.writeText(content);
    }
  }

  function jumpToReportSection(id: string, container?: HTMLElement | null) {
    const scope = container ?? (fullscreen ? fullscreenReportPaneRef.current ?? fullscreenBodyRef.current : readerScrollRef.current);
    const target = scope?.querySelector<HTMLElement>(`#${cssEscape(id)}`) ?? document.getElementById(id);
    if (!target) return;

    if (activeHeadingReleaseTimerRef.current !== null) {
      window.clearTimeout(activeHeadingReleaseTimerRef.current);
      activeHeadingReleaseTimerRef.current = null;
    }
    activeHeadingLockRef.current = { id, releaseAt: Date.now() + REPORT_HEADING_CLICK_LOCK_MS };
    autoFollowBottomRef.current = false;
    setActiveHeadingId(id);
    if (scope) {
      const scopeRect = scope.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      const nextScrollTop = scope.scrollTop + targetRect.top - scopeRect.top - REPORT_HEADING_ACTIVATION_OFFSET;
      scope.scrollTo({ top: Math.max(0, nextScrollTop), behavior: "smooth" });
    } else {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    activeHeadingReleaseTimerRef.current = window.setTimeout(() => {
      const lock = activeHeadingLockRef.current;
      if (lock?.id === id) {
        activeHeadingLockRef.current = null;
      }
      activeHeadingReleaseTimerRef.current = null;
      scope?.dispatchEvent(new Event("scroll"));
    }, REPORT_HEADING_CLICK_LOCK_MS + 120);
  }

  function renderContextChat(className = "") {
    if (!hasContextChat || !contextChat) return null;
    const isFullscreenChat = className.includes("report-fullscreen-chat-pane");

    return (
      <ChatPanel
        className={className}
        compact
        liftOnInputResize={!isFullscreenChat}
        settings={contextChat.settings}
        mode="report"
        reportId={contextChat.reportId}
        codeContext={contextChat.codeContext}
        reportContext={contextChat.reportContext ?? content}
        sessionId={contextChat.sessionId}
        title="结合当前报告问 AI"
        onSessionIdChange={contextChat.onSessionIdChange}
        onSessionSaved={contextChat.onSessionSaved}
      />
    );
  }

  const fullscreenOverlay =
    fullscreen && typeof document !== "undefined"
      ? createPortal(
          <div className="report-fullscreen-overlay" role="dialog" aria-label={`${title}全屏显示`} aria-modal="true">
            <div className="report-fullscreen-shell">
              <div className="report-fullscreen-header">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="h-6 w-1 rounded-full bg-pine" />
                  <div className="min-w-0">
                    <p className="text-[0.68rem] font-black uppercase tracking-[0.24em] text-pine">Fullscreen Report</p>
                    <h2 className="truncate text-base font-black text-ink">{title}</h2>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button className="btn btn-secondary h-9" onClick={copyReport} type="button">
                    <Copy size={15} />
                    <span>复制报告</span>
                  </button>
                  <button className="icon-button" onClick={() => setFullscreen(false)} title="退出全屏" type="button">
                    <X size={18} />
                  </button>
                </div>
              </div>
              <div
                ref={fullscreenBodyRef}
                className={hasContextChat ? "report-fullscreen-body report-fullscreen-body-split" : "report-fullscreen-body report-reader-scope"}
                style={hasContextChat ? ({ "--report-split": `${splitPercent}%` } as CSSProperties) : undefined}
              >
                {hasContextChat ? (
                  <>
                    <div className="report-fullscreen-report-pane report-reader-scope" ref={fullscreenReportPaneRef}>
                      <ReportSectionRail
                        headings={reportHeadings}
                        activeHeadingId={activeHeadingId}
                        onSelect={(id) => jumpToReportSection(id, fullscreenReportPaneRef.current)}
                      />
                      <ReportContent content={content} error={error} emptyText="暂无报告内容" learningCards={learningCards} />
                    </div>
                    <button
                      className="report-fullscreen-resizer"
                      onPointerDown={(event) => {
                        event.preventDefault();
                        setResizingSplit(true);
                      }}
                      title="拖拽调整左右宽度"
                      type="button"
                      aria-label="拖拽调整报告和 AI 对话宽度"
                    >
                      <span />
                    </button>
                    {renderContextChat("report-fullscreen-chat-pane")}
                  </>
                ) : (
                  <>
                    <ReportSectionRail
                      headings={reportHeadings}
                      activeHeadingId={activeHeadingId}
                      onSelect={(id) => jumpToReportSection(id, fullscreenBodyRef.current)}
                    />
                    <ReportContent content={content} error={error} emptyText="暂无报告内容" learningCards={learningCards} />
                  </>
                )}
              </div>
            </div>
          </div>,
          document.body
        )
      : null;

  return (
    <section className="tool-panel report-viewer-panel flex h-full min-h-0 flex-col overflow-hidden">
      <div className="reader-toolbar">
        <div className="flex items-center gap-2">
          <div className="reader-mark" />
          <h2>{title}</h2>
          {loading ? <Loader2 className="animate-spin text-teal" size={16} /> : null}
        </div>
        <div className="flex items-center gap-1">
          <button className="icon-button" onClick={() => setFullscreen(true)} title="全屏报告" type="button">
            <Maximize2 size={16} />
          </button>
          <button className="icon-button" onClick={copyReport} title="复制报告" type="button">
            <Copy size={16} />
          </button>
          {onClear ? (
            <button className="icon-button hover:!bg-[#2a1b16] hover:!text-coral" onClick={onClear} title="清空报告" type="button">
              <Trash2 size={16} />
            </button>
          ) : null}
        </div>
      </div>
      <div className="reader-scroll report-reader-scope" ref={readerScrollRef}>
        <ReportSectionRail
          headings={reportHeadings}
          activeHeadingId={activeHeadingId}
          onSelect={(id) => jumpToReportSection(id, readerScrollRef.current)}
        />
        <ReportContent content={content} error={error} emptyText="报告将在这里显示" learningCards={learningCards} />
        {hasContextChat && !fullscreen ? <div className="report-inline-chat">{renderContextChat()}</div> : null}
      </div>
      {fullscreenOverlay}
    </section>
  );
}

function ReportContent({
  content,
  error,
  emptyText,
  learningCards
}: {
  content: string;
  error?: string;
  emptyText: string;
  learningCards?: ReportLearningCardsConfig;
}) {
  if (error) {
    return <div className="rounded-md border border-[#5c3024] bg-[#241713] p-3 text-sm text-coral">{error}</div>;
  }

  if (!content) {
    return <div className="empty-state">{emptyText}</div>;
  }

  return (
    <>
      <MarkdownDocument content={content} className="report-document" />
      {learningCards?.notice ? <div className="learning-notice report-learning-card-notice">{learningCards.notice}</div> : null}
      {learningCards?.pendingMessage ? (
        <div className="report-learning-card-pending">
          <Loader2 className="animate-spin" size={14} />
          <span>{learningCards.pendingMessage}</span>
        </div>
      ) : null}
      {learningCards?.savedCards ? (
        <ReportSavedLearningCards cards={learningCards.savedCards} onOpenCard={learningCards.onOpenCard} />
      ) : null}
      {learningCards?.candidates?.length ? (
        <LearningCardCandidatePanel
          candidates={learningCards.candidates}
          title="本报告可沉淀的知识卡片"
          description="这些候选来自当前报告和代码上下文。展开后可编辑并选择保存。"
          compactByDefault
          onDismiss={learningCards.onDismiss}
          onSaved={learningCards.onSaved}
        />
      ) : null}
    </>
  );
}

function ReportSectionRail({
  headings,
  activeHeadingId,
  onSelect
}: {
  headings: MarkdownHeadingItem[];
  activeHeadingId: string | null;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const openTimerRef = useRef<number | null>(null);
  const closeTimerRef = useRef<number | null>(null);

  if (headings.length < 2) return null;

  function clearTimers() {
    if (openTimerRef.current !== null) {
      window.clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }

  function openWithDelay() {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    if (open || openTimerRef.current !== null) return;
    openTimerRef.current = window.setTimeout(() => {
      openTimerRef.current = null;
      setOpen(true);
    }, 160);
  }

  function closeWithDelay() {
    if (openTimerRef.current !== null) {
      window.clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
    if (closeTimerRef.current !== null) return;
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      setOpen(false);
    }, 120);
  }

  function handleBlur(event: FocusEvent<HTMLDivElement>) {
    const nextTarget = event.relatedTarget instanceof Node ? event.relatedTarget : null;
    if (nextTarget && event.currentTarget.contains(nextTarget)) return;
    closeWithDelay();
  }

  function selectHeading(id: string) {
    clearTimers();
    onSelect(id);
    setOpen(false);
  }

  return (
    <div
      className="report-section-rail-shell"
      onBlur={handleBlur}
      onFocus={() => {
        clearTimers();
        setOpen(true);
      }}
      onMouseEnter={openWithDelay}
      onMouseLeave={closeWithDelay}
    >
      <div className="report-section-rail" aria-label="报告章节定位">
        {headings.map((heading, index) => (
          <button
            aria-label={`定位到章节：${heading.text}`}
            className={[
              "report-section-bar",
              `report-section-bar-level-${heading.level}`,
              activeHeadingId === heading.id || (!activeHeadingId && index === 0) ? "report-section-bar-active" : ""
            ].filter(Boolean).join(" ")}
            key={heading.id}
            onClick={() => selectHeading(heading.id)}
            type="button"
          />
        ))}
      </div>
      {open ? (
        <div className="report-section-popover">
          <div className="report-section-popover-title">章节定位</div>
          <div className="report-section-option-list">
            {headings.map((heading, index) => (
              <button
                className={[
                  "report-section-option",
                  `report-section-option-level-${heading.level}`,
                  activeHeadingId === heading.id || (!activeHeadingId && index === 0) ? "report-section-option-active" : ""
                ].filter(Boolean).join(" ")}
                key={`${heading.id}-option`}
                onClick={() => selectHeading(heading.id)}
                type="button"
              >
                <span>{sectionNumberLabel(index + 1, heading.level)}</span>
                <strong>{heading.text}</strong>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ReportSavedLearningCards({
  cards,
  onOpenCard
}: {
  cards: LearningCardItem[];
  onOpenCard?: (card: LearningCardItem) => void;
}) {
  return (
    <section className="report-saved-learning-cards">
      <div className="report-saved-learning-head">
        <span><BookMarked size={14} /> 已沉淀知识卡片</span>
        <strong>{cards.length ? `${cards.length} 张` : "尚未沉淀"}</strong>
      </div>
      {cards.length ? (
        <div className="report-saved-learning-list">
          {cards.map((card) => (
            <button key={card.id} onClick={() => onOpenCard?.(card)} type="button">
              <span>{card.title}</span>
              <em>{card.difficulty} · {statusLabel(card.status)}</em>
              <i>{card.tags.slice(0, 3).join(" / ") || card.language_label}</i>
            </button>
          ))}
        </div>
      ) : (
        <p>这份报告还没有保存过知识卡片。可以从候选卡片中选择保存，或稍后在知识卡片页从历史报告智能提炼。</p>
      )}
    </section>
  );
}

function cssEscape(value: string) {
  if (typeof CSS !== "undefined" && "escape" in CSS) {
    return CSS.escape(value);
  }
  return value.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}

function sectionNumberLabel(index: number, level: number) {
  if (level === 1) return `主章 ${index}`;
  if (level === 2) return `小节 ${index}`;
  return `细节 ${index}`;
}

function statusLabel(status: string) {
  if (status === "mastered") return "已掌握";
  if (status === "reviewing") return "复习中";
  if (status === "bookmarked") return "收藏";
  return "新卡片";
}
