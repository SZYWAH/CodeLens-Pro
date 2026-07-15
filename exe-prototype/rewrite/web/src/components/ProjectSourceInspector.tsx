import { Check, ChevronDown, ChevronUp, Clipboard, Copy, FileCode2, Search, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { List, type ListImperativeAPI } from "react-window";
import type { WorkspaceDetail, WorkspaceFile } from "../types";
import type { InspectTarget } from "../utils/projectNavigation";
import { findWorkspaceFile } from "../utils/projectNavigation";
import { useOverlayFocus } from "../hooks/useOverlayFocus";

type CodeRowProps = {
  activeLine: number;
  lines: string[];
  matches: Set<number>;
};

export function ProjectSourceInspector({
  workspace,
  target,
  onClose
}: {
  workspace: WorkspaceDetail;
  target: InspectTarget | null;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const listRef = useRef<ListImperativeAPI | null>(null);
  const [compact, setCompact] = useState(() => typeof window !== "undefined" && window.matchMedia("(max-width: 980px)").matches);
  const [query, setQuery] = useState("");
  const [matchIndex, setMatchIndex] = useState(0);
  const [copyState, setCopyState] = useState<"idle" | "path" | "code" | "error">("idle");

  const requestClose = useCallback(() => {
    onClose();
    window.requestAnimationFrame(() => returnFocusRef.current?.focus());
  }, [onClose]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 980px)");
    const update = () => setCompact(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!target) return;
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setQuery("");
    setMatchIndex(0);
  }, [target?.path, target?.line]);

  const file = useMemo(() => target ? findWorkspaceFile(workspace, target.path) : null, [target, workspace]);
  const lines = useMemo(() => splitLines(file), [file]);
  const activeLine = Math.min(lines.length, Math.max(1, target?.line || 1));
  const matches = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return [];
    const result: number[] = [];
    lines.forEach((line, index) => {
      if (line.toLocaleLowerCase().includes(needle)) result.push(index + 1);
    });
    return result;
  }, [lines, query]);
  const matchSet = useMemo(() => new Set(matches), [matches]);

  useEffect(() => {
    if (!target || !lines.length) return;
    const row = matches.length ? matches[Math.min(matchIndex, matches.length - 1)] : activeLine;
    window.requestAnimationFrame(() => listRef.current?.scrollToRow({ index: row - 1, align: "center" }));
  }, [activeLine, matchIndex, matches, target, lines.length]);

  useEffect(() => {
    if (!target || compact) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      requestClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [compact, requestClose, target]);

  useOverlayFocus({
    active: Boolean(target && compact),
    containerRef: panelRef,
    initialFocusRef: closeRef,
    returnFocusRef,
    onRequestClose: requestClose
  });

  if (!target) return null;

  async function copy(value: string, kind: "path" | "code") {
    try {
      await navigator.clipboard.writeText(value);
      setCopyState(kind);
      window.setTimeout(() => setCopyState("idle"), 1200);
    } catch {
      setCopyState("error");
    }
  }

  function moveMatch(delta: number) {
    if (!matches.length) return;
    setMatchIndex((current) => (current + delta + matches.length) % matches.length);
  }

  return (
    <>
      {compact && <button aria-label="关闭源码查看器" className="project-source-scrim-v1420" onClick={requestClose} type="button" />}
      <aside
        aria-label="源码查看器"
        aria-modal={compact || undefined}
        className="project-source-inspector-v1420"
        ref={panelRef}
        role={compact ? "dialog" : "complementary"}
      >
        <header className="project-source-head-v1420">
          <div>
            <span>{sourceLabel(target.source)}</span>
            <strong>{target.title || file?.path.split(/[\\/]/).pop() || target.path}</strong>
          </div>
          <button aria-label="关闭源码查看器" onClick={requestClose} ref={closeRef} title="关闭源码查看器" type="button"><X size={17} /></button>
        </header>

        <div className="project-source-path-v1420">
          <code title={file?.path || target.path}>{file?.path || target.path}</code>
          <button onClick={() => copy(file?.path || target.path, "path")} title="复制路径" type="button">
            {copyState === "path" ? <Check size={14} /> : <Clipboard size={14} />}
          </button>
        </div>

        {file ? (
          <>
            <dl className="project-source-meta-v1420">
              <Meta label="语言" value={file.language || "文本"} />
              <Meta label="行数" value={file.metrics.total_lines} />
              <Meta label="复杂度" value={file.metrics.complexity_score} />
              <Meta label="风险" value={file.metrics.risk_count} />
            </dl>

            {target.context && <p className="project-source-context-v1420">{target.context}</p>}

            <div className="project-source-tools-v1420">
              <label>
                <Search size={14} />
                <input
                  aria-label="在当前文件中搜索"
                  onChange={(event) => { setQuery(event.target.value); setMatchIndex(0); }}
                  placeholder="在文件中搜索"
                  value={query}
                />
              </label>
              <span>{query ? `${matches.length ? matchIndex + 1 : 0} / ${matches.length}` : `第 ${activeLine} 行`}</span>
              <button aria-label="上一个匹配" disabled={!matches.length} onClick={() => moveMatch(-1)} title="上一个匹配" type="button"><ChevronUp size={14} /></button>
              <button aria-label="下一个匹配" disabled={!matches.length} onClick={() => moveMatch(1)} title="下一个匹配" type="button"><ChevronDown size={14} /></button>
              <button aria-label="复制源码" onClick={() => copy(file.content, "code")} title="复制源码" type="button">
                {copyState === "code" ? <Check size={14} /> : <Copy size={14} />}
              </button>
            </div>

            <div className="project-source-code-v1420">
              <List<CodeRowProps>
                className="project-source-lines-v1420"
                defaultHeight={520}
                listRef={listRef}
                overscanCount={12}
                rowComponent={CodeRow}
                rowCount={lines.length}
                rowHeight={24}
                rowProps={{ activeLine, lines, matches: matchSet }}
                style={{ height: "100%" }}
              />
            </div>
          </>
        ) : (
          <div className="project-source-missing-v1420">
            <FileCode2 size={24} />
            <strong>当前快照中找不到这个文件</strong>
            <p>文件可能已在重新扫描后移动或删除。关闭查看器后刷新项目数据再试。</p>
          </div>
        )}

        {copyState === "error" && <p className="project-source-error-v1420">复制失败，请检查系统剪贴板权限。</p>}
      </aside>
    </>
  );
}

function CodeRow({ ariaAttributes, activeLine, index, lines, matches, style }: {
  ariaAttributes: { "aria-posinset": number; "aria-setsize": number; role: "listitem" };
  activeLine: number;
  index: number;
  lines: string[];
  matches: Set<number>;
  style: CSSProperties;
}) {
  const lineNumber = index + 1;
  const className = [lineNumber === activeLine ? "is-active" : "", matches.has(lineNumber) ? "is-match" : ""].filter(Boolean).join(" ");
  return (
    <div {...ariaAttributes} className={className} style={style}>
      <span aria-hidden="true">{lineNumber}</span>
      <code>{lines[index] || " "}</code>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string | number }) {
  return <div><dt>{label}</dt><dd>{value}</dd></div>;
}

function splitLines(file: WorkspaceFile | null): string[] {
  if (!file) return [];
  const lines = file.content.replace(/\r\n/g, "\n").split("\n");
  return lines.length ? lines : [""];
}

function sourceLabel(source: InspectTarget["source"]): string {
  return ({ guide: "项目导览", hotspot: "热点文件", symbol: "符号定位", dependency: "依赖定位", graph: "依赖图" } as const)[source];
}
