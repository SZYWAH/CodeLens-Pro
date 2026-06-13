import { Copy, Loader2, Maximize2, Trash2, X } from "lucide-react";
import { useEffect, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { ChatPanel } from "./ChatPanel";
import { MarkdownDocument } from "./MarkdownDocument";
import type { SettingsResponse } from "../types";

export type ReportContextChatConfig = {
  settings: SettingsResponse | null;
  reportId?: string | null;
  codeContext: string;
  reportContext?: string;
  sessionId?: string | null;
  onSessionIdChange?: (sessionId: string | null) => void;
  onSessionSaved?: (sessionId: string) => void;
};

export function ReportViewer({
  title,
  content,
  loading,
  error,
  onClear,
  contextChat
}: {
  title: string;
  content: string;
  loading?: boolean;
  error?: string;
  onClear?: () => void;
  contextChat?: ReportContextChatConfig;
}) {
  const [fullscreen, setFullscreen] = useState(false);
  const [splitPercent, setSplitPercent] = useState(66.7);
  const [resizingSplit, setResizingSplit] = useState(false);
  const hasContextChat = Boolean(contextChat && content.trim() && !loading && !error);

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

  async function copyReport() {
    if (content) {
      await navigator.clipboard.writeText(content);
    }
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
                className={hasContextChat ? "report-fullscreen-body report-fullscreen-body-split" : "report-fullscreen-body"}
                style={hasContextChat ? ({ "--report-split": `${splitPercent}%` } as CSSProperties) : undefined}
              >
                {hasContextChat ? (
                  <>
                    <div className="report-fullscreen-report-pane">
                      <ReportContent content={content} error={error} emptyText="暂无报告内容" />
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
                  <ReportContent content={content} error={error} emptyText="暂无报告内容" />
                )}
              </div>
            </div>
          </div>,
          document.body
        )
      : null;

  return (
    <section className="tool-panel report-viewer-panel flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex h-[52px] shrink-0 items-center justify-between border-b border-line bg-[#0a1020] px-4 py-2">
        <div className="flex items-center gap-2">
          <div className="h-5 w-1 rounded-full bg-pine" />
          <h2 className="text-sm font-black tracking-normal text-ink">{title}</h2>
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
      <div className="min-h-0 flex-1 overflow-auto bg-[#070b14] px-10 py-7">
        <ReportContent content={content} error={error} emptyText="报告将在这里显示" />
        {hasContextChat && !fullscreen ? <div className="report-inline-chat">{renderContextChat()}</div> : null}
      </div>
      {fullscreenOverlay}
    </section>
  );
}

function ReportContent({ content, error, emptyText }: { content: string; error?: string; emptyText: string }) {
  if (error) {
    return <div className="rounded-md border border-[#5c3024] bg-[#241713] p-3 text-sm text-coral">{error}</div>;
  }

  if (!content) {
    return <div className="empty-state">{emptyText}</div>;
  }

  return (
    <MarkdownDocument content={content} className="report-document" />
  );
}
