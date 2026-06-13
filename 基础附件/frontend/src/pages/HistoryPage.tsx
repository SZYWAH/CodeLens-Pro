import { ArrowUpRight, FileClock, MessageSquare, PanelLeftClose, PanelLeftOpen, RefreshCw, Search, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { ReportViewer } from "../components/ReportViewer";
import { SelectField } from "../components/SelectField";
import { api } from "../lib/api";
import { formatTime, modeLabel } from "../lib/format";
import type { ReportDetail, ReportListItem, SettingsResponse } from "../types";

export function HistoryPage({
  settings,
  onOpenReport,
  onOpenChatSession
}: {
  settings: SettingsResponse | null;
  onOpenReport: (report: ReportDetail) => void;
  onOpenChatSession: (sessionId: string) => void;
}) {
  const [items, setItems] = useState<ReportListItem[]>([]);
  const [selected, setSelected] = useState<ReportDetail | null>(null);
  const [query, setQuery] = useState("");
  const [languageCode, setLanguageCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [historyOpen, setHistoryOpen] = useState(true);

  async function loadReports() {
    setLoading(true);
    setError("");
    try {
      const next = await api.listReports({ query, language_code: languageCode || undefined });
      setItems(next);
      if (!selected && next[0]) {
        setSelected(await api.getReport(next[0].id));
      }
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "加载历史失败");
    } finally {
      setLoading(false);
    }
  }

  async function selectReport(id: string) {
    setSelected(await api.getReport(id));
  }

  async function removeReport(id: string) {
    await api.deleteReport(id);
    if (selected?.id === id) setSelected(null);
    await loadReports();
  }

  useEffect(() => {
    void loadReports();
  }, []);

  const languages = settings?.languages ?? {};

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
              <button
                className="icon-button border border-line"
                onClick={() => setHistoryOpen(false)}
                title="收起历史报告栏"
                type="button"
                aria-expanded={historyOpen}
              >
                <PanelLeftClose size={16} />
              </button>
            </div>
            <div className="mb-2 flex gap-2">
              <div className="relative flex-1">
                <Search className="search-field-icon absolute left-2 top-2.5 text-[#b8c9e6]" size={15} />
                <input className="control-field search-field-input h-9 w-full" onChange={(event) => setQuery(event.target.value)} placeholder="搜索报告" value={query} />
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
            {error ? <div className="mt-2 text-xs text-coral">{error}</div> : null}
          </div>
        ) : (
          <div className="history-rail">
            <button
              className="icon-button border border-line"
              onClick={() => setHistoryOpen(true)}
              title="展开历史报告栏"
              type="button"
              aria-expanded={historyOpen}
            >
              <PanelLeftOpen size={17} />
            </button>
            <FileClock className="text-pine" size={17} />
            <div className="history-rail-label">报告</div>
          </div>
        )}

        {historyOpen ? (
          <div className="history-list-scroll">
            {items.map((item) => (
              <button
                key={item.id}
                className={["history-card history-card-report", selected?.id === item.id ? "history-card-active" : "history-card-idle"].join(" ")}
                onClick={() => selectReport(item.id)}
                type="button"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="history-card-title">{item.title}</div>
                    <div className="history-card-meta">{modeLabel(item.mode)} · {item.language_label}</div>
                  </div>
                  <span className="history-card-time">{formatTime(item.created_at)}</span>
                </div>
              </button>
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
              <ReportViewer title={selected.title} content={selected.content} />
            </div>
          </div>
        ) : (
          <div className="tool-panel empty-state">选择一份报告</div>
        )}
      </section>
    </div>
  );
}
