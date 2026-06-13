import { CalendarDays, ChevronLeft, ChevronRight, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";

export type CalendarMarkerMap = Record<string, number>;

export function CalendarPopover({
  value,
  onChange,
  markers = {},
  label,
  className = "",
  clearLabel = "全部日期",
}: {
  value?: string | null;
  onChange: (date: string | null) => void;
  markers?: CalendarMarkerMap;
  label?: string;
  className?: string;
  clearLabel?: string;
}) {
  const today = useMemo(() => localDateKey(), []);
  const [open, setOpen] = useState(false);
  const [viewMonth, setViewMonth] = useState(() => (value ?? today).slice(0, 7));
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({});
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const hoverTimerRef = useRef<number | null>(null);

  const title = label ?? (value ? formatDateLabel(value) : clearLabel);
  const days = useMemo(() => monthGrid(viewMonth), [viewMonth]);

  const updatePosition = useCallback(() => {
    const button = buttonRef.current;
    if (!button) return;
    const rect = button.getBoundingClientRect();
    const viewportGap = 12;
    const width = 286;
    const left = Math.min(Math.max(viewportGap, rect.left), window.innerWidth - width - viewportGap);
    const top = Math.min(rect.bottom + 8, Math.max(viewportGap, window.innerHeight - 340));
    setMenuStyle({ left, top: Math.max(viewportGap, top), width });
  }, []);

  function openMenu() {
    setViewMonth((value ?? today).slice(0, 7));
    updatePosition();
    setOpen(true);
    window.requestAnimationFrame(updatePosition);
  }

  function closeMenu() {
    setOpen(false);
  }

  function queueHoverOpen() {
    if (hoverTimerRef.current) window.clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = window.setTimeout(openMenu, 180);
  }

  function cancelHoverOpen() {
    if (hoverTimerRef.current) {
      window.clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
  }

  function choose(date: string) {
    onChange(date);
    closeMenu();
  }

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (buttonRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      closeMenu();
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") closeMenu();
    }

    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);

    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, updatePosition]);

  useEffect(() => () => cancelHoverOpen(), []);

  return (
    <>
      <button
        ref={buttonRef}
        className={["calendar-popover-trigger", value ? "calendar-popover-trigger-active" : "", className].filter(Boolean).join(" ")}
        onClick={() => (open ? closeMenu() : openMenu())}
        onMouseEnter={queueHoverOpen}
        onMouseLeave={cancelHoverOpen}
        type="button"
      >
        <CalendarDays size={15} />
        <span>{title}</span>
      </button>

      {open
        ? createPortal(
            <div ref={menuRef} className="calendar-popover-layer" style={menuStyle} onMouseEnter={cancelHoverOpen}>
              <div className="calendar-popover-head">
                <button className="icon-button" onClick={() => setViewMonth(shiftMonth(viewMonth, -1))} type="button" title="上个月">
                  <ChevronLeft size={15} />
                </button>
                <strong>{formatMonthLabel(viewMonth)}</strong>
                <button className="icon-button" onClick={() => setViewMonth(shiftMonth(viewMonth, 1))} type="button" title="下个月">
                  <ChevronRight size={15} />
                </button>
              </div>
              <div className="calendar-popover-weekdays">
                {["一", "二", "三", "四", "五", "六", "日"].map((item) => <span key={item}>{item}</span>)}
              </div>
              <div className="calendar-popover-grid">
                {days.map((item) => {
                  const count = markers[item.date] ?? 0;
                  return (
                    <button
                      key={item.date}
                      className={[
                        item.inMonth ? "" : "muted",
                        item.date === today ? "today" : "",
                        item.date === value ? "selected" : "",
                        count ? "marked" : "",
                      ].filter(Boolean).join(" ")}
                      onClick={() => choose(item.date)}
                      type="button"
                    >
                      <span>{item.day}</span>
                      {count ? <i>{count > 9 ? "9+" : count}</i> : null}
                    </button>
                  );
                })}
              </div>
              <div className="calendar-popover-actions">
                <button type="button" onClick={() => { onChange(null); closeMenu(); }}>
                  <X size={13} />
                  {clearLabel}
                </button>
                <button type="button" onClick={() => choose(today)}>今天</button>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

export function localDateKey(value = new Date()) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function dateKeyFromIso(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  return localDateKey(date);
}

function monthGrid(monthKey: string) {
  const [year, month] = monthKey.split("-").map(Number);
  const first = new Date(year, month - 1, 1);
  const startOffset = (first.getDay() + 6) % 7;
  const start = new Date(year, month - 1, 1 - startOffset);
  return Array.from({ length: 42 }, (_, index) => {
    const current = new Date(start);
    current.setDate(start.getDate() + index);
    return {
      date: localDateKey(current),
      day: current.getDate(),
      inMonth: current.getMonth() === month - 1,
    };
  });
}

function shiftMonth(monthKey: string, delta: number) {
  const [year, month] = monthKey.split("-").map(Number);
  const next = new Date(year, month - 1 + delta, 1);
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`;
}

function formatMonthLabel(monthKey: string) {
  const [year, month] = monthKey.split("-");
  return `${year} 年 ${month} 月`;
}

function formatDateLabel(dateKey: string) {
  const [, month, day] = dateKey.split("-");
  return `${month}月${day}日`;
}
