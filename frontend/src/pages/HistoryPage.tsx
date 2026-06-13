import { ArrowUpRight, FileClock, MessageSquare, PanelLeftClose, PanelLeftOpen, RefreshCw, Search, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { CalendarPopover, dateKeyFromIso } from "../components/CalendarPopover";
import { ReportViewer } from "../components/ReportViewer";
import { SelectField } from "../components/SelectField";
import { api } from "../lib/api";
import { formatTime, modeLabel } from "../lib/format";
import type { LearningCardItem, ReportDetail, ReportListItem, SettingsResponse } from "../types";

export function HistoryPage({
  settings,
  restoreReport,
  onOpenReport,
  onOpenChatSession,
  onOpenLearningCard
}: {
  settings: SettingsResponse | null;
  restoreReport?: ReportDetail | null;
  onOpenReport: (report: ReportDetail) => void;
  onOpenChatSession: (sessionId: string) => void;
  onOpenLearningCard: (card: LearningCardItem) => void;
}) {
  const [items, setItems] = useState<ReportListItem[]>([]);
  const [calendarItems, setCalendarItems] = useState<ReportListItem[]>([]);
  const [selected, setSelected] = useState<ReportDetail | null>(null);
  const [query, setQuery] = useState("");
  const [languageCode, setLanguageCode] = useState("");
  const [mode, setMode] = useState("");
  const [reportType, setReportType] = useState("");
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [historyOpen, setHistoryOpen] = useState(true);
  const [savedLearningCards, setSavedLearningCards] = useState<LearningCardItem[]>([]);

  const languages = settings?.languages ?? {};
  const modeOptions = useMemo(() => reportModeOptions(settings, reportType), [settings, reportType]);
  const groupedItems = useMemo(() => groupReportsByDate(items), [items]);
  const dateMarkers = useMemo(() => markerCounts(calendarItems.map((item) => item.created_at)), [calendarItems]);

  async function loadReports() {
    setLoading(true);
    setError("");
    try {
      const baseParams = {
        query,
        language_code: languageCode || undefined,
        mode: mode || undefined,
        report_type: reportType || undefined,
      };
      const [next, calendarNext] = await Promise.all([
        api.listReports({
          ...baseParams,
          date_from: selectedDate || undefined,
          date_to: selectedDate || undefined,
        }),
        api.listReports(baseParams),
      ]);
      setItems(next);
      setCalendarItems(calendarNext);
      if (!selected && next[0]) {
        setSelected(await api.getReport(next[0].id));
      }
      if (selected && !next.some((item) => item.id === selected.id)) {
        setSelected(next[0] ? await api.getReport(next[0].id) : null);
      }
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "加载历史报告失败");
    } finally {
      setLoading(false);
    }
  }

  async function selectReport(id: string) {
    setSelected(await api.getReport(id));
  }

  async function loadSavedLearningCards(reportId: string | null | undefined) {
    if (!reportId) {
      setSavedLearningCards([]);
      return;
    }
    setSavedLearningCards(await api.reportLearningCards(reportId));
  }

  async function removeReport(id: string) {
    await api.deleteReport(id);
    if (selected?.id === id) setSelected(null);
    await loadReports();
  }

  useEffect(() => {
    void loadReports();
  }, [languageCode, mode, reportType, selectedDate]);

  useEffect(() => {
    if (!restoreReport) return;
    setSelected(restoreReport);
  }, [restoreReport?.id]);

  useEffect(() => {
    void loadSavedLearningCards(selected?.id);
  }, [selected?.id]);

  useEffect(() => {
    if (!mode) return;
    if (!modeOptions.some((item) => item.id === mode)) setMode("");
  }, [modeOptions, mode]);

  return (
    <div className={["page-scroll history-page-layout", historyOpen ? "history-page-layout-open" : "history-page-layout-closed"].join(" ")}>
      <section className={["tool-panel history-sidebar", historyOpen ? "" : "history-sidebar-collapsed"].filter(Boolean).join(" ")}>
        {historyOpen ? (
          <div className="border-b border-line p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-xs font-black uppercase tracking-[0.18em] text-pine">Report History</div>
                <h2 className="mt-0.5 truncate text-sm font-black text-[#f8fbff]">历史报告</h2>
              </div>
              <button className="icon-button border border-line" onClick={() => setHistoryOpen(false)} title="收起历史报告栏" type="button" aria-expanded={historyOpen}>
                <PanelLeftClose size={16} />
              </button>
            </div>
            <div className="mb-2 flex gap-2">
              <div className="relative flex-1">
                <Search className="search-field-icon absolute left-2 top-2.5 text-[#b8c9e6]" size={15} />
                <input
                  className="control-field search-field-input h-9 w-full"
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => event.key === "Enter" && void loadReports()}
                  placeholder="搜索报告"
                  value={query}
                />
              </div>
              <button className="icon-button border border-line" onClick={loadReports} title="刷新" type="button">
                <RefreshCw className={loading ? "animate-spin" : ""} size={16} />
              </button>
            </div>
            <SelectField
              ariaLabel="筛选报告语言"
              value={languageCode}
              onChange={setLanguageCode}
              options={[
                { label: "全部语言", value: "" },
                ...Object.entries(languages).map(([label, code]) => ({ label, value: code }))
              ]}
            />
            <div className="history-filter-grid">
              <SelectField
                ariaLabel="筛选报告类型"
                value={reportType}
                onChange={(value) => {
                  setReportType(value);
                  setMode("");
                }}
                options={[
                  { label: "全部类型", value: "" },
                  { label: "普通报告", value: "single" },
                  { label: "对比报告", value: "diff" },
                ]}
              />
              <SelectField
                ariaLabel="筛选报告模式"
                value={mode}
                onChange={setMode}
                options={[
                  { label: "全部模式", value: "" },
                  ...modeOptions.map((item) => ({ label: item.label, value: item.id })),
                ]}
              />
              <CalendarPopover
                value={selectedDate}
                onChange={setSelectedDate}
                markers={dateMarkers}
                label={selectedDate ? `选择日期：${selectedDate.slice(5)}` : "全部日期"}
              />
            </div>
            {error ? <div className="mt-2 text-xs text-coral">{error}</div> : null}
          </div>
        ) : (
          <div className="history-rail">
            <button className="icon-button border border-line" onClick={() => setHistoryOpen(true)} title="展开历史报告栏" type="button" aria-expanded={historyOpen}>
              <PanelLeftOpen size={17} />
            </button>
            <FileClock className="text-pine" size={17} />
            <div className="history-rail-label">报告</div>
          </div>
        )}

        {historyOpen ? (
          <div className="history-list-scroll">
            {groupedItems.map((group) => (
              <div className="history-date-group" key={group.label}>
                <div className="history-date-group-label">{group.label}</div>
                {group.items.map((item) => (
                  <button
                    key={item.id}
                    className={["history-card history-card-report", selected?.id === item.id ? "history-card-active" : "history-card-idle"].join(" ")}
                    onClick={() => selectReport(item.id)}
                    type="button"
                  >
                    <div className="history-card-row">
                      <div className="history-card-text">
                        <div className="history-card-title">{item.title}</div>
                        <div className="history-card-meta">{modeLabel(item.mode)} · {item.language_label} · {item.report_type === "diff" ? "对比报告" : "普通报告"}</div>
                      </div>
                      <span className="history-card-time">{formatTime(item.created_at)}</span>
                    </div>
                  </button>
                ))}
              </div>
            ))}
            {!items.length ? <div className="p-4 text-sm text-[#b8c9e6]">暂无历史报告</div> : null}
          </div>
        ) : null}
      </section>

      <section className="min-h-0">
        {selected ? (
          <div className="flex h-full min-h-0 flex-col gap-2">
            <div className="flex min-h-10 shrink-0 flex-wrap items-center justify-between gap-2">
              <div className="text-sm text-[#c5d7f2]">
                {selected.language_label} · {selected.model} · {formatTime(selected.created_at)}
              </div>
              <div className="flex items-center gap-2">
                <button className="btn btn-primary h-9" onClick={() => onOpenReport(selected)} type="button">
                  <ArrowUpRight size={15} />
                  {selected.report_type === "diff" ? "回到代码对比" : "回到工作台"}
                </button>
                {selected.chat_session_id ? (
                  <button className="btn btn-secondary h-9" onClick={() => onOpenChatSession(selected.chat_session_id ?? "")} type="button">
                    <MessageSquare size={15} />
                    打开关联聊天
                  </button>
                ) : null}
                <button className="btn border border-[#6e3324] bg-[#241713] text-coral hover:bg-[#2a1b16]" onClick={() => removeReport(selected.id)} type="button">
                  <Trash2 size={15} />
                  删除
                </button>
              </div>
            </div>
            <div className="min-h-0 flex-1">
              <ReportViewer
                title={selected.title}
                content={selected.content}
                learningCards={{
                  candidates: [],
                  savedCards: savedLearningCards,
                  onOpenCard: onOpenLearningCard,
                }}
              />
            </div>
          </div>
        ) : (
          <div className="tool-panel empty-state">选择一份报告</div>
        )}
      </section>
    </div>
  );
}

function reportModeOptions(settings: SettingsResponse | null, reportType: string) {
  if (reportType === "single") return Object.entries(settings?.report_modes ?? {})
    .filter(([key]) => key !== "diff")
    .flatMap(([, modes]) => modes);
  if (reportType === "diff") return settings?.report_modes?.diff ?? [];
  const options = Object.values(settings?.report_modes ?? {}).flat();
  const seen = new Set<string>();
  return options.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function groupReportsByDate(items: ReportListItem[]) {
  const grouped = new Map<string, ReportListItem[]>();
  items.forEach((item) => {
    const key = dateKeyFromIso(item.created_at);
    grouped.set(key, [...(grouped.get(key) ?? []), item]);
  });
  return Array.from(grouped.entries()).map(([date, groupItems]) => ({
    label: dateLabel(date),
    items: groupItems,
  }));
}

function dateLabel(dateKey: string) {
  const today = dateKeyFromIso(new Date().toISOString());
  if (dateKey === today) return "今天";
  return dateKey;
}

function markerCounts(values: string[]) {
  return values.reduce<Record<string, number>>((acc, value) => {
    const key = dateKeyFromIso(value);
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
}
