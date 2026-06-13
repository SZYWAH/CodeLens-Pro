import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

export function WorkspaceSplit({
  left,
  right,
  defaultPercent,
  minPercent,
  maxPercent,
  leftMin,
  rightMin,
  storageKey,
  className = ""
}: {
  left: ReactNode;
  right: ReactNode;
  defaultPercent: number;
  minPercent: number;
  maxPercent: number;
  leftMin: string;
  rightMin: string;
  storageKey?: string;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [splitPercent, setSplitPercent] = useState(() => {
    if (!storageKey) return defaultPercent;
    try {
      const storedValue = window.localStorage.getItem(storageKey);
      const storedPercent = storedValue ? Number(storedValue) : Number.NaN;
      if (Number.isFinite(storedPercent)) {
        return Math.min(maxPercent, Math.max(minPercent, storedPercent));
      }
    } catch {
      return defaultPercent;
    }
    return defaultPercent;
  });
  const [resizing, setResizing] = useState(false);

  useEffect(() => {
    if (!storageKey) return;
    try {
      window.localStorage.setItem(storageKey, String(splitPercent));
    } catch {
      // Ignore storage failures so layout dragging still works in restricted browsers.
    }
  }, [splitPercent, storageKey]);

  useEffect(() => {
    if (!resizing) return;

    function handlePointerMove(event: PointerEvent) {
      const container = containerRef.current;
      if (!container) return;

      const rect = container.getBoundingClientRect();
      if (!rect.width) return;

      const nextPercent = ((event.clientX - rect.left) / rect.width) * 100;
      const clamped = Math.min(maxPercent, Math.max(minPercent, nextPercent));
      setSplitPercent(Number(clamped.toFixed(1)));
    }

    function handlePointerUp() {
      setResizing(false);
    }

    document.body.classList.add("is-resizing-workspace-split");
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);

    return () => {
      document.body.classList.remove("is-resizing-workspace-split");
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };
  }, [maxPercent, minPercent, resizing]);

  const style = {
    "--workspace-split": `${splitPercent}%`,
    "--workspace-left-min": leftMin,
    "--workspace-right-min": rightMin
  } as CSSProperties;

  return (
    <div ref={containerRef} className={["page-scroll workspace-split-layout", className].filter(Boolean).join(" ")} style={style}>
      {left}
      <button
        className="workspace-split-resizer"
        onDoubleClick={() => setSplitPercent(defaultPercent)}
        onPointerDown={(event) => {
          event.preventDefault();
          setResizing(true);
        }}
        title="拖拽调整输入区和报告区宽度，双击恢复默认"
        type="button"
        aria-label="拖拽调整输入区和报告区宽度"
      >
        <span />
      </button>
      {right}
    </div>
  );
}
